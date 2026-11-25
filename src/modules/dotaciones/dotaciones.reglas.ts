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

export interface CalendarioPlan {
  tipo: string;
  /** AAAA-MM-DD */
  fechaInicio: string;
  cadaMeses: number | null;
}

/**
 * Fecha de entrega que toca generar hoy: la ocurrencia más reciente del plan entre `desde` (el día en que se creó el plan) y `hoy`.
 * Así un plan nuevo con fecha de inicio pasada no genera entregas retroactivas: la primera sale en su próxima ocurrencia.
 */
export function ocurrenciaVigente(plan: CalendarioPlan, hoy: string, desde: string): string | null {
  let ultima: string | null = null;
  if (plan.tipo === 'OCASIONAL' || !plan.cadaMeses || plan.cadaMeses < 1) {
    ultima = plan.fechaInicio <= hoy ? plan.fechaInicio : null;
  } else {
    for (let k = 0; k < 1200; k++) {
      const f = sumarMeses(plan.fechaInicio, k * plan.cadaMeses);
      if (f > hoy) break;
      ultima = f;
    }
  }
  return ultima && ultima >= desde ? ultima : null;
}

/** Primera fecha del plan posterior a `hoy` (las entregas aún no se generan: se proyectan para mostrarlas por adelantado). */
export function proximaOcurrencia(plan: CalendarioPlan, hoy: string): string | null {
  if (plan.tipo === 'OCASIONAL' || !plan.cadaMeses || plan.cadaMeses < 1) return plan.fechaInicio > hoy ? plan.fechaInicio : null;
  for (let k = 0; k < 1200; k++) {
    const f = sumarMeses(plan.fechaInicio, k * plan.cadaMeses);
    if (f > hoy) return f;
  }
  return null;
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
