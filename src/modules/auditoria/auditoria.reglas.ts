/**
 * Reglas puras de la auditoría (sin base de datos): de qué pantalla es una ruta, qué rutas son cambios (y no consultas), cómo se limpian
 * los datos antes de guardarlos y quién ve qué fila.
 */

/** Rutas que se ignoran: la sesión, las notificaciones, la sincronización, los archivos y la propia auditoría. */
const PREFIJOS_IGNORADOS = new Set(['auth', 'notifications', 'sync', 'storage', 'archivado', 'analytics', 'auditoria', 'reportes']);

/**
 * El sistema usa POST también para listar y consultar. Un POST se considera un cambio solo si el último tramo de la ruta empieza con
 * uno de estos verbos; PUT, PATCH y DELETE siempre lo son.
 */
const VERBOS_DE_CAMBIO =
  /^(create|crear|nuevo|add|agregar|update|actualizar|edit|editar|modificar|delete|eliminar|borrar|remove|quitar|toggle|activar|desactivar|set|fijar|save|guardar|assign|asignar|reasignar|cancelar|anular|revisar|completar|finalizar|iniciar|pausar|reanudar|registrar|despachar|recibir|ajustar|aprobar|rechazar|decidir|subir|upload|trasladar|transferir|programar|resolver|reportar|devolver|firmar|cerrar|abrir|restablecer|password|cambiar|marcar|timbrar|entregar|ingreso|ingresar|importar|sincronizar|enviar|confirmar|liberar|vincular|desvincular)/i;

/** Rutas de consulta que aunque empiecen con un verbo de cambio no lo son (p. ej. `reasignar` no, pero `asignables` sí empieza con «asignar»). */
const NO_SON_CAMBIOS = /^(asignables|asignadas|asignaciones|registrados|registro|registros|iniciales|abiertas|abiertos|cerradas|cerrados)$/i;

export interface RutaAuditada {
  /** Controlador (primer tramo, sin `api/v1`). */
  prefijo: string;
  /** Resto de la ruta. */
  resto: string;
}

/** Parte `/api/v1/agencias/usuarios/update?x=1` en prefijo y resto. */
export function partirRuta(url: string): RutaAuditada {
  const limpia = String(url || '').split('?')[0].replace(/^\/+/, '').replace(/^api\/v\d+\//, '');
  const [prefijo = '', ...resto] = limpia.split('/');
  return { prefijo, resto: resto.join('/') };
}

export function esCambio(metodo: string, url: string): boolean {
  const { prefijo, resto } = partirRuta(url);
  if (PREFIJOS_IGNORADOS.has(prefijo)) return false;
  const m = metodo.toUpperCase();
  if (m === 'PUT' || m === 'PATCH' || m === 'DELETE') return true;
  if (m !== 'POST') return false;
  const ultimo = resto.split('/').filter(Boolean).pop() ?? '';
  return VERBOS_DE_CAMBIO.test(ultimo) && !NO_SON_CAMBIOS.test(ultimo);
}

/**
 * Pantalla del sistema (código de `modulos_sistema`) a la que pertenece una ruta; null si no se audita. De ella depende quién ve la fila:
 * solo los roles que tienen esa pantalla activa.
 */
export function moduloDeRuta(url: string): string | null {
  const { prefijo, resto } = partirRuta(url);
  const primero = resto.split('/')[0] ?? '';
  switch (prefijo) {
    case 'agencias':
      if (primero === 'usuarios') return 'usuarios';
      if (primero === 'operadores') return 'operadores';
      return 'agencias';
    case 'roles':
      return 'usuarios';
    case 'operaciones':
      return primero === 'catalogos' ? 'configuracion/servicios' : 'servicios';
    case 'catalogos':
      return 'configuracion/servicios';
    case 'aprobaciones':
      return 'aprobaciones';
    case 'inventario':
      return primero === 'despachos' ? 'envios' : 'inventario';
    case 'maquinaria':
      return ['incidentes', 'mantenimientos', 'limpiezas'].includes(primero) ? 'taller-tecnico' : 'maquinaria';
    case 'retos':
      return 'productividad';
    case 'informes-inspeccion':
      return 'informes-inspeccion';
    case 'auditorias-5s':
      return 'auditorias-5s';
    case 'sellos-jefe-taller':
      return 'configuracion/sellos';
    case 'rrhh':
      return primero === 'tareas' ? 'rrhh/tareas' : 'rrhh/timbradas';
    case 'dotaciones':
      return 'rrhh/dotaciones';
    default:
      return null;
  }
}

// ───────────────────────── Datos que se guardan ─────────────────────────

const CLAVES_SECRETAS = /pass|contrase|token|secret|clave|authorization|cookie|hash|firma|signature|pin|otp|apikey|api_key|credential/i;
const MAX_TEXTO = 300;
const MAX_ELEMENTOS = 20;
const MAX_PROFUNDIDAD = 4;

/**
 * Copia del valor lista para guardar: sin contraseñas ni datos secretos (por el nombre del campo), con textos y listas recortados y sin
 * archivos en base64. Nunca falla: lo que no se puede copiar se omite.
 */
export function limpiarDatos(valor: unknown, profundidad = 0): unknown {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string') {
    if (/^data:[^;]+;base64,/.test(valor)) return '[archivo]';
    return valor.length > MAX_TEXTO ? `${valor.slice(0, MAX_TEXTO)}…` : valor;
  }
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (valor instanceof Date) return valor.toISOString();
  if (profundidad >= MAX_PROFUNDIDAD) return '[…]';
  if (Array.isArray(valor)) {
    const copia = valor.slice(0, MAX_ELEMENTOS).map((v) => limpiarDatos(v, profundidad + 1));
    return valor.length > MAX_ELEMENTOS ? [...copia, `… y ${valor.length - MAX_ELEMENTOS} más`] : copia;
  }
  if (typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      salida[k] = CLAVES_SECRETAS.test(k) ? '[oculto]' : limpiarDatos(v, profundidad + 1);
    }
    return salida;
  }
  return null;
}

