import { describe, expect, it } from 'vitest';
import {
  AJUSTE_POR_DEFECTO,
  HORARIO_POR_DEFECTO,
  HORARIO_POR_DEFECTO_ANTERIOR,
  HORARIO_POR_DEFECTO_DESDE,
  esFechaValida,
  esFinDeSemana,
  evaluarDia,
  horarioPorDefectoDe,
  indiceDiaSemana,
  resolverMarca,
  puntualidadDe,
  problemaDeMediodia,
  resolverMarcaVoluntaria,
  sumarDias,
  validarAjuste,
  validarSemana,
  versionVigente,
  ventanasDe,
  type DiaHorario,
} from './rrhh.horarios.js';

const h = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const DIA: DiaHorario = { trabaja: true, entrada: '08:00', salida: '15:00' };
const NADA = { entrada: false, salida: false };

describe('horario por defecto y validaciones', () => {
  it('parte con 08:00 a 17:00 los siete días y es válido', () => {
    expect(HORARIO_POR_DEFECTO).toHaveLength(7);
    expect(HORARIO_POR_DEFECTO.every((d) => d.trabaja && d.entrada === '08:00' && d.salida === '17:00')).toBe(true);
    expect(validarSemana(HORARIO_POR_DEFECTO)).toBeNull();
  });

  it('el 08:00 a 17:00 rige solo hacia adelante: los días anteriores a su fecha siguen con 08:00 a 15:00', () => {
    expect(horarioPorDefectoDe(HORARIO_POR_DEFECTO_DESDE)).toBe(HORARIO_POR_DEFECTO);
    expect(horarioPorDefectoDe('2031-03-10')).toBe(HORARIO_POR_DEFECTO);
    expect(horarioPorDefectoDe('2026-11-23')).toBe(HORARIO_POR_DEFECTO); // hoy ya es 08:00 a 17:00
    expect(horarioPorDefectoDe('2026-10-31')).toBe(HORARIO_POR_DEFECTO_ANTERIOR);
    expect(HORARIO_POR_DEFECTO_ANTERIOR.every((d) => d.entrada === '08:00' && d.salida === '15:00')).toBe(true);
  });

  it('quien no está obligado a timbrar marca sin ventana: la primera es Entrada, la segunda Salida y no hay una tercera', () => {
    expect(resolverMarcaVoluntaria(NADA)).toEqual({ ok: true, tipo: 'ENTRADA' });
    expect(resolverMarcaVoluntaria({ entrada: true, salida: false })).toEqual({ ok: true, tipo: 'SALIDA' });
    expect(resolverMarcaVoluntaria({ entrada: true, salida: true })).toMatchObject({ ok: false, motivo: 'YA_REGISTRADA' });
  });

  it('un día sin marcas de quien no está obligado sale «No obligatorio»; con marcas, solo se indica si entró antes del horario', () => {
    const sin = evaluarDia({ dia: DIA, ajuste: AJUSTE_POR_DEFECTO, entradaMin: null, salidaMin: null, obligatoria: false });
    expect(sin).toMatchObject({ estado: 'NO_OBLIGATORIO', observaciones: [] });
    const antes = evaluarDia({ dia: DIA, ajuste: AJUSTE_POR_DEFECTO, entradaMin: h('07:10'), salidaMin: h('16:00'), obligatoria: false });
    expect(antes).toMatchObject({ estado: 'REGISTRADO', observaciones: ['ENTRADA_TEMPRANA'], entradaReal: '07:10', minutosEntrada: -50 });
    const tarde = evaluarDia({ dia: DIA, ajuste: AJUSTE_POR_DEFECTO, entradaMin: h('09:30'), salidaMin: null, obligatoria: false });
    expect(tarde).toMatchObject({ estado: 'REGISTRADO', observaciones: [], minutosEntrada: 90 });
  });

  it('rechaza semanas incompletas, horas mal escritas y turnos que cruzan la medianoche', () => {
    expect(validarSemana(HORARIO_POR_DEFECTO.slice(0, 6))).toMatch(/7 días/);
    expect(validarSemana(HORARIO_POR_DEFECTO.map((d, i) => (i === 2 ? { ...d, entrada: '8:00' } : d)))).toMatch(/miércoles.*HH:mm/);
    expect(validarSemana(HORARIO_POR_DEFECTO.map((d, i) => (i === 0 ? { ...d, entrada: '22:00', salida: '06:00' } : d)))).toMatch(/lunes.*posterior/);
    // un día libre no se valida por sus horas
    expect(validarSemana(HORARIO_POR_DEFECTO.map((d, i) => (i === 6 ? { trabaja: false, entrada: '08:00', salida: '08:00' } : d)))).toBeNull();
  });

  it('el ajuste: tolerancia de 5 a 20 min, ventana de 0 a 120 min y nunca menor que la tolerancia', () => {
    expect(validarAjuste(AJUSTE_POR_DEFECTO)).toBeNull();
    expect(validarAjuste({ toleranciaMin: 4, ventanaMin: 60 })).toMatch(/tolerancia/);
    expect(validarAjuste({ toleranciaMin: 21, ventanaMin: 60 })).toMatch(/tolerancia/);
    expect(validarAjuste({ toleranciaMin: 10, ventanaMin: 121 })).toMatch(/ventana/);
    expect(validarAjuste({ toleranciaMin: 10, ventanaMin: 5 })).toMatch(/menor que la tolerancia/);
    expect(validarAjuste({ toleranciaMin: 10, ventanaMin: 1.5 })).toMatch(/ventana/);
  });
});

