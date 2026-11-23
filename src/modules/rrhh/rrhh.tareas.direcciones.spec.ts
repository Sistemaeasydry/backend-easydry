import { describe, expect, it } from 'vitest';
import { TareasService } from './tareas.service.js';

/** Las tareas van en todas las direcciones dentro del alcance: abajo, de lado y arriba. Sin base de datos. */
const service = new TareasService(null as never, null as never, null as never);
const puede = (user: unknown, persona: unknown): boolean => (service as unknown as { puedeAsignarA: (u: unknown, p: unknown) => boolean }).puedeAsignarA(user, persona);

const agencia = (id: string, regionId: string) => ({ id, regionId });
const persona = (id: string, ambito: 'GLOBAL' | 'REGION' | 'AGENCIA', datos: { agenciaId?: string | null; regionId?: string | null; namerol?: string } = {}) => ({
  id,
  agenciaId: datos.agenciaId ?? null,
  regionId: datos.regionId ?? null,
  agencia: datos.agenciaId ? agencia(datos.agenciaId, datos.regionId ?? 'r1') : null,
  bodega: null,
  role: { namerol: datos.namerol ?? 'X', ambito, capacidades: [] as string[] },
});
/** El usuario de la sesión: el rol viaja en `roleDetails`. */
const sesion = (p: ReturnType<typeof persona>) => ({ ...p, roleDetails: p.role });

describe('tareas en todas las direcciones, dentro del alcance', () => {
  const coordinador = persona('c1', 'REGION', { regionId: 'r1', namerol: 'SUPERVISOR' });
  const lider = persona('l1', 'AGENCIA', { agenciaId: 'a1', regionId: 'r1', namerol: 'LIDER' });
  const lavador = persona('v1', 'AGENCIA', { agenciaId: 'a1', regionId: 'r1', namerol: 'LAVADOR' });
  const lavadorOtraRegion = persona('v2', 'AGENCIA', { agenciaId: 'a9', regionId: 'r2', namerol: 'LAVADOR' });
  const nacional = persona('n1', 'GLOBAL', { namerol: 'COORD_BODEGA' });

  it('hacia abajo: el coordinador regional asigna a quien trabaja en su región', () => {
    expect(puede(sesion(coordinador), lider)).toBe(true);
    expect(puede(sesion(coordinador), lavador)).toBe(true);
  });

  it('hacia arriba: quien trabaja en una agencia puede asignar al coordinador de su región, y no al de otra', () => {
    expect(puede(sesion(lavador), coordinador)).toBe(true);
    expect(puede(sesion(lavadorOtraRegion), coordinador)).toBe(false);
  });

  it('de lado: dos personas de la misma agencia', () => {
    expect(puede(sesion(lider), lavador)).toBe(true);
  });

  it('hacia arriba hasta el alcance nacional', () => {
    expect(puede(sesion(lavador), nacional)).toBe(true);
    expect(puede(sesion(nacional), lavadorOtraRegion)).toBe(true);
  });

  it('nunca fuera del alcance: un lavador no asigna a otra agencia', () => {
    expect(puede(sesion(lavador), lavadorOtraRegion)).toBe(false);
  });
});
