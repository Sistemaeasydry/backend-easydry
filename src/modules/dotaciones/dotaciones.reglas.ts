import { sumarDias } from '../rrhh/rrhh.horarios.js';

export { sumarDias };
export const MAX_EVIDENCIAS_DOTACION = 5;
export const MIN_EVIDENCIAS_DOTACION = 1;
export const MAX_BYTES_EVIDENCIA_DOTACION = 10 * 1024 * 1024;
/** Estos roles no reciben dotación (administran el sistema). */
export const ROLES_SIN_DOTACION = ['SUPER_ADMIN', 'ADMIN'];

/** Suma meses a un `AAAA-MM-DD` conservando el día; si el mes no lo tiene (31 en febrero), usa el último día de ese mes. */
export function sumarMeses(dia: string, meses: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  const total = a * 12 + (m - 1) + meses;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

/** Fecha de la siguiente entrega de un plan fijo, contada desde el día en que se cerró la anterior; `null` si el plan no se repite. */
export function siguienteEntrega(plan: { tipo: string; cadaMeses: number | null }, desde: string): string | null {
  if (plan.tipo !== 'FIJO' || !plan.cadaMeses || plan.cadaMeses < 1) return null;
  return sumarMeses(desde, plan.cadaMeses);
}

/** Una entrega pendiente con fecha futura todavía no se puede registrar: se muestra como PROGRAMADA. */
export function estadoVisible(estado: string, fecha: string, hoy: string): string {
  return estado === 'PENDIENTE' && fecha > hoy ? 'PROGRAMADA' : estado;
}

/** Limpia la lista de tallas de un producto: sin vacías ni repetidas (sin distinguir mayúsculas), en el orden escrito. */
export function normalizarTallas(tallas: string[]): string[] {
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const t of tallas.map((x) => x.trim())) {
    if (!t || vistas.has(t.toLowerCase())) continue;
    vistas.add(t.toLowerCase());
    salida.push(t);
  }
  return salida;
}

export interface TallaEntregada {
  talla: string;
  cantidad: number;
}

export function leerTallas(valor: unknown): TallaEntregada[] {
  return Array.isArray(valor) ? (valor as TallaEntregada[]).filter((t) => t && typeof t.talla === 'string' && t.cantidad > 0) : [];
}

/** "M ×2, L ×1": el reparto por talla de lo entregado. */
export function textoTallas(tallas: unknown): string {
  return leerTallas(tallas)
    .map((t) => `${t.talla} ×${t.cantidad}`)
    .join(', ');
}

/** Dónde cae una entrega respecto a hoy: lo que ya debió hacerse, lo de hoy, lo que viene o lo ya cerrado. */
export type MomentoEntrega = 'ATRASADA' | 'HOY' | 'FUTURA' | 'CERRADA';

export function momentoDeEntrega(estado: string, fecha: string, hoy: string): MomentoEntrega {
  if (estado === 'PROGRAMADA') return 'FUTURA';
  if (estado !== 'PENDIENTE') return 'CERRADA';
  return fecha < hoy ? 'ATRASADA' : fecha === hoy ? 'HOY' : 'FUTURA';
}

const ORDEN_MOMENTO: Record<MomentoEntrega, number> = { ATRASADA: 0, HOY: 1, FUTURA: 2, CERRADA: 3 };

/** Orden del listado: primero lo atrasado (la más vieja arriba), luego lo de hoy, después lo que viene y al final lo ya cerrado (lo más reciente primero). */
export function compararEntregas(
  a: { momento: MomentoEntrega; fechaProgramada: string; persona: string },
  b: { momento: MomentoEntrega; fechaProgramada: string; persona: string },
): number {
  if (a.momento !== b.momento) return ORDEN_MOMENTO[a.momento] - ORDEN_MOMENTO[b.momento];
  if (a.fechaProgramada !== b.fechaProgramada) {
    const asc = a.fechaProgramada < b.fechaProgramada ? -1 : 1;
    return a.momento === 'CERRADA' ? -asc : asc;
  }
  return a.persona.localeCompare(b.persona, 'es');
}

export const MODOS_ENTREGA = ['PERSONAS', 'AGENCIA'] as const;
export type ModoEntrega = (typeof MODOS_ENTREGA)[number];
export const MAX_BYTES_FIRMA_DOTACION = 400_000;
export const FIRMA_PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/** Clave que identifica el destino de una entrega: la persona o, en modo AGENCIA, la agencia entera. */
export function claveDestino(persona: { id: string }, agenciaId: string | null, modo: string): string {
  return modo === 'AGENCIA' && agenciaId ? `agencia:${agenciaId}` : persona.id;
}

/** Agrupa a las personas elegibles por agencia (en modo AGENCIA hay una sola entrega por agencia). Quien no tiene agencia queda fuera. */
export function agruparPorAgencia<T extends { agenciaId: string | null }>(personas: T[]): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const p of personas) {
    if (!p.agenciaId) continue;
    const g = grupos.get(p.agenciaId);
    if (g) g.push(p);
    else grupos.set(p.agenciaId, [p]);
  }
  return grupos;
}

/** ¿La persona entra en el alcance del plan? Lista vacía = todos. Los roles de administración nunca reciben dotación. */
export function personaEnPlan(plan: { roles: string[]; agenciasIds: string[] }, persona: { rol: string; agenciaId: string | null }): boolean {
  if (ROLES_SIN_DOTACION.includes(persona.rol)) return false;
  if (plan.roles.length && !plan.roles.includes(persona.rol)) return false;
  if (plan.agenciasIds.length && !(persona.agenciaId && plan.agenciasIds.includes(persona.agenciaId))) return false;
  return true;
}
