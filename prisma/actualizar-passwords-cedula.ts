/**
 * Pone como contraseña de cada persona del «LISTADO DE PERSONAL EASYDRY.xlsx» su propio número de cédula.
 *
 * Busca a cada persona por su cédula (columna `User.cedula`) y reemplaza su contraseña por esa misma cédula (10 dígitos).
 * No crea ni borra usuarios. No se toca a quien no está en el listado ni a los roles ADMIN y SUPER_ADMIN: conservan su contraseña.
 * Al aplicar, guarda las contraseñas anteriores (solo sus hashes) en `_respaldos/` por si hay que volver atrás.
 *
 * Uso:
 *   npm run prisma:passwords-cedula                    simula: muestra qué haría y no escribe nada
 *   npm run prisma:passwords-cedula -- --aplicar       aplica los cambios
 *   npm run prisma:passwords-cedula -- ruta.xlsx       otro archivo (por defecto el de la raíz del proyecto)
 *   --cerrar-sesiones                                  además cierra las sesiones abiertas de cada persona (por defecto se conservan)
 *
 * Solo corre contra una base en localhost, salvo que se pase IMPORT_REMOTO=SI (base compartida: revisa antes con la simulación).
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { motivoPasswordDebil } from '../src/common/utils/password-politica.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
/** Roles que nunca se tocan, aunque estén en el listado. */
const ROLES_INTACTOS = ['ADMIN', 'SUPER_ADMIN'];
const CERRAR_SESIONES = args.includes('--cerrar-sesiones');
const XLSX_PATH = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(__dirname, '..', '..', 'LISTADO DE PERSONAL EASYDRY.xlsx'));

if (process.env.IMPORT_REMOTO !== 'SI' && !/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Este script solo corre contra la base local (DATABASE_URL debe apuntar a localhost). Para otra base usa IMPORT_REMOTO=SI.');
}

const prisma = new PrismaClient();

// ------------------------------------------------------------------ lectura del xlsx (sin dependencias)
function descomprimir(src: string): { raiz: string; xl: string } {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'easydry-cedulas-'));
  const zip = path.join(raiz, 'libro.zip');
  // Se trabaja sobre una copia: el original puede estar abierto en Excel.
  fs.copyFileSync(src, zip);
  const salida = path.join(raiz, 'x');
  fs.mkdirSync(salida);
  const q = (s: string) => s.replace(/'/g, "''");
  execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${q(zip)}' -DestinationPath '${q(salida)}' -Force"`, { stdio: 'pipe' });
  return { raiz, xl: path.join(salida, 'xl') };
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function textosCompartidos(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) out.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decode(x[1])).join(''));
  return out;
}

function colRow(ref: string): { col: number; row: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/)!;
  return { col: m[1].split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1, row: Number(m[2]) - 1 };
}

function leerHoja(xml: string, sst: string[]): string[][] {
  const filas: string[][] = [];
  const re = /<c r="([A-Z]+)(\d+)"([^>]*?)(\/>|>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const { col, row } = colRow(m[1] + m[2]);
    let inner = '';
    if (m[4] === '>') {
      const cierre = xml.indexOf('</c>', m.index);
      if (cierre !== -1) {
        inner = xml.slice(m.index, cierre);
        re.lastIndex = cierre + 4;
      }
    }
    const v = inner.match(/<v>([\s\S]*?)<\/v>/);
    let valor = '';
    if (v) valor = /t="s"/.test(m[3]) || /t="s"/.test(inner) ? sst[Number(v[1])] ?? '' : v[1];
    else if (/t="inlineStr"/.test(m[3]) || /t="inlineStr"/.test(inner)) valor = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decode(x[1])).join('');
    (filas[row] ??= [])[col] = String(valor).replace(/\s+/g, ' ').trim();
  }
  const ancho = filas.reduce((mx, r) => Math.max(mx, (r || []).length), 0);
  return Array.from({ length: filas.length }, (_, i) => Array.from({ length: ancho }, (_, c) => filas[i]?.[c] ?? ''));
}

