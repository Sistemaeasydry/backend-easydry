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

/** ¿La persona entra en el alcance del plan? Lista vacía = todos. Los roles de administración nunca reciben dotación. */
export function personaEnPlan(plan: { roles: string[]; agenciasIds: string[] }, persona: { rol: string; agenciaId: string | null }): boolean {
  if (ROLES_SIN_DOTACION.includes(persona.rol)) return false;
  if (plan.roles.length && !plan.roles.includes(persona.rol)) return false;
  if (plan.agenciasIds.length && !(persona.agenciaId && plan.agenciasIds.includes(persona.agenciaId))) return false;
  return true;
}
