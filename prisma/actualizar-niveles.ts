/**
 * Pone el nivel (JUNIOR / SENIOR) al personal operativo a partir de la columna CARGO del «LISTADO DE PERSONAL EASYDRY».
 *
 *  - Cruza por cédula. Solo toca la columna `nivel`, y solo de quien tiene un rol operativo (categoría OPERADOR).
 *  - Sin `--aplicar` no escribe nada: muestra lo que haría y quién queda pendiente. Se puede repetir sin problema.
 *
 * Uso:  npm run prisma:niveles [-- carpeta] [--aplicar]
 * Solo corre contra una base en localhost, salvo que se pida a propósito con ACTUALIZAR_EN_REMOTO=SI.
 */
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const CARPETA = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(__dirname, '..', '..'));
const ARCHIVO = 'LISTADO DE PERSONAL EASYDRY.xlsx';

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '') && process.env.ACTUALIZAR_EN_REMOTO !== 'SI') {
  throw new Error('Este script solo corre contra la base local (DATABASE_URL debe apuntar a localhost). Para una base remota define ACTUALIZAR_EN_REMOTO=SI.');
}

const prisma = new PrismaClient();

// ───────────────────────────────────────── lectura del xlsx (igual que cargar-excels.ts)
function descomprimir(src: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easydry-xlsx-'));
  const zip = path.join(dir, 'libro.zip');
  fs.copyFileSync(src, zip); // se copia: el original puede estar abierto en Excel
  const salida = path.join(dir, 'x');
  fs.mkdirSync(salida);
  const q = (s: string) => s.replace(/'/g, "''");
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${q(zip)}' -DestinationPath '${q(salida)}' -Force`], { stdio: 'pipe' });
  return path.join(salida, 'xl');
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

/** Hojas del libro por nombre (sin distinguir mayúsculas ni acentos), en el orden del libro. */
function leerLibro(ruta: string): Map<string, string[][]> {
  if (!fs.existsSync(ruta)) throw new Error(`No encuentro el archivo: ${ruta}`);
  const xl = descomprimir(ruta);
  try {
    const sstPath = path.join(xl, 'sharedStrings.xml');
    const sst = fs.existsSync(sstPath) ? textosCompartidos(fs.readFileSync(sstPath, 'utf8')) : [];
    const libro = fs.readFileSync(path.join(xl, 'workbook.xml'), 'utf8');
    const rels = fs.readFileSync(path.join(xl, '_rels', 'workbook.xml.rels'), 'utf8');
    const out = new Map<string, string[][]>();
    for (const m of libro.matchAll(/<sheet\b[^>]*>/g)) {
      const nombre = (m[0].match(/name="([^"]*)"/) || [])[1];
      const rid = (m[0].match(/r:id="([^"]*)"/) || [])[1];
      const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((x) => x[0]).find((x) => x.includes(`Id="${rid}"`));
      const destino = rel && (rel.match(/Target="([^"]*)"/) || [])[1];
      if (!nombre || !destino) continue;
      out.set(clave(decode(nombre)), leerHoja(fs.readFileSync(path.join(xl, destino.replace(/^\/?(xl\/)?/, '')), 'utf8'), sst));
    }
    return out;
  } finally {
    fs.rmSync(path.resolve(xl, '..', '..'), { recursive: true, force: true });
  }
}

function hojaDe(libro: Map<string, string[][]>, nombre: string, archivo: string): string[][] {
  const h = libro.get(clave(nombre));
  if (!h) throw new Error(`Falta la hoja «${nombre}» en ${archivo}.`);
  return h;
}

const clave = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const cedulaNorm = (c: string) => {
  const d = String(c || '').replace(/\D/g, '');
  return d ? d.padStart(10, '0') : '';
};

/** Nivel escrito al final del cargo. El Excel corta los cargos largos: «… JUN» es Junior y «… SE» es Senior. */
function nivelDeCargo(cargo: string): 'JUNIOR' | 'SENIOR' | null {
  const c = clave(cargo).replace(/\.$/, '');
  if (/\b(JUNIOR|JUN|JR)$/.test(c)) return 'JUNIOR';
  if (/\b(SENIOR|SE|SR)$/.test(c)) return 'SENIOR';
  return null;
}

async function main() {
  const filas = hojaDe(leerLibro(path.join(CARPETA, ARCHIVO)), 'BASE', ARCHIVO);
  const filaEnc = filas.findIndex((f) => f.some((c) => clave(c) === 'CEDULA'));
  if (filaEnc < 0) throw new Error('No encuentro la fila de encabezados (CEDULA, NOMBRES, CARGO).');
  const col = (nombre: string) => {
    const i = filas[filaEnc].findIndex((c) => clave(c) === nombre);
    if (i < 0) throw new Error(`Falta la columna «${nombre}».`);
    return i;
  };
  const [cCedula, cNombre, cCargo] = ['CEDULA', 'NOMBRES', 'CARGO'].map(col);
  const personas = filas.slice(filaEnc + 1).filter((f) => f[cNombre]).map((f) => ({ cedula: cedulaNorm(f[cCedula]), nombre: f[cNombre], cargo: f[cCargo] }));

  const usuarios = await prisma.user.findMany({ select: { id: true, cedula: true, nivel: true, estado: true, role: { select: { namerol: true, categoria: true } } } });
  const porCedula = new Map(usuarios.filter((u) => u.cedula).map((u) => [u.cedula as string, u]));

  const cambios: Array<{ id: string; nivel: 'JUNIOR' | 'SENIOR' }> = [];
  const conNivel = new Set<string>();
  const sinNivelEnCargo: string[] = [];
  const noEncontrados: string[] = [];
  const noOperativos: string[] = [];
  let yaCorrectos = 0;
  for (const p of personas) {
    const nivel = nivelDeCargo(p.cargo);
    if (!nivel) { sinNivelEnCargo.push(`${p.nombre} — ${p.cargo}`); continue; }
    const u = porCedula.get(p.cedula);
    if (!u) { noEncontrados.push(`${p.cedula} ${p.nombre} — ${p.cargo}`); continue; }
    if (u.role.categoria !== 'OPERADOR') { noOperativos.push(`${p.nombre} — ${p.cargo} (rol en el sistema: ${u.role.namerol})`); continue; }
    conNivel.add(u.id);
    if (u.nivel === nivel) yaCorrectos++;
    else cambios.push({ id: u.id, nivel });
  }
  const pendientes = usuarios.filter((u) => u.estado === 1 && u.role.categoria === 'OPERADOR' && !u.nivel && !conNivel.has(u.id));

  if (APLICAR && cambios.length) await prisma.$transaction(cambios.map((c) => prisma.user.update({ where: { id: c.id }, data: { nivel: c.nivel } })));

  const lista = (titulo: string, items: string[]) => {
    console.log(`
${titulo}: ${items.length}`);
    for (const i of items) console.log(`  - ${i}`);
  };
  console.log(APLICAR ? 'CAMBIOS APLICADOS' : 'SIMULACIÓN (no se escribió nada; usa --aplicar)');
  console.log(`Personas en el listado: ${personas.length}`);
  console.log(`${APLICAR ? 'Actualizados' : 'Por actualizar'}: ${cambios.length} (Junior ${cambios.filter((c) => c.nivel === 'JUNIOR').length}, Senior ${cambios.filter((c) => c.nivel === 'SENIOR').length}) · ya estaban bien: ${yaCorrectos}`);
  lista('Con nivel en el listado, pero su cédula no está en el sistema', noEncontrados);
  lista('Con nivel en el listado, pero su rol no es operativo (no se toca)', noOperativos);
  lista('Sin Junior/Senior en el cargo del listado', sinNivelEnCargo);
  const porRol = new Map<string, number>();
  for (const u of pendientes) porRol.set(u.role.namerol, (porRol.get(u.role.namerol) ?? 0) + 1);
  console.log(`
Operativos activos que seguirían sin nivel: ${pendientes.length} ${[...porRol].map(([r, n]) => `${r}=${n}`).join(' ')}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