describe('fechas y versiones', () => {
  it('el día de la semana empieza en lunes', () => {
    expect(indiceDiaSemana('2031-03-10')).toBe(0); // lunes
    expect(indiceDiaSemana('2031-03-16')).toBe(6); // domingo
    expect(sumarDias('2031-03-31', 1)).toBe('2031-04-01');
  });

  it('rige la versión más reciente que no pase del día; a igual fecha, la última guardada', () => {
    const v = [
      { id: 'a', vigenteDesde: '2031-03-01', createdAt: '2031-02-28T10:00:00Z' },
      { id: 'b', vigenteDesde: '2031-03-10', createdAt: '2031-03-09T10:00:00Z' },
      { id: 'c', vigenteDesde: '2031-03-10', createdAt: '2031-03-09T12:00:00Z' },
      { id: 'd', vigenteDesde: '2031-04-01', createdAt: '2031-03-20T10:00:00Z' },
    ];
    expect(versionVigente(v, '2031-02-01')).toBeNull();
    expect(versionVigente(v, '2031-03-05')?.id).toBe('a');
    expect(versionVigente(v, '2031-03-10')?.id).toBe('c');
    expect(versionVigente(v, '2031-03-31')?.id).toBe('c');
    expect(versionVigente(v, '2031-04-01')?.id).toBe('d');
  });
});

