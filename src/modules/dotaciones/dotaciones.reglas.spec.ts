import { describe, expect, it } from 'vitest';
import { ocurrenciaVigente, personaEnPlan, sumarMeses } from './dotaciones.reglas.js';

describe('sumarMeses', () => {
  it('conserva el día y cruza de año', () => {
    expect(sumarMeses('2026-11-19', 1)).toBe('2026-12-19');
    expect(sumarMeses('2026-11-19', 3)).toBe('2027-02-19');
    expect(sumarMeses('2026-01-15', 12)).toBe('2027-01-15');
  });

  it('usa el último día del mes cuando el mes no tiene ese día', () => {
    expect(sumarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(sumarMeses('2028-01-31', 1)).toBe('2028-02-29');
  });
});

describe('ocurrenciaVigente', () => {
  const fijo = { tipo: 'FIJO', fechaInicio: '2026-01-10', cadaMeses: 6 };

  it('devuelve la ocurrencia más reciente dentro de [desde, hoy]', () => {
    expect(ocurrenciaVigente(fijo, '2026-07-10', '2026-01-01')).toBe('2026-07-10');
    expect(ocurrenciaVigente(fijo, '2026-07-20', '2026-01-01')).toBe('2026-07-10');
  });

  it('no genera retroactivo: un plan creado después de la ocurrencia espera a la siguiente', () => {
    expect(ocurrenciaVigente(fijo, '2026-11-19', '2026-11-19')).toBeNull();
    expect(ocurrenciaVigente(fijo, '2027-01-10', '2026-11-19')).toBe('2027-01-10');
  });

  it('no genera antes de la fecha de inicio', () => {
    expect(ocurrenciaVigente({ tipo: 'FIJO', fechaInicio: '2026-12-01', cadaMeses: 3 }, '2026-11-19', '2026-11-19')).toBeNull();
  });

  it('ocasional: solo su fecha', () => {
    const o = { tipo: 'OCASIONAL', fechaInicio: '2026-12-01', cadaMeses: null };
    expect(ocurrenciaVigente(o, '2026-11-30', '2026-11-19')).toBeNull();
    expect(ocurrenciaVigente(o, '2026-12-01', '2026-11-19')).toBe('2026-12-01');
    expect(ocurrenciaVigente(o, '2027-05-01', '2026-11-19')).toBe('2026-12-01');
  });
});

describe('personaEnPlan', () => {
  it('lista vacía = todos, salvo ADMIN y SUPER_ADMIN', () => {
    expect(personaEnPlan({ roles: [], agenciasIds: [] }, { rol: 'LAVADOR', agenciaId: 'a1' })).toBe(true);
    expect(personaEnPlan({ roles: [], agenciasIds: [] }, { rol: 'ADMIN', agenciaId: null })).toBe(false);
    expect(personaEnPlan({ roles: [], agenciasIds: [] }, { rol: 'SUPER_ADMIN', agenciaId: null })).toBe(false);
  });

  it('filtra por rol y por agencia a la vez', () => {
    const plan = { roles: ['LAVADOR'], agenciasIds: ['a1'] };
    expect(personaEnPlan(plan, { rol: 'LAVADOR', agenciaId: 'a1' })).toBe(true);
    expect(personaEnPlan(plan, { rol: 'LAVADOR', agenciaId: 'a2' })).toBe(false);
    expect(personaEnPlan(plan, { rol: 'LIDER', agenciaId: 'a1' })).toBe(false);
    expect(personaEnPlan(plan, { rol: 'LAVADOR', agenciaId: null })).toBe(false);
  });
});
