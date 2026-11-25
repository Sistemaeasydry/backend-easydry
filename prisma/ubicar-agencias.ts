/**
 * Carga las direcciones de «DIRECCIONES DE AGENCIAS.xlsx» a las agencias y calcula su ubicación (latitud y longitud) para validar las
 * timbradas de RRHH.
 *
 *  1. Une cada fila del Excel con una agencia de la base por su nombre.
 *  2. Busca las coordenadas de esa dirección en OpenStreetMap (Nominatim, gratis, a 1 consulta por segundo) y las deja en un CSV de
 *     revisión en `_respaldos/` (con un enlace de Google Maps por fila).
 *  3. Con `--aplicar` guarda `Agencia.latitud` y `Agencia.longitud` (la ubicación con la que RRHH valida la timbrada) de los lugares
 *     concretos que encuentre. Las calles y sectores se omiten: las direcciones del Excel son vagas («frente a…», «sector…») y el
 *     buscador puede devolver un punto de referencia en vez de la agencia; la timbrada exige estar a 100 m, así que un punto errado
 *     deja a todos sin poder timbrar. Esas se fijan en el mapa de la agencia (RRHH › Ubicación) o con «Usar mi ubicación».
 *     El texto de la dirección (`Agencia.direccion`, el campo «Dirección de la agencia» del Admin) se guarda por defecto con lo del Excel;
 *     con `--sin-direccion` no se escribe.
 *
 * Uso:
 *   npm run prisma:ubicar-agencias                       simula: consulta y genera el CSV, no escribe en la base
 *   npm run prisma:ubicar-agencias -- --aplicar          guarda latitud/longitud en las agencias que no tienen ubicación
 *   npm run prisma:ubicar-agencias -- ruta.xlsx          otro archivo (por defecto el de la raíz del proyecto)
 *   --sin-direccion                                      no guarda el texto de la dirección (por defecto sí, en «Dirección de la agencia»)
 *   --sin-ubicacion                                      no guarda coordenadas
 *   --incluir-aproximadas                                guarda también calles y sectores (no recomendado)
 *   --sobrescribir                                       reemplaza ubicación (y dirección si aplica) aunque la agencia ya la tenga
 *   --sin-red                                            no consulta OpenStreetMap: solo une el Excel con las agencias
 *   --solo-direcciones                                   solo direcciones (implica --sin-red): ni lee ni escribe latitud/longitud, para una base que aún no tiene esas columnas
 *
 * Solo corre contra una base en localhost, salvo que se pase IMPORT_REMOTO=SI.
 */
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const SOLO_DIRECCIONES = args.includes('--solo-direcciones');
// La ubicación (latitud/longitud) es lo que usa RRHH para timbrar; el texto `direccion` es el campo «Dirección de la agencia» del Admin. Ambos se guardan por defecto.
const CON_DIRECCION = SOLO_DIRECCIONES || !args.includes('--sin-direccion');
const CON_UBICACION = !SOLO_DIRECCIONES && !args.includes('--sin-ubicacion');
const APROXIMADAS = args.includes('--incluir-aproximadas');
const SOBRESCRIBIR = args.includes('--sobrescribir');
const SIN_RED = args.includes('--sin-red') || SOLO_DIRECCIONES;
const XLSX_PATH = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(__dirname, '..', '..', 'DIRECCIONES DE AGENCIAS.xlsx'));

if (process.env.IMPORT_REMOTO !== 'SI' && !/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Este script solo corre contra la base local (DATABASE_URL debe apuntar a localhost). Para otra base usa IMPORT_REMOTO=SI.');
}

const prisma = new PrismaClient();

// ------------------------------------------------------------------ lectura del xlsx (sin dependencias)
function descomprimir(src: string): { raiz: string; xl: string } {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'easydry-dir-'));
  const zip = path.join(raiz, 'libro.zip');
  fs.copyFileSync(src, zip); // copia: el original puede estar abierto en Excel
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