/** Primera hoja del libro (el listado trae una sola, «BASE»). */
function primeraHoja(xl: string): string[][] {
  const sst = textosCompartidos(fs.readFileSync(path.join(xl, 'sharedStrings.xml'), 'utf8'));
  const libro = fs.readFileSync(path.join(xl, 'workbook.xml'), 'utf8');
  const rels = fs.readFileSync(path.join(xl, '_rels', 'workbook.xml.rels'), 'utf8');
  const hoja = [...libro.matchAll(/<sheet\b[^>]*>/g)][0]?.[0];
  if (!hoja) throw new Error('El libro no tiene hojas.');
  const rid = (hoja.match(/r:id="([^"]*)"/) || [])[1];
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((x) => x[0]).find((x) => x.includes(`Id="${rid}"`));
  const destino = rel && (rel.match(/Target="([^"]*)"/) || [])[1];
  if (!destino) throw new Error('No se encontró la hoja del libro.');
  return leerHoja(fs.readFileSync(path.join(xl, destino.replace(/^\/?(xl\/)?/, '')), 'utf8'), sst);
}

// ------------------------------------------------------------------ cédulas
interface Persona { fila: number; nombre: string; cedula: string }

/** Solo dígitos; una cédula que Excel guardó como número pierde el 0 inicial, así que se completa a 10. */
function normalizarCedula(bruta: string): string {
  const d = String(bruta ?? '').replace(/\D/g, '');
  return d.length === 9 ? `0${d}` : d;
}

function leerPersonas(filas: string[][]): { personas: Persona[]; invalidas: Array<{ fila: number; nombre: string; cedula: string }> } {
  const cab = filas.findIndex((f) => f.some((c) => /^c[eé]dula$/i.test(c)));
  if (cab < 0) throw new Error('No se encontró la columna CEDULA en el listado.');
  const iCed = filas[cab].findIndex((c) => /^c[eé]dula$/i.test(c));
  const iNom = filas[cab].findIndex((c) => /^nombres?$/i.test(c));
  const personas: Persona[] = [];
  const invalidas: Array<{ fila: number; nombre: string; cedula: string }> = [];
  for (let i = cab + 1; i < filas.length; i++) {
    const bruta = filas[i][iCed] ?? '';
    const nombre = filas[i][iNom] ?? '';
    if (!bruta && !nombre) continue;
    const cedula = normalizarCedula(bruta);
    if (!/^\d{10}$/.test(cedula)) invalidas.push({ fila: i + 1, nombre, cedula: bruta });
    else personas.push({ fila: i + 1, nombre, cedula });
  }
  return { personas, invalidas };
}

