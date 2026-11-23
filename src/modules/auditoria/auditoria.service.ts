import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { resolverAlcance } from '../../common/permisos/alcance.js';
import { tienePermiso } from '../../common/permisos/capacidades.js';
import { modulosDeCapacidades } from '../../common/permisos/modulos-navegacion.js';
import { apellidosNombres } from '../../common/utils/nombre-persona.js';
import { limpiarDatos, whereVisibles, type AlcanceFila } from './auditoria.reglas.js';
import type { ListarAuditoriaDto } from './dto/auditoria.dto.js';

/** Pantallas cuyos cambios se auditan, con el nombre que se muestra. */
export const MODULOS_AUDITADOS: Readonly<Record<string, string>> = {
  agencias: 'Agencias y mapa',
  operadores: 'Lavadores',
  'configuracion/servicios': 'Catálogo de servicios',
  servicios: 'Servicios de lavado',
  aprobaciones: 'Aprobaciones',
  productividad: 'Productividad y retos',
  maquinaria: 'Maquinaria',
  'taller-tecnico': 'Taller técnico',
  inventario: 'Inventario',
  envios: 'Envíos',
  'informes-inspeccion': 'Informes de inspección',
  'auditorias-5s': 'Auditorías 5S',
  'configuracion/sellos': 'Sellos de jefe de taller',
  'rrhh/tareas': 'Tareas de RRHH',
  'rrhh/timbradas': 'Timbradas y horarios',
  'rrhh/dotaciones': 'Dotaciones',
  usuarios: 'Usuarios y roles',
};

/** Tope de filas de una exportación. */
export const MAX_FILAS_EXPORTACION = 5000;

export interface EntradaAuditoria {
  modulo: string;
  accion: string;
  metodo: string;
  ruta: string;
  resumen: string;
  entidadTipo?: string | null;
  entidadId?: string | null;
  antes?: unknown;
  despues?: unknown;
  datos?: unknown;
  agenciaId?: string | null;
  regionId?: string | null;
  ip?: string | null;
}

const nombreRol = (user: any): string => String(user?.roleDetails?.namerol ?? user?.role?.namerol ?? '');
const capacidadesDe = (user: any): string[] => (user?.roleDetails?.capacidades ?? user?.role?.capacidades ?? []) as string[];

