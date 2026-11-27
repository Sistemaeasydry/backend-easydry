/**
 * Reglas puras de los horarios del personal (sin base de datos): qué horario rige un día, en qué ventana se puede timbrar,
 * si una marca es Entrada o Salida y cómo se evalúa el cumplimiento de un día.
 *
 * Los horarios y los ajustes son versiones inmutables con una fecha de inicio: un cambio rige desde mañana y los días pasados se
 * evalúan siempre con la versión que regía ese día.
 */

/** Lunes = 0 … domingo = 6. */
export const DIAS_SEMANA = 7;
export const NOMBRES_DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;

export interface DiaHorario {
  /** false = día libre: no se puede timbrar y no genera registro. */
  trabaja: boolean;
  /** HH:mm */
  entrada: string;
  /** HH:mm */
  salida: string;
}
export type SemanaHorario = DiaHorario[];

/** Horario con el que parte todo el personal: 08:00 a 17:00 los siete días. */
export const HORARIO_POR_DEFECTO: SemanaHorario = Array.from({ length: DIAS_SEMANA }, () => ({ trabaja: true, entrada: '08:00', salida: '17:00' }));
/** Horario por defecto anterior (08:00 a 15:00): rigió hasta el día anterior a `HORARIO_POR_DEFECTO_DESDE`. */
export const HORARIO_POR_DEFECTO_ANTERIOR: SemanaHorario = Array.from({ length: DIAS_SEMANA }, () => ({ trabaja: true, entrada: '08:00', salida: '15:00' }));
/**
 * Primer día en que rige el horario por defecto de 08:00 a 17:00 (desde antes de que existiera RRHH en producción: en la práctica rige
 * siempre). Los días anteriores, que solo existen en bases de desarrollo, se siguen evaluando con 08:00 a 15:00: un cambio de horario
 * solo rige hacia adelante y nunca reevalúa lo ya evaluado.
 */
export const HORARIO_POR_DEFECTO_DESDE = '2026-11-01';
/** El horario por defecto que regía ese día (AAAA-MM-DD). */
export const horarioPorDefectoDe = (dia: string): SemanaHorario => (dia >= HORARIO_POR_DEFECTO_DESDE ? HORARIO_POR_DEFECTO : HORARIO_POR_DEFECTO_ANTERIOR);

export interface AjusteHorario {
  /** Minutos de gracia antes y después de la hora del horario: dentro de ellos la marca es puntual. */
  toleranciaMin: number;
  /** Minutos antes y después de la hora del horario en los que se puede timbrar. Fuera de la ventana no se deja timbrar. */
  ventanaMin: number;
}