// ------------------------------------------------------------------ nombres
const sinAcentos = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Mayúsculas, sin acentos ni signos y con espacios simples: sirve para comparar nombres. */
const clave = (s: string) => sinAcentos(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** Nombres del Excel que en la base se llaman distinto (CJA = Carlos Julio Arosemena; Quicentro Sur queda en Quito Sur). */
const EQUIVALENCIAS: Record<string, string> = {
  'MARESA MARESA CJA': 'MARESA CARLOS JULIO',
  'MARESA CJA': 'MARESA CARLOS JULIO',
  'AMBACAR AMBACAR QUICENTRO SUR': 'AMBACAR QUITO SUR',
  'AMBACAR QUICENTRO SUR': 'AMBACAR QUITO SUR',
};

interface FilaExcel { fila: number; marca: string; agencia: string; direccion: string }

function leerFilas(filas: string[][]): FilaExcel[] {
  const cab = filas.findIndex((f) => f.some((c) => /^agencia$/i.test(c)));
  if (cab < 0) throw new Error('No se encontró la columna AGENCIA en el archivo.');
  const iMarca = filas[cab].findIndex((c) => /^marca$/i.test(c));
  const iAg = filas[cab].findIndex((c) => /^agencia$/i.test(c));
  const iDir = filas[cab].findIndex((c) => /^direcci/i.test(c));
  const out: FilaExcel[] = [];
  let marca = '';
  for (let i = cab + 1; i < filas.length; i++) {
    if (filas[i][iMarca]) marca = filas[i][iMarca];
    const agencia = filas[i][iAg] ?? '';
    if (!agencia) continue;
    out.push({ fila: i + 1, marca, agencia, direccion: (filas[i][iDir] ?? '').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim() });
  }
  // Una agencia repetida en el archivo: gana la fila que sí trae dirección.
  const porClave = new Map<string, FilaExcel>();
  for (const f of out) {
    const k = clave(`${f.marca} ${f.agencia}`);
    const previa = porClave.get(k);
    if (!previa || (!previa.direccion && f.direccion)) porClave.set(k, f);
  }
  return [...porClave.values()];
}

// ------------------------------------------------------------------ geocodificación (OpenStreetMap / Nominatim)
const CIUDADES = ['QUITO', 'GUAYAQUIL', 'CUENCA', 'MANTA', 'AMBATO', 'IBARRA', 'CAYAMBE', 'SALINAS', 'SANTO DOMINGO', 'SAMBORONDON', 'CUMBAYA', 'SANGOLQUI', 'DAULE', 'CALDERON', 'LOS CHILLOS'];

/** Texto de búsqueda limpio: sin referencias vagas («frente a…», «aproximadamente a…», «junto a…») que confunden al buscador. */
function consulta(f: FilaExcel): string {
  let d = f.direccion
    .replace(/\(.*?\)/g, ' ')
    .replace(/aproximadamente.*$/i, ' ')
    .replace(/\b(frente a|diagonal a|junto a|junto al|a una cuadra de|cerca de|dentro de|esquina|sector)\b.*$/i, ' ')
    .replace(/\bs\/n\b/gi, ' ')
    .replace(/\bKm\.?\s*([\d.,½]+)/gi, 'Km $1')
    .replace(/½/g, '.5')
    .replace(/\s+y\s+/gi, ' & ')
    .replace(/[,;]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const todo = clave(`${f.direccion} ${f.agencia}`);
  const ciudad = CIUDADES.find((c) => todo.includes(c));
  if (ciudad && !clave(d).includes(ciudad)) d += `, ${ciudad.charAt(0)}${ciudad.slice(1).toLowerCase()}`;
  return `${d}, Ecuador`;
}

interface Hallazgo { lat: number; lng: number; calidad: 'LUGAR' | 'CALLE' | 'ZONA'; nombre: string; tipo: string }

/** Edificio, comercio o centro comercial = lugar concreto. Calle o carretera = aproximado. Barrio o ciudad = solo zona. */
function calidadDe(r: { addresstype?: string; class?: string; type?: string }): Hallazgo['calidad'] {
  const t = `${r.addresstype ?? ''}|${r.class ?? ''}|${r.type ?? ''}`;
  if (/building|house|amenity|shop|mall|commercial|retail|office|tourism|man_made|industrial|place_of_worship|supermarket|yes/.test(t) && !/road|highway|suburb|neighbourhood|city|town|village/.test(r.addresstype ?? '')) return 'LUGAR';
  if (/road|highway|residential|street|tertiary|secondary|primary|trunk|service|unclassified/.test(t)) return 'CALLE';
  return 'ZONA';
}

/** OpenStreetMap bloqueó o limitó las consultas: no tiene sentido seguir (insistir alarga el bloqueo). */
class ErrorBloqueo extends Error {}

// Caché de respuestas: repetir el script no vuelve a consultar lo que ya se buscó (la política de Nominatim limita el volumen).
const CACHE_PATH = path.join(__dirname, '..', '..', '_respaldos', 'geocache-nominatim.json');
const cache: Record<string, Hallazgo | null> = fs.existsSync(CACHE_PATH) ? JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) : {};
const guardarCache = () => {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
};

let ultimaConsulta = 0;
let fallosSeguidos = 0;
async function buscar(q: string): Promise<Hallazgo | null> {
  if (q in cache) return cache[q];
  const espera = 1100 - (Date.now() - ultimaConsulta);
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimaConsulta = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ec&addressdetails=0&q=${encodeURIComponent(q)}`;
  let estado = 0;
  for (let intento = 0; intento < 2; intento++) {
    try {
      // Tiempo límite: sin él, una consulta que no responde deja el script colgado para siempre.
      const res = await fetch(url, { headers: { 'User-Agent': 'easydry-ubicar-agencias/1.0', 'Accept-Language': 'es' }, signal: AbortSignal.timeout(15000) });
      estado = res.status;
      if (res.status === 429 || res.status >= 500 || res.status === 403) {
        await new Promise((r) => setTimeout(r, 5000 * (intento + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`Nominatim respondió ${res.status}`);
      const lista = (await res.json()) as Array<{ lat: string; lon: string; display_name: string; addresstype?: string; class?: string; type?: string }>;
      const r = lista[0];
      const h: Hallazgo | null = r ? { lat: Number(r.lat), lng: Number(r.lon), calidad: calidadDe(r), nombre: r.display_name, tipo: `${r.class ?? ''}/${r.type ?? ''}` } : null;
      fallosSeguidos = 0;
      cache[q] = h; // solo se guarda una respuesta real (con o sin resultado), nunca un error
      guardarCache();
      return h;
    } catch (e) {
      if (e instanceof Error && e.name !== 'TimeoutError' && !/fetch failed/.test(e.message)) throw e;
    }
  }
  // Un error NO es «no encontrada»: antes se devolvía null y se confundía con una dirección sin resultado.
  if (++fallosSeguidos >= 3) throw new ErrorBloqueo(`OpenStreetMap no responde (último estado: ${estado || 'sin respuesta'}). Probablemente limitó o bloqueó esta IP; espera un rato y vuelve a correr (lo ya consultado queda en caché).`);
  throw new Error(`Nominatim no respondió (estado ${estado || 'sin respuesta'})`);
}

const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

async function main() {
  console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN (no se escribe en la base)'} · ${path.basename(XLSX_PATH)}${SIN_RED ? ' · sin consultar OpenStreetMap' : ''}`);
  const { raiz, xl } = descomprimir(XLSX_PATH);
  let filas: FilaExcel[];
  try {
    filas = leerFilas(primeraHoja(xl));
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }

  const agencias: Array<{ id: string; nombre: string; direccion: string | null; latitud: number | null; longitud: number | null }> = SOLO_DIRECCIONES
    ? (await prisma.agencia.findMany({ select: { id: true, nombre: true, direccion: true } })).map((a) => ({ ...a, latitud: null, longitud: null }))
    : await prisma.agencia.findMany({ select: { id: true, nombre: true, direccion: true, latitud: true, longitud: true } });
  const porNombre = new Map<string, typeof agencias[number][]>();
  for (const a of agencias) porNombre.set(clave(a.nombre), [...(porNombre.get(clave(a.nombre)) ?? []), a]);

  /** Exacto por nombre; si no, «MARCA + nombre»; si no, un único nombre de la base que contenga al otro (o al revés). */
  const emparejar = (f: FilaExcel): { agencia?: typeof agencias[number]; motivo?: string } => {
    for (const k0 of [clave(f.agencia), clave(`${f.marca} ${f.agencia}`)]) {
      const k = EQUIVALENCIAS[k0] ?? k0;
      const g = porNombre.get(k);
      if (g?.length === 1) return { agencia: g[0] };
      if (g && g.length > 1) return { motivo: 'nombre repetido en la base' };
    }
    const kA = clave(f.agencia);
    const kMA = clave(`${f.marca} ${f.agencia}`);
    const parecidas = agencias.filter((a) => {
      const k = clave(a.nombre);
      return k.includes(kMA) || kMA.includes(k) || (kA.length >= 6 && (k.includes(kA) || kA.includes(k)));
    });
    if (parecidas.length === 1) return { agencia: parecidas[0] };
    return { motivo: parecidas.length > 1 ? `ambigua: ${parecidas.map((a) => a.nombre).join(' / ')}` : 'no existe en la base' };
  };

  const resultados: Array<{ f: FilaExcel; agencia?: typeof agencias[number]; motivo?: string; q?: string; h?: Hallazgo | null }> = [];
  const usadas = new Set<string>();
  for (const f of filas) {
    const e = emparejar(f);
    if (e.agencia && usadas.has(e.agencia.id)) {
      resultados.push({ f, motivo: `ya se unió otra fila a ${e.agencia.nombre}` });
      continue;
    }
    if (e.agencia) usadas.add(e.agencia.id);
    resultados.push({ f, ...e });
  }

  const unidas = resultados.filter((r) => r.agencia);
  console.log(`Filas del archivo: ${filas.length} · unidas con una agencia: ${unidas.length} · sin unir: ${resultados.length - unidas.length}`);

  if (!SIN_RED) {
    const conDireccion = unidas.filter((r) => r.f.direccion);
    console.log(`Buscando ${conDireccion.length} direcciones en OpenStreetMap (≈ ${Math.ceil((conDireccion.length * 1.1) / 60)} min)…`);
    let n = 0;
    for (const r of conDireccion) {
      r.q = consulta(r.f);
      try {
        r.h = await buscar(r.q);
        // Segundo intento solo con la vía principal (lo anterior a la primera «&» o coma).
        if (!r.h || r.h.calidad !== 'LUGAR') {
          const corto = r.q.split(/[,&]/)[0].trim();
          if (corto && corto !== r.q) {
            const h2 = await buscar(`${corto}, ${r.q.split(',').slice(-2).join(',').trim()}`);
            if (h2 && (!r.h || (h2.calidad === 'LUGAR' && r.h.calidad !== 'LUGAR'))) r.h = h2;
          }
        }
      } catch (e) {
        if (e instanceof ErrorBloqueo) throw e; // se detiene todo: no se escribe nada en la base con datos a medias
        r.h = null;
        console.warn(`  ${r.agencia!.nombre}: no se pudo consultar (${e instanceof Error ? e.message : e})`);
      }
      if (++n % 10 === 0) console.log(`  ${n}/${conDireccion.length}`);
    }
  }

  // ---- CSV de revisión
  const carpeta = path.join(__dirname, '..', '..', '_respaldos');
  fs.mkdirSync(carpeta, { recursive: true });
  const archivo = path.join(carpeta, `ubicaciones-agencias-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
  const lineas = [['Estado', 'Agencia en la base', 'Marca (Excel)', 'Agencia (Excel)', 'Dirección', 'Calidad', 'Latitud', 'Longitud', 'Encontrado', 'Revisar en Google Maps'].map(csv).join(',')];
  for (const r of resultados) {
    const estado = !r.agencia ? `SIN UNIR: ${r.motivo}` : !r.f.direccion ? 'SIN DIRECCIÓN' : SIN_RED ? 'SIN CONSULTAR' : !r.h ? 'NO ENCONTRADA' : r.h.calidad === 'LUGAR' ? 'UBICADA' : `APROXIMADA (${r.h.calidad})`;
    const mapa = r.h ? `https://www.google.com/maps?q=${r.h.lat},${r.h.lng}` : r.f.direccion ? `https://www.google.com/maps/search/${encodeURIComponent(`${r.f.direccion}, Ecuador`)}` : '';
    lineas.push([estado, r.agencia?.nombre ?? '', r.f.marca, r.f.agencia, r.f.direccion, r.h?.calidad ?? '', r.h?.lat ?? '', r.h?.lng ?? '', r.h?.nombre ?? '', mapa].map(csv).join(','));
  }
  fs.writeFileSync(archivo, '﻿' + lineas.join('\r\n'));

  const seguras = unidas.filter((r) => r.h?.calidad === 'LUGAR');
  const aprox = unidas.filter((r) => r.h && r.h.calidad !== 'LUGAR');
  const sinHallazgo = unidas.filter((r) => r.f.direccion && !r.h);
  console.log(`\nUbicadas con un lugar concreto: ${seguras.length} · aproximadas (calle o sector): ${aprox.length} · sin resultado: ${SIN_RED ? '—' : sinHallazgo.length} · sin dirección en el Excel: ${unidas.filter((r) => !r.f.direccion).length}`);
  const sinUnir = resultados.filter((r) => !r.agencia);
  if (sinUnir.length) console.log(`\nFilas sin agencia en la base (${sinUnir.length}):\n` + sinUnir.map((r) => `  fila ${r.f.fila}: ${r.f.marca} · ${r.f.agencia} — ${r.motivo}`).join('\n'));
  const sinFila = agencias.filter((a) => !usadas.has(a.id));
  if (sinFila.length) console.log(`\nAgencias de la base que no aparecen en el archivo (${sinFila.length}):\n  ` + sinFila.map((a) => a.nombre).join('\n  '));
  console.log(`\nCSV de revisión: ${archivo}`);

  if (!APLICAR) {
    console.log('\nNo se escribió nada en la base. Para guardar las ubicaciones (latitud/longitud): npm run prisma:ubicar-agencias -- --aplicar');
    return;
  }

  let dirs = 0;
  let ubic = 0;
  for (const r of unidas) {
    const a = r.agencia!;
    const data: { direccion?: string; latitud?: number; longitud?: number } = {};
    // «SIN DIRECCION» es el relleno que dejó una carga anterior: cuenta como vacío.
    const vacia = !a.direccion || /^\s*sin\s+direcci[oó]n\s*$/i.test(a.direccion);
    if (CON_DIRECCION && r.f.direccion && (SOBRESCRIBIR || vacia)) data.direccion = r.f.direccion;
    const guardable = CON_UBICACION && r.h && (r.h.calidad === 'LUGAR' || APROXIMADAS);
    if (guardable && (SOBRESCRIBIR || a.latitud === null || a.longitud === null)) {
      data.latitud = r.h!.lat;
      data.longitud = r.h!.lng;
    }
    if (!Object.keys(data).length) continue;
    // updateMany y no update: update pide de vuelta la fila completa (con latitud y longitud), que una base sin migrar no tiene.
    await prisma.agencia.updateMany({ where: { id: a.id }, data });
    if (data.direccion) dirs++;
    if (data.latitud !== undefined) ubic++;
  }
  console.log(`\nGuardado: ${ubic} ubicaciones (latitud/longitud)${CON_DIRECCION ? ` y ${dirs} direcciones` : ''}.`);
  if (!APROXIMADAS) console.log('Las agencias aproximadas (calle o sector) no se guardaron: revisa el CSV y fíjalas en RRHH › Ubicación, o usa --incluir-aproximadas.');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