@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Dónde está quien actúa (agencia y región), para que cada rol vea solo su alcance. */
  private ubicacionDe(user: any): { agenciaId: string | null; regionId: string | null } {
    return {
      agenciaId: user?.agenciaId ?? null,
      regionId: user?.regionId ?? user?.agencia?.regionId ?? user?.agencia?.region?.id ?? user?.bodega?.regionId ?? null,
    };
  }

  /**
   * Deja constancia de un cambio. Nunca interrumpe lo que se estaba haciendo: si no se puede guardar, solo se avisa en el log.
   * `antes` y `despues` son los valores del cambio; los datos secretos (contraseñas, tokens) se ocultan siempre.
   */
  async registrar(entrada: EntradaAuditoria, actor: any): Promise<void> {
    try {
      if (!actor?.id) return;
      const ubicacion = this.ubicacionDe(actor);
      await this.prisma.registroAuditoria.create({
        data: {
          actorId: String(actor.id),
          actorNombre: apellidosNombres(actor) || String(actor.email ?? actor.id),
          actorRol: nombreRol(actor),
          modulo: entrada.modulo,
          accion: entrada.accion,
          metodo: entrada.metodo,
          ruta: entrada.ruta,
          entidadTipo: entrada.entidadTipo ?? null,
          entidadId: entrada.entidadId ?? null,
          resumen: entrada.resumen.slice(0, 300),
          antes: (limpiarDatos(entrada.antes) ?? undefined) as Prisma.InputJsonValue | undefined,
          despues: (limpiarDatos(entrada.despues) ?? undefined) as Prisma.InputJsonValue | undefined,
          datos: (limpiarDatos(entrada.datos) ?? undefined) as Prisma.InputJsonValue | undefined,
          agenciaId: entrada.agenciaId ?? ubicacion.agenciaId,
          regionId: entrada.regionId ?? ubicacion.regionId,
          ip: entrada.ip ?? null,
        },
      });
    } catch (e: any) {
      this.logger.warn(`No se pudo registrar la auditoría: ${e?.message || e}`);
    }
  }

  // ───────────────────────── Consulta ─────────────────────────

  /** Pantallas de la auditoría que el rol de este usuario puede ver: las que tiene activas. */
  modulosVisibles(user: any): string[] {
    return modulosDeCapacidades(capacidadesDe(user), nombreRol(user)).filter((m) => m in MODULOS_AUDITADOS);
  }

  private alcanceFila(user: any): AlcanceFila {
    const a = resolverAlcance(user);
    return a.tipo === 'GLOBAL' || a.tipo === 'REGION' || a.tipo === 'AGENCIA' || a.tipo === 'PROPIO' ? a : { tipo: 'NINGUNO' };
  }

  private where(dto: ListarAuditoriaDto, user: any): Prisma.RegistroAuditoriaWhereInput {
    const visibles = this.modulosVisibles(user);
    // Un módulo pedido que el rol no tiene activo no se concede: se reduce a lo permitido.
    const modulos = dto.modulo ? visibles.filter((m) => m === dto.modulo) : visibles;
    const filtros: Prisma.RegistroAuditoriaWhereInput[] = [whereVisibles(modulos, this.alcanceFila(user)) as Prisma.RegistroAuditoriaWhereInput];
    const rango: Prisma.DateTimeFilter = {};
    if (dto.desde) rango.gte = new Date(`${dto.desde}T00:00:00-05:00`);
    if (dto.hasta) rango.lt = new Date(new Date(`${dto.hasta}T00:00:00-05:00`).getTime() + 86_400_000);
    if (rango.gte || rango.lt) filtros.push({ createdAt: rango });
    if (dto.actor?.trim()) filtros.push({ actorNombre: { contains: dto.actor.trim(), mode: 'insensitive' } });
    if (dto.texto?.trim()) {
      const t = dto.texto.trim();
      filtros.push({ OR: [{ resumen: { contains: t, mode: 'insensitive' } }, { accion: { contains: t, mode: 'insensitive' } }] });
    }
    return { AND: filtros };
  }

  /** Los datos que el rol no puede ver en otras pantallas (cédula, correo, teléfono) tampoco salen aquí. */
  private ocultarSensibles(valor: unknown, user: any): unknown {
    const verCedula = tienePermiso(user, 'datos.cedula.ver');
    const verContacto = tienePermiso(user, 'datos.contacto.ver');
    if (verCedula && verContacto) return valor;
    const recorrer = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(recorrer);
      if (v && typeof v === 'object') {
        return Object.fromEntries(
          Object.entries(v as Record<string, unknown>).map(([k, x]) => {
            if (!verCedula && /cedula/i.test(k)) return [k, '[sin permiso]'];
            if (!verContacto && /(telefono|celular|correo|email)/i.test(k)) return [k, '[sin permiso]'];
            return [k, recorrer(x)];
          }),
        );
      }
      return v;
    };
    return recorrer(valor);
  }

  private presentar(f: any, user: any) {
    return {
      id: f.id,
      fecha: f.createdAt,
      actor: f.actorNombre,
      rol: f.actorRol,
      modulo: f.modulo,
      moduloNombre: MODULOS_AUDITADOS[f.modulo] ?? f.modulo,
      accion: f.accion,
      resumen: f.resumen,
      entidadTipo: f.entidadTipo,
      entidadId: f.entidadId,
      antes: this.ocultarSensibles(f.antes, user),
      despues: this.ocultarSensibles(f.despues, user),
      datos: this.ocultarSensibles(f.datos, user),
    };
  }

  /** Quién hizo qué y cuándo, dentro de lo que el rol puede ver. */
  async listar(dto: ListarAuditoriaDto, user: any) {
    const pagina = dto.pagina ?? 1;
    const tamano = dto.tamano ?? 50;
    const where = this.where(dto, user);
    const [total, filas] = await Promise.all([
      this.prisma.registroAuditoria.count({ where }),
      this.prisma.registroAuditoria.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (pagina - 1) * tamano, take: tamano }),
    ]);
    // Cada consulta nueva (no cada página) queda en la bitácora.
    if (pagina === 1) await this.registrarConsulta(user, 'CONSULTA', dto, total);
    return { total, pagina, tamano, filas: filas.map((f) => this.presentar(f, user)) };
  }

  /** Pantallas que puede filtrar quien consulta. */
  opciones(user: any) {
    return { modulos: this.modulosVisibles(user).map((m) => ({ valor: m, etiqueta: MODULOS_AUDITADOS[m] })) };
  }

  /** Las filas de una exportación (hasta el tope) y su constancia en la bitácora. */
  async exportar(dto: ListarAuditoriaDto, formato: 'EXCEL' | 'PDF', user: any) {
    const where = this.where(dto, user);
    const filas = await this.prisma.registroAuditoria.findMany({ where, orderBy: { createdAt: 'desc' }, take: MAX_FILAS_EXPORTACION });
    await this.registrarConsulta(user, formato, dto, filas.length);
    return { total: filas.length, recortado: filas.length >= MAX_FILAS_EXPORTACION, filas: filas.map((f) => this.presentar(f, user)) };
  }

  // ───────────────────────── Bitácora de consultas ─────────────────────────

  private async registrarConsulta(user: any, tipo: 'CONSULTA' | 'EXCEL' | 'PDF', dto: ListarAuditoriaDto, filas: number): Promise<void> {
    try {
      const { pagina: _p, tamano: _t, ...filtros } = dto;
      await this.prisma.consultaAuditoria.create({
        data: {
          userId: String(user.id),
          userNombre: apellidosNombres(user) || String(user.email ?? user.id),
          userRol: nombreRol(user),
          tipo,
          filtros: (limpiarDatos(filtros) ?? undefined) as Prisma.InputJsonValue | undefined,
          filas,
        },
      });
    } catch (e: any) {
      this.logger.warn(`No se pudo registrar la consulta de auditoría: ${e?.message || e}`);
    }
  }

  /** Quién consultó o exportó la auditoría (solo con el permiso de la bitácora). */
  async bitacora(user: any, limite = 200) {
    if (!tienePermiso(user, 'auditoria.bitacora')) throw new ForbiddenException('Tu rol no puede ver quién consultó la auditoría.');
    const filas = await this.prisma.consultaAuditoria.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limite, 1), 500) });
    return filas.map((f) => ({ id: f.id, fecha: f.createdAt, usuario: f.userNombre, rol: f.userRol, tipo: f.tipo, filtros: f.filtros, filas: f.filas }));
  }
}