export const TOLERANCIA_MIN_PERMITIDA = 5;
export const TOLERANCIA_MAX_PERMITIDA = 20;
export const TOLERANCIA_POR_DEFECTO = 10;
export const VENTANA_MIN_PERMITIDA = 0;
export const VENTANA_MAX_PERMITIDA = 120;
export const VENTANA_POR_DEFECTO = 120;
export const AJUSTE_POR_DEFECTO: AjusteHorario = { toleranciaMin: TOLERANCIA_POR_DEFECTO, ventanaMin: VENTANA_POR_DEFECTO };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const aMinutos = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const aHHMM = (minutos: number): string => {
  const m = ((Math.round(minutos) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Antes de este minuto una marca es la Entrada; desde él, la Salida. */
export const MEDIODIA_MIN = 12 * 60;

/** Un horario tiene que poder marcarse: la entrada antes del mediodía y la salida desde el mediodía. */
export function problemaDeMediodia(entrada: string, salida: string): string | null {
  if (aMinutos(entrada) >= MEDIODIA_MIN) return 'la entrada debe ser antes de las 12:00 (desde el mediodía las marcas cuentan como salida).';
  if (aMinutos(salida) < MEDIODIA_MIN) return 'la salida debe ser desde las 12:00 (antes del mediodía las marcas cuentan como entrada).';
  return null;
}

/** Valida una semana de horario; devuelve el mensaje del primer problema o null si está bien. */
export function validarSemana(semana: unknown): string | null {
  if (!Array.isArray(semana) || semana.length !== DIAS_SEMANA) return 'El horario debe traer los 7 días de la semana (lunes a domingo).';
  for (let i = 0; i < DIAS_SEMANA; i++) {
    const d = semana[i] as Partial<DiaHorario> | null;
    if (!d || typeof d.trabaja !== 'boolean' || typeof d.entrada !== 'string' || typeof d.salida !== 'string') return `El ${NOMBRES_DIA[i]} no tiene un horario válido.`;
    if (!HHMM.test(d.entrada) || !HHMM.test(d.salida)) return `El ${NOMBRES_DIA[i]} debe tener horas en formato HH:mm.`;
    if (d.trabaja && aMinutos(d.entrada) >= aMinutos(d.salida)) return `El ${NOMBRES_DIA[i]}: la salida debe ser posterior a la entrada (no se admiten turnos que cruzan la medianoche).`;
    const fueraDeSuMitad = d.trabaja ? problemaDeMediodia(d.entrada, d.salida) : null;
    if (fueraDeSuMitad) return `El ${NOMBRES_DIA[i]}: ${fueraDeSuMitad}`;
  }
  return null;
}

/** Valida el ajuste general; devuelve el mensaje del primer problema o null si está bien. */
export function validarAjuste(a: Partial<AjusteHorario>): string | null {
  const { toleranciaMin: t, ventanaMin: v } = a;
  if (!Number.isInteger(t) || (t as number) < TOLERANCIA_MIN_PERMITIDA || (t as number) > TOLERANCIA_MAX_PERMITIDA) {
    return `La tolerancia debe ser un número entero de minutos entre ${TOLERANCIA_MIN_PERMITIDA} y ${TOLERANCIA_MAX_PERMITIDA}.`;
  }
  if (!Number.isInteger(v) || (v as number) < VENTANA_MIN_PERMITIDA || (v as number) > VENTANA_MAX_PERMITIDA) {
    return `La ventana de timbrada debe ser un número entero de minutos entre ${VENTANA_MIN_PERMITIDA} y ${VENTANA_MAX_PERMITIDA}.`;
  }
  if ((v as number) < (t as number)) return 'La ventana de timbrada no puede ser menor que la tolerancia.';
  return null;
}

// ───────────────────────── Fechas ─────────────────────────

/** Índice del día de la semana de un `AAAA-MM-DD` (lunes = 0 … domingo = 6). */
export function indiceDiaSemana(dia: string): number {
  return (new Date(`${dia}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

/** Sábado o domingo (un `AAAA-MM-DD`). */
export const esFinDeSemana = (dia: string): boolean => indiceDiaSemana(dia) >= 5;

/** Fecha con forma AAAA-MM-DD que existe en el calendario. */
export const esFechaValida = (dia: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(dia) && !Number.isNaN(Date.parse(`${dia}T00:00:00.000Z`)) && new Date(`${dia}T00:00:00.000Z`).toISOString().slice(0, 10) === dia;

/** Cuántas fechas de fin de semana se pueden activar de una vez y hasta cuántos días hacia adelante. */
export const FINES_DE_SEMANA_MAX_POR_VEZ = 8;
export const FINES_DE_SEMANA_MAX_DIAS_ADELANTE = 180;

export function sumarDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ───────────────────────── Versiones ─────────────────────────

export interface Versionado {
  vigenteDesde: Date | string;
  createdAt: Date | string;
}
const diaDe = (v: Date | string): string => (typeof v === 'string' ? v : v.toISOString()).slice(0, 10);

/** La versión que rige un día: la de fecha de inicio más reciente que no pase de ese día (a igual fecha, la última que se guardó). */
export function versionVigente<T extends Versionado>(versiones: readonly T[], dia: string): T | null {
  let mejor: T | null = null;
  for (const v of versiones) {
    if (diaDe(v.vigenteDesde) > dia) continue;
    if (!mejor) { mejor = v; continue; }
    const a = diaDe(v.vigenteDesde);
    const b = diaDe(mejor.vigenteDesde);
    if (a > b || (a === b && new Date(v.createdAt).getTime() >= new Date(mejor.createdAt).getTime())) mejor = v;
  }
  return mejor;
}

// ───────────────────────── Qué marca es ─────────────────────────

export type TipoMarca = 'ENTRADA' | 'SALIDA';

export interface Ventanas {
  entrada: { desde: string; hasta: string };
  salida: { desde: string; hasta: string };
}

/** Franjas en las que cada marca se registra: la mañana es Entrada y la tarde, Salida. */
export function ventanasDe(): Ventanas {
  return { entrada: { desde: '00:00', hasta: '11:59' }, salida: { desde: '12:00', hasta: '23:59' } };
}

/**
 * Marca de quien NO está obligado a timbrar: sin ventana ni horario que la limite. La primera del día es la Entrada y la segunda la Salida;
 * no hay más de una de cada tipo por día.
 */
export function resolverMarcaVoluntaria(ya: { entrada: boolean; salida: boolean }): ResultadoMarca {
  if (!ya.entrada) return { ok: true, tipo: 'ENTRADA' };
  if (!ya.salida) return { ok: true, tipo: 'SALIDA' };
  return { ok: false, motivo: 'YA_REGISTRADA', mensaje: 'Ya registraste tu entrada y tu salida de hoy.' };
}

export type ResultadoMarca =
  | { ok: true; tipo: TipoMarca }
  | { ok: false; motivo: 'DIA_LIBRE' | 'YA_REGISTRADA'; mensaje: string };

/**
 * Decide si una marca es Entrada o Salida por la hora: de 00:00 a 11:59 es Entrada y de 12:00 a 23:59 es Salida. Se puede timbrar a
 * cualquier hora de un día de trabajo; la puntualidad se evalúa aparte. Nunca hay más de una marca de cada tipo por día.
 */
export function resolverMarca(dia: DiaHorario, minutoActual: number, ya: { entrada: boolean; salida: boolean }): ResultadoMarca {
  if (!dia.trabaja) return { ok: false, motivo: 'DIA_LIBRE', mensaje: 'Hoy no es un día de trabajo en tu horario, así que no se puede timbrar.' };
  const tipo: TipoMarca = minutoActual < MEDIODIA_MIN ? 'ENTRADA' : 'SALIDA';
  if (tipo === 'ENTRADA' ? ya.entrada : ya.salida) {
    return {
      ok: false,
      motivo: 'YA_REGISTRADA',
      mensaje: tipo === 'ENTRADA' ? 'Ya registraste tu entrada de hoy. La salida se marca desde las 12:00.' : 'Ya registraste tu salida de hoy.',
    };
  }
  return { ok: true, tipo };
}

/** Cómo quedó una marca frente a la hora del horario, con los minutos de gracia hacia los dos lados. */
export type Puntualidad = 'A_TIEMPO' | 'MUY_ANTES' | 'ATRASADO';

export function puntualidadDe(minutoMarca: number, minutoHorario: number, toleranciaMin: number): Puntualidad {
  if (minutoMarca < minutoHorario - toleranciaMin) return 'MUY_ANTES';
  return minutoMarca > minutoHorario + toleranciaMin ? 'ATRASADO' : 'A_TIEMPO';
}

// ───────────────────────── Evaluación del día ─────────────────────────

export type EstadoDia =
  | 'SIN_HORARIO' // el día es anterior a que existan horarios, o a que la persona existiera
  | 'DIA_LIBRE'
  | 'PENDIENTE' // hoy y aún no termina la ventana de entrada
  | 'EN_CURSO' // hoy, con entrada, y aún no termina la ventana de salida
  | 'SIN_MARCA' // día laboral sin ninguna marca
  | 'INCOMPLETO' // falta la entrada o la salida
  | 'CUMPLE'
  | 'ATRASO'
  | 'ENTRADA_TEMPRANA'
  | 'SALIDA_ANTICIPADA'
  | 'SALIDA_TARDIA'
  | 'NO_OBLIGATORIO' // el rol no está obligado a timbrar y ese día no marcó
  | 'REGISTRADO'; // el rol no está obligado a timbrar y marcó: solo se muestra la hora y si fue antes o después de su horario

export interface EvaluacionDia {
  estado: EstadoDia;
  /** Todo lo que se salió del horario (un día puede tener, por ejemplo, atraso y salida tardía). */
  observaciones: EstadoDia[];
  horario: { entrada: string; salida: string } | null;
  entradaReal: string | null;
  salidaReal: string | null;
  /** Estado de cada marca frente al horario; null si no hay marca o ese día no se juzga (libre, sin horario, timbrada voluntaria). */
  puntualidadEntrada: Puntualidad | null;
  puntualidadSalida: Puntualidad | null;
  /** Minutos respecto a la hora del horario: positivo = después, negativo = antes. */
  minutosEntrada: number | null;
  minutosSalida: number | null;
  /** Tiempo trabajado en horas. Una marca dentro de la tolerancia cuenta como la hora exacta del horario. */
  horasReales: number | null;
  /** Lo mismo, contando solo lo que cae dentro del horario. */
  horasDentroHorario: number | null;
  /** Minutos marcados después de la hora de salida del horario (todos, también dentro de la tolerancia); null sin salida o en día libre. */
  minutosDespuesSalida: number | null;
}

const horas = (minutos: number) => Math.round((minutos / 60) * 100) / 100;

const VACIA: Omit<EvaluacionDia, 'estado' | 'observaciones'> = {
  horario: null, entradaReal: null, salidaReal: null, puntualidadEntrada: null, puntualidadSalida: null, minutosEntrada: null, minutosSalida: null, horasReales: null, horasDentroHorario: null, minutosDespuesSalida: null,
};

export interface EntradaEvaluacion {
  /** null = no había horario ese día (antes de la activación o de que existiera la persona). */
  dia: DiaHorario | null;
  ajuste: AjusteHorario | null;
  /** Minuto del día (hora de Ecuador) de cada marca. */
  entradaMin: number | null;
  salidaMin: number | null;
  /** Solo para hoy: el minuto actual, para no dar por faltante lo que todavía puede marcarse. */
  ahoraMin?: number | null;
  /** false = el rol no está obligado a timbrar: no hay evaluación de cumplimiento, solo el registro de las marcas. Por defecto true. */
  obligatoria?: boolean;
}

export function evaluarDia(x: EntradaEvaluacion): EvaluacionDia {
  const { dia, ajuste, entradaMin, salidaMin } = x;
  const base = { ...VACIA, entradaReal: entradaMin != null ? aHHMM(entradaMin) : null, salidaReal: salidaMin != null ? aHHMM(salidaMin) : null };
  // Sin horario ese día no hay con qué comparar, pero si la persona marcó, la marca se muestra (solo el registro, sin juicio).
  if (!dia || !ajuste) return { ...base, estado: entradaMin != null || salidaMin != null ? 'REGISTRADO' : 'SIN_HORARIO', observaciones: [] };

  const e = aMinutos(dia.entrada);
  const s = aMinutos(dia.salida);
  const comunes = { ...base, horario: { entrada: dia.entrada, salida: dia.salida } };
  // Para contar horas, una marca dentro de la tolerancia vale como la hora del horario (08:07 cuenta desde las 08:00). La salida
  // posterior a esa tolerancia cuenta tal cual. La hora real de cada marca se sigue mostrando.
  const contada = (marca: number, hora: number) => (dia.trabaja && Math.abs(marca - hora) <= ajuste.toleranciaMin ? hora : marca);
  const tramo = entradaMin != null && salidaMin != null && salidaMin > entradaMin ? { desde: contada(entradaMin, e), hasta: contada(salidaMin, s) } : null;
  const realesMin = tramo ? Math.max(0, tramo.hasta - tramo.desde) : null;
  const dentroMin = tramo ? Math.max(0, Math.min(tramo.hasta, s) - Math.max(tramo.desde, e)) : null;
  const con = {
    ...comunes,
    minutosEntrada: entradaMin != null ? entradaMin - e : null,
    minutosSalida: salidaMin != null ? salidaMin - s : null,
    horasReales: realesMin != null ? horas(realesMin) : null,
    horasDentroHorario: dentroMin != null ? horas(dentroMin) : null,
    minutosDespuesSalida: dia.trabaja && salidaMin != null ? Math.max(0, salidaMin - s) : null,
  };

  if (x.obligatoria === false) {
    if (entradaMin == null && salidaMin == null) return { ...comunes, estado: 'NO_OBLIGATORIO', observaciones: [] };
    // Solo se informa si marcó antes de la hora de entrada de su horario (los minutos de diferencia van aparte); no hay atraso que cumplir.
    return { ...con, estado: 'REGISTRADO', observaciones: entradaMin != null && entradaMin < e ? ['ENTRADA_TEMPRANA'] : [] };
  }
  if (!dia.trabaja) return { ...con, estado: 'DIA_LIBRE', observaciones: [] };
  if (entradaMin == null && salidaMin == null) {
    if (x.ahoraMin != null && x.ahoraMin < MEDIODIA_MIN) return { ...comunes, estado: 'PENDIENTE', observaciones: [] };
    return { ...comunes, estado: 'SIN_MARCA', observaciones: [] };
  }
  const t = ajuste.toleranciaMin;
  const puntualidadEntrada = entradaMin != null ? puntualidadDe(entradaMin, e, t) : null;
  const puntualidadSalida = salidaMin != null ? puntualidadDe(salidaMin, s, t) : null;
  const juzgado = { ...con, puntualidadEntrada, puntualidadSalida };
  // Cada marca se juzga por sí sola: un atraso cuenta aunque falte la salida.
  const observaciones: EstadoDia[] = [];
  if (puntualidadEntrada === 'ATRASADO') observaciones.push('ATRASO');
  if (puntualidadSalida === 'MUY_ANTES') observaciones.push('SALIDA_ANTICIPADA');
  if (puntualidadEntrada === 'MUY_ANTES') observaciones.push('ENTRADA_TEMPRANA');
  if (puntualidadSalida === 'ATRASADO') observaciones.push('SALIDA_TARDIA');
  if (entradaMin == null || salidaMin == null) {
    // Hoy, con la entrada marcada, la salida se puede registrar hasta el final del día.
    const enCurso = entradaMin != null && x.ahoraMin != null;
    return { ...juzgado, estado: enCurso ? 'EN_CURSO' : 'INCOMPLETO', observaciones };
  }
  return { ...juzgado, estado: observaciones[0] ?? 'CUMPLE', observaciones };
}