describe('resolverMarca: entrada en la mañana y salida en la tarde', () => {
  it('de 00:00 a 11:59 es entrada y de 12:00 a 23:59 es salida, a cualquier hora', () => {
    for (const hora of ['00:00', '05:00', '08:10', '11:59']) expect(resolverMarca(DIA, h(hora), NADA)).toEqual({ ok: true, tipo: 'ENTRADA' });
    for (const hora of ['12:00', '15:00', '20:30', '23:59']) expect(resolverMarca(DIA, h(hora), NADA)).toEqual({ ok: true, tipo: 'SALIDA' });
    expect(ventanasDe()).toEqual({ entrada: { desde: '00:00', hasta: '11:59' }, salida: { desde: '12:00', hasta: '23:59' } });
  });

  it('un día libre no se puede timbrar', () => {
    expect(resolverMarca({ ...DIA, trabaja: false }, h('08:00'), NADA)).toMatchObject({ ok: false, motivo: 'DIA_LIBRE' });
  });

  it('una sola entrada y una sola salida por día', () => {
    expect(resolverMarca(DIA, h('10:00'), { entrada: true, salida: false })).toMatchObject({ ok: false, motivo: 'YA_REGISTRADA', mensaje: expect.stringContaining('desde las 12:00') });
    expect(resolverMarca(DIA, h('15:05'), { entrada: true, salida: true })).toMatchObject({ ok: false, motivo: 'YA_REGISTRADA', mensaje: 'Ya registraste tu salida de hoy.' });
  });

  it('los 10 minutos de gracia: con 08:00, a las 08:10 está a tiempo y a las 08:11 atrasado; igual antes y en la salida', () => {
    expect(puntualidadDe(h('08:10'), h('08:00'), 10)).toBe('A_TIEMPO');
    expect(puntualidadDe(h('08:11'), h('08:00'), 10)).toBe('ATRASADO');
    expect(puntualidadDe(h('07:50'), h('08:00'), 10)).toBe('A_TIEMPO');
    expect(puntualidadDe(h('07:49'), h('08:00'), 10)).toBe('MUY_ANTES');
    expect(puntualidadDe(h('16:50'), h('17:00'), 10)).toBe('A_TIEMPO');
    expect(puntualidadDe(h('16:49'), h('17:00'), 10)).toBe('MUY_ANTES');
    expect(puntualidadDe(h('17:10'), h('17:00'), 10)).toBe('A_TIEMPO');
    expect(puntualidadDe(h('17:11'), h('17:00'), 10)).toBe('ATRASADO');
  });

  it('no se puede guardar un horario que no se podría marcar', () => {
    expect(problemaDeMediodia('13:00', '18:00')).toContain('antes de las 12:00');
    expect(problemaDeMediodia('08:00', '11:30')).toContain('desde las 12:00');
    expect(problemaDeMediodia('08:00', '17:00')).toBeNull();
  });
});