async function main() {
  console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN (no se escribe nada)'} · ${path.basename(XLSX_PATH)}`);
  const { raiz, xl } = descomprimir(XLSX_PATH);
  let personas: Persona[];
  let invalidas: Array<{ fila: number; nombre: string; cedula: string }>;
  try {
    ({ personas, invalidas } = leerPersonas(primeraHoja(xl)));
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }

  // Cédulas repetidas en el listado: no se sabe cuál es de quién, así que no se toca a nadie con esa cédula.
  const conteo = new Map<string, number>();
  for (const p of personas) conteo.set(p.cedula, (conteo.get(p.cedula) ?? 0) + 1);
  const repetidas = personas.filter((p) => (conteo.get(p.cedula) ?? 0) > 1);
  const unicas = personas.filter((p) => (conteo.get(p.cedula) ?? 0) === 1);

  const usuarios = await prisma.user.findMany({
    where: { cedula: { in: unicas.map((p) => p.cedula) } },
    select: { id: true, cedula: true, email: true, name: true, lastname: true, passwordHash: true, role: { select: { namerol: true } } },
  });
  const porCedula = new Map(usuarios.map((u) => [u.cedula!, u]));

  const sinUsuario: Persona[] = [];
  const yaTienen: string[] = [];
  const intactos: string[] = [];
  const cambiar: Array<{ persona: Persona; id: string; rol: string }> = [];
  for (const p of unicas) {
    const u = porCedula.get(p.cedula);
    if (!u) {
      sinUsuario.push(p);
      continue;
    }
    if (ROLES_INTACTOS.includes(u.role.namerol)) {
      intactos.push(`${p.nombre} (${u.role.namerol})`);
      continue;
    }
    const debil = motivoPasswordDebil(p.cedula, u.email);
    if (debil) throw new Error(`La cédula ${p.cedula} no sirve como contraseña: ${debil}`);
    if (await bcrypt.compare(p.cedula, u.passwordHash)) {
      yaTienen.push(p.nombre);
      continue;
    }
    cambiar.push({ persona: p, id: u.id, rol: u.role.namerol });
  }

  console.log(`Filas con cédula válida: ${personas.length} · usuarios encontrados: ${usuarios.length}`);
  console.log(`Cambiarán de contraseña: ${cambiar.length} · ya la tenían: ${yaTienen.length}`);
  if (intactos.length) console.log(`Conservan su contraseña (${ROLES_INTACTOS.join(' y ')}): ${intactos.join(', ')}`);
  if (invalidas.length) console.log(`\nCédula inválida (no son 10 dígitos), se omiten ${invalidas.length}:\n` + invalidas.map((x) => `  fila ${x.fila}: ${x.nombre} · «${x.cedula}»`).join('\n'));
  if (repetidas.length) console.log(`\nCédula repetida en el listado, se omiten ${repetidas.length}:\n` + repetidas.map((x) => `  fila ${x.fila}: ${x.nombre} · ${x.cedula}`).join('\n'));
  if (sinUsuario.length) console.log(`\nSin usuario con esa cédula en la base, se omiten ${sinUsuario.length}:\n` + sinUsuario.map((x) => `  fila ${x.fila}: ${x.nombre} · ${x.cedula}`).join('\n'));
  const porRol = new Map<string, number>();
  for (const c of cambiar) porRol.set(c.rol, (porRol.get(c.rol) ?? 0) + 1);
  if (cambiar.length) console.log('\nPor rol: ' + [...porRol].map(([r, n]) => `${r} ${n}`).join(' · '));

  if (!APLICAR) {
    console.log('\nNo se cambió nada. Para aplicar: npm run prisma:passwords-cedula -- --aplicar');
    return;
  }

  // Respaldo de las contraseñas anteriores (hashes), para poder volver atrás.
  const carpeta = path.join(__dirname, '..', '..', '_respaldos');
  fs.mkdirSync(carpeta, { recursive: true });
  const archivo = path.join(carpeta, `passwords-antes-cedula-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivo, JSON.stringify(cambiar.map((c) => ({ id: c.id, passwordHash: porCedula.get(c.persona.cedula)!.passwordHash })), null, 2));
  console.log(`Respaldo de las contraseñas anteriores: ${archivo}`);

  const ahora = new Date();
  let hechos = 0;
  for (const c of cambiar) {
    const passwordHash = await bcrypt.hash(c.persona.cedula, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: c.id }, data: { passwordHash, ...(CERRAR_SESIONES ? { sesionesRevocadasAt: ahora } : {}) } }),
      ...(CERRAR_SESIONES ? [prisma.refreshSession.updateMany({ where: { userId: c.id, revokedAt: null }, data: { revokedAt: ahora } })] : []),
    ]);
    hechos++;
  }
  console.log(`\nContraseñas actualizadas: ${hechos}${CERRAR_SESIONES ? ' (y sus sesiones abiertas se cerraron)' : ' (las sesiones abiertas se conservan)'}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