/** Id de la entidad que se cambió, si el cuerpo lo trae. */
export function entidadDeCuerpo(cuerpo: unknown): { tipo: string | null; id: string | null } {
  if (!cuerpo || typeof cuerpo !== 'object') return { tipo: null, id: null };
  const c = cuerpo as Record<string, unknown>;
  const id = [c.id, c.userId, c.usuarioId, c.agenciaId, c.bodegaId, c.roleId].find((v) => typeof v === 'string' || typeof v === 'number');
  const tipo = c.id !== undefined ? 'registro' : c.userId !== undefined || c.usuarioId !== undefined ? 'usuario' : c.agenciaId !== undefined ? 'agencia' : null;
  return { tipo, id: id === undefined ? null : String(id) };
}

/** Frase corta de lo que pasó, a partir del permiso que se ejercía o, si no hay, del método y la ruta. */
export function resumenDe(accion: string | null, metodo: string, url: string): string {
  const { prefijo, resto } = partirRuta(url);
  const ruta = [prefijo, ...resto.split('/').filter(Boolean)].join(' › ');
  return accion ? `${accion} (${ruta})` : `${metodo.toUpperCase()} ${ruta}`;
}

// ───────────────────────── Quién ve qué ─────────────────────────

export type AlcanceFila = { tipo: 'GLOBAL' } | { tipo: 'REGION'; regionId: string } | { tipo: 'AGENCIA'; agenciaId: string } | { tipo: 'PROPIO'; userId: string } | { tipo: 'NINGUNO' };

/** Filtro de Prisma sobre `RegistroAuditoria` según las pantallas activas del rol y el alcance de quien consulta. */
export function whereVisibles(modulos: readonly string[], alcance: AlcanceFila): Record<string, unknown> {
  const base = { modulo: { in: [...modulos] } };
  switch (alcance.tipo) {
    case 'GLOBAL':
      return base;
    case 'REGION':
      return { ...base, regionId: alcance.regionId };
    case 'AGENCIA':
      return { ...base, agenciaId: alcance.agenciaId };
    case 'PROPIO':
      return { ...base, actorId: alcance.userId };
    default:
      return { id: { in: [] as string[] } };
  }
}