describe('evaluarDia', () => {
  const ev = (entrada: string | null, salida: string | null, extra: Record<string, unknown> = {}) =>
    evaluarDia({ dia: DIA, ajuste: AJUSTE_POR_DEFECTO, entradaMin: entrada ? h(entrada) : null, salidaMin: salida ? h(salida) : null, ...extra });

  it('cumple si entra y sale dentro de ±10 min, con las dos cifras de horas', () => {
    const r = ev('08:07', '14:55');
    expect(r).toMatchObject({ estado: 'CUMPLE', observaciones: [], minutosEntrada: 7, minutosSalida: -5, horasReales: 6.8, horasDentroHorario: 6.8 });
    expect(ev('07:50', '15:10').estado).toBe('CUMPLE');
  });

  it('atraso: entra más de 10 min tarde; las horas dentro del horario descuentan el atraso', () => {
    const r = ev('08:40', '15:00');
    expect(r).toMatchObject({ estado: 'ATRASO', minutosEntrada: 40, horasReales: 6.33, horasDentroHorario: 6.33 });
  });

  it('entrada temprana: las horas reales suben pero las del horario no', () => {
    const r = ev('07:00', '15:00');
    expect(r).toMatchObject({ estado: 'ENTRADA_TEMPRANA', horasReales: 8, horasDentroHorario: 7 });
  });

  it('salida anticipada y salida tardía', () => {
    expect(ev('08:00', '13:30')).toMatchObject({ estado: 'SALIDA_ANTICIPADA', minutosSalida: -90, horasReales: 5.5, horasDentroHorario: 5.5 });
    expect(ev('08:00', '16:30')).toMatchObject({ estado: 'SALIDA_TARDIA', horasReales: 8.5, horasDentroHorario: 7 });
  });

  it('un día puede traer más de una observación; el estado es la primera', () => {
    expect(ev('08:30', '16:30')).toMatchObject({ estado: 'ATRASO', observaciones: ['ATRASO', 'SALIDA_TARDIA'] });
  });

  it('la tolerancia es la configurada', () => {
    const ajuste = { toleranciaMin: 20, ventanaMin: 120 };
    expect(evaluarDia({ dia: DIA, ajuste, entradaMin: h('08:18'), salidaMin: h('15:00') }).estado).toBe('CUMPLE');
    expect(evaluarDia({ dia: DIA, ajuste, entradaMin: h('08:21'), salidaMin: h('15:00') }).estado).toBe('ATRASO');
  });

  it('sin marcas: Sin marca; con una sola: Incompleto y sin horas calculadas', () => {
    expect(ev(null, null)).toMatchObject({ estado: 'SIN_MARCA', horasReales: null });
    expect(ev('08:00', null)).toMatchObject({ estado: 'INCOMPLETO', horasReales: null, horasDentroHorario: null, entradaReal: '08:00' });
    expect(ev(null, '15:00')).toMatchObject({ estado: 'INCOMPLETO', horasReales: null, salidaReal: '15:00' });
  });

  it('el atraso cuenta aunque falte la salida', () => {
    expect(ev('08:30', null)).toMatchObject({ estado: 'INCOMPLETO', observaciones: ['ATRASO'], puntualidadEntrada: 'ATRASADO', puntualidadSalida: null });
    expect(ev('08:30', null, { ahoraMin: h('09:00') })).toMatchObject({ estado: 'EN_CURSO', puntualidadEntrada: 'ATRASADO' });
    expect(ev('08:00', '15:00')).toMatchObject({ puntualidadEntrada: 'A_TIEMPO', puntualidadSalida: 'A_TIEMPO' });
  });

  it('hoy no se da por faltante lo que todavía puede marcarse', () => {
    expect(ev(null, null, { ahoraMin: h('09:30') }).estado).toBe('PENDIENTE');
    expect(ev(null, null, { ahoraMin: h('11:59') }).estado).toBe('PENDIENTE');
    expect(ev(null, null, { ahoraMin: h('12:00') }).estado).toBe('SIN_MARCA');
    expect(ev('08:00', null, { ahoraMin: h('12:00') }).estado).toBe('EN_CURSO');
    expect(ev('08:00', null, { ahoraMin: h('23:30') }).estado).toBe('EN_CURSO'); // la salida se puede marcar hasta el final del día
    expect(ev('08:00', null).estado).toBe('INCOMPLETO'); // ya pasó el día
  });

  it('día libre y días sin horario no se evalúan', () => {
    expect(evaluarDia({ dia: { ...DIA, trabaja: false }, ajuste: AJUSTE_POR_DEFECTO, entradaMin: null, salidaMin: null }).estado).toBe('DIA_LIBRE');
    expect(evaluarDia({ dia: null, ajuste: null, entradaMin: null, salidaMin: null }).estado).toBe('SIN_HORARIO');
    // Sin horario pero con marca: se muestra el registro, sin juzgarlo (antes quedaba oculto y la timbrada «no salía»).
    const conMarca = evaluarDia({ dia: null, ajuste: null, entradaMin: null, salidaMin: h('13:58') });
    expect(conMarca.estado).toBe('REGISTRADO');
    expect(conMarca.salidaReal).toBe('13:58');
    expect(conMarca.observaciones).toEqual([]);
    expect(evaluarDia({ dia: DIA, ajuste: null, entradaMin: null, salidaMin: null }).estado).toBe('SIN_HORARIO');
  });
});

describe('fines de semana activados solo por fecha', () => {
  it('reconoce sábados y domingos y nada más', () => {
    expect(esFinDeSemana('2026-11-28')).toBe(true); // sábado
    expect(esFinDeSemana('2026-11-29')).toBe(true); // domingo
    expect(esFinDeSemana('2026-11-27')).toBe(false); // viernes
    expect(esFinDeSemana('2026-11-30')).toBe(false); // lunes
  });

  it('rechaza fechas con mala forma o que no existen', () => {
    expect(esFechaValida('2026-11-28')).toBe(true);
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(esFechaValida('28/11/2026')).toBe(false);
    expect(esFechaValida('')).toBe(false);
  });
});
