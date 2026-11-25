import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { HorariosService } from './horarios.service.js';
import { resolverAlcance } from '../../common/permisos/alcance.js';
import { FUNCION, tieneAlgunaFuncion, tieneFuncion } from '../../common/permisos/funciones.js';
import type { ConsultarTimbradasDto, RegistrarTimbradaDto } from './dto/rrhh.dto.js';
import { resolverMarca, resolverMarcaVoluntaria } from './rrhh.horarios.js';
import {
  diaComoFecha,
  evaluarUbicacion,
  fechaEnEcuador,
  precisionMaxPorOrigen,
  radioPorOrigen,
  whereUsuariosEnAlcance,
  sinReferencia,
  type ModoTimbrada,
  type OrigenTimbrada,
  type SitioReferencia,
} from './rrhh.reglas.js';
import { apellidosNombres } from '../../common/utils/nombre-persona.js';

/** Días que se devuelven por defecto y tope de la consulta. */
const DIAS_POR_DEFECTO = 14;
const DIAS_MAXIMO = 93;
const FILAS_MAXIMAS = 5000;

const dia = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Timbradas del personal. La hora y el día los pone el servidor (Ecuador). Si la marca es Entrada o Salida lo decide el horario de la
 * persona (la hora a la que cae más cerca, dentro de la ventana); fuera de las ventanas o en un día libre no se deja timbrar. Una de cada una por día. La foto es siempre de cámara. El personal de bodega debe estar dentro del radio de su bodega;
 * lavadores, auxiliares, líderes y backup, dentro del de su agencia; los demás roles, dentro del de cualquier agencia con ubicación.
 * Una marca no se edita ni se borra.
 */
@Injectable()
export class TimbradasService {
  private readonly logger = new Logger(TimbradasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly horarios: HorariosService,
  ) {}

  /** La obligación de timbrar es una casilla del rol («Timbrada obligatoria»). Sin ella timbrar es voluntario: no hay ventana, evaluación ni avisos. */
  private esObligatoria(user: any): boolean {
    const caps = user?.roleDetails?.capacidades ?? user?.role?.capacidades;
    return Array.isArray(caps) && caps.includes('rrhh.timbrada.obligatoria');
  }

  /**
   * Contra qué sitio se valida cada rol. Manda la categoría del rol (la que se configura en «Roles y permisos»):
   *  - ADMINISTRACION: en cualquier agencia con ubicación guardada (y el personal de bodega, además, en su bodega).
   *  - OPERADOR: solo en su agencia asignada. El técnico, que trabaja en varias agencias, en cualquiera de su región.
   * Si el rol no trae categoría (sesiones antiguas, pruebas con roles armados a mano) se decide por el nombre del rol, como antes.
   */
  /** Pulidor móvil = pulidor sin agencia asignada (el fijo siempre tiene una). */
  private esPulidorMovil(user: any): boolean {
    return tieneFuncion(user, FUNCION.PULIDOR) && !user?.agenciaId;
  }

  private modoDe(user: any): ModoTimbrada {
    const categoria = user?.roleDetails?.categoria ?? user?.role?.categoria;
    if (categoria === 'ADMINISTRACION') return 'CUALQUIER_AGENCIA';
    if (categoria === 'OPERADOR') return tieneFuncion(user, FUNCION.TECNICO) || this.esPulidorMovil(user) ? 'CUALQUIER_AGENCIA' : 'AGENCIA_ASIGNADA';
    if (tieneAlgunaFuncion(user, [FUNCION.COORD_BODEGA, FUNCION.ASISTENTE_BODEGA])) return 'BODEGA';
    if (tieneFuncion(user, FUNCION.PULIDOR)) return user?.agenciaId ? 'AGENCIA_ASIGNADA' : 'CUALQUIER_AGENCIA';
    if (tieneAlgunaFuncion(user, [FUNCION.LAVADOR, FUNCION.AUXILIAR, FUNCION.LIDER, FUNCION.BACKUP, FUNCION.LIDER_AGENCIA])) return 'AGENCIA_ASIGNADA';
    return 'CUALQUIER_AGENCIA';
  }

  /** Sitios contra los que se valida la marca de este usuario, con su ubicación. */
  private async sitiosDe(user: any, modo: ModoTimbrada = this.modoDe(user)): Promise<SitioReferencia[]> {
    const aSitio = (a: { id: string; nombre: string; regionId: string | null; latitud: number | null; longitud: number | null; radioTimbradaM: number }, tipo: 'AGENCIA' | 'BODEGA'): SitioReferencia =>
      ({ tipo, id: a.id, nombre: a.nombre, regionId: a.regionId, latitud: a.latitud, longitud: a.longitud, radioM: a.radioTimbradaM });
    const campos = { id: true, nombre: true, regionId: true, latitud: true, longitud: true, radioTimbradaM: true } as const;

    if (modo === 'BODEGA') {
      if (!user.bodegaId) return [];
      const b = await this.prisma.bodega.findUnique({ where: { id: user.bodegaId }, select: campos });
      return b ? [aSitio(b, 'BODEGA')] : [];
    }
    if (modo === 'AGENCIA_ASIGNADA') {
      if (!user.agenciaId) return [];
      const a = await this.prisma.agencia.findUnique({ where: { id: user.agenciaId }, select: campos });
      return a ? [aSitio(a, 'AGENCIA')] : [];
    }
    // Cualquier agencia: solo cuentan las activas con ubicación guardada; si ninguna la tiene, no se puede timbrar.
    // El técnico (rol operador con categoría) solo en las de su región; sin región asignada no tiene dónde timbrar.
    // El pulidor móvil (sin agencia) se valida igual que el técnico: en las agencias con ubicación de su región.
    const soloSuRegion = this.esPulidorMovil(user) || ((user?.roleDetails?.categoria ?? user?.role?.categoria) === 'OPERADOR' && tieneFuncion(user, FUNCION.TECNICO));
    if (soloSuRegion && !user.regionId) return [];
    const agencias = await this.prisma.agencia.findMany({
      where: { estado: 1, latitud: { not: null }, longitud: { not: null }, ...(soloSuRegion ? { regionId: user.regionId } : {}) },
      select: campos,
    });
    const sitios = agencias.map((a) => aSitio(a, 'AGENCIA'));
    // El personal de bodega de categoría administración también puede timbrar en su bodega.
    if (user?.bodegaId && tieneAlgunaFuncion(user, [FUNCION.COORD_BODEGA, FUNCION.ASISTENTE_BODEGA])) {
      const b = await this.prisma.bodega.findUnique({ where: { id: user.bodegaId }, select: campos });
      if (b) sitios.push(aSitio(b, 'BODEGA'));
    }
    return sitios;
  }

  /** Lo que la pantalla necesita para timbrar: la hora del servidor, lo que ya marcó hoy y si debe mandar ubicación. */
  async estado(user: any, origen: OrigenTimbrada = 'APP') {
    const ahora = new Date();
    const f = fechaEnEcuador(ahora);
    const modo = this.modoDe(user);
    const obligatoria = this.esObligatoria(user);
    const [sitios, marcas, hoy] = await Promise.all([
      this.sitiosDe(user, modo),
      this.prisma.timbrada.findMany({ where: { userId: String(user.id), fechaDia: diaComoFecha(f.dia) }, orderBy: { marcadaEn: 'asc' } }),
      this.horarios.resumenHoy(String(user.id), ahora),
    ]);
    // Qué marca correspondería ahora según el horario: null si hoy es día libre o está fuera de las ventanas.
    const yaMarcado = { entrada: marcas.some((m) => m.tipo === 'ENTRADA'), salida: marcas.some((m) => m.tipo === 'SALIDA') };
    const siguiente = obligatoria ? resolverMarca(hoy.horario, hoy.ajuste, f.hora * 60 + f.minuto, yaMarcado) : resolverMarcaVoluntaria(yaMarcado);
    // Sin una agencia o bodega con ubicación contra la cual validar tampoco se puede timbrar.
    const sinRef = sinReferencia(sitios, modo);
    return {
      ahora: ahora.toISOString(),
      dia: f.dia,
      tipoActual: siguiente.ok ? siguiente.tipo : null,
      puedeTimbrar: siguiente.ok && !sinRef,
      motivoBloqueo: siguiente.ok ? (sinRef?.mensaje ?? null) : siguiente.mensaje,
      horario: { trabaja: hoy.horario.trabaja, entrada: hoy.horario.entrada, salida: hoy.horario.salida },
      obligatoria,
      ventanas: obligatoria ? hoy.ventanas : null,
      toleranciaMin: hoy.ajuste.toleranciaMin,
      ventanaMin: hoy.ajuste.ventanaMin,
      marcasHoy: marcas.map((m) => ({ id: m.id, tipo: m.tipo, marcadaEn: m.marcadaEn, verificacion: m.verificacion, distanciaM: m.distanciaM })),
      // La ubicación se exige siempre: hay que estar dentro del radio de un sitio permitido.
      exigeUbicacion: true,
      precisionMaxM: precisionMaxPorOrigen(origen),
      modo,
      radioM: radioPorOrigen(origen),
      // En «cualquier agencia» no se listan todas las agencias: basta el radio.
      sitios: (modo === 'CUALQUIER_AGENCIA' ? [] : sitios).map((s) => ({ tipo: s.tipo, nombre: s.nombre, radioM: radioPorOrigen(origen), tieneUbicacion: s.latitud != null && s.longitud != null })),
    };
  }

  async registrar(dto: RegistrarTimbradaDto, user: any) {
    const userId = String(user.id);
    const ahora = new Date();
    const f = fechaEnEcuador(ahora);
    const fechaDia = diaComoFecha(f.dia);

    // Entrada o Salida lo decide el horario: la hora del horario a la que cae más cerca, dentro de la ventana. Fuera de ella no se deja timbrar.
    const [contexto, previas] = await Promise.all([
      this.horarios.contextoDe(userId, f.dia),
      this.prisma.timbrada.findMany({ where: { userId, fechaDia }, select: { tipo: true } }),
    ]);
    const ya = { entrada: previas.some((m) => m.tipo === 'ENTRADA'), salida: previas.some((m) => m.tipo === 'SALIDA') };
    const obligatoria = this.esObligatoria(user);
    const resolucion = obligatoria ? resolverMarca(contexto.dia, contexto.ajuste, f.hora * 60 + f.minuto, ya) : resolverMarcaVoluntaria(ya);
    if (!resolucion.ok) {
      const Excepcion = resolucion.motivo === 'YA_REGISTRADA' ? ConflictException : BadRequestException;
      throw new Excepcion({ message: resolucion.mensaje, codigo: resolucion.motivo });
    }
    const tipo = resolucion.tipo;

    // La foto debe ser una imagen subida por esta misma persona y no haberse usado en otra marca.
    const foto = await this.storage.inspectEvidence(dto.fotoUrl, { prefix: `rrhh/timbradas/${userId}/` });
    if (foto.kind !== 'IMAGEN') throw new BadRequestException('La evidencia de la timbrada debe ser una foto.');
    if (await this.prisma.timbrada.findFirst({ where: { fotoKey: foto.key }, select: { id: true } })) {
      throw new BadRequestException('Esa foto ya se usó en otra marca. Toma una foto nueva con la cámara.');
    }

    const sitios = await this.sitiosDe(user);
    const evaluacion = evaluarUbicacion(sitios, { latitud: dto.latitud, longitud: dto.longitud, precisionM: dto.precisionM }, dto.origen, this.modoDe(user));
    if (!evaluacion.ok) {
      // Un sitio sin ubicación es algo que un administrador debe arreglar: se le avisa una vez por sitio y por día.
      if (evaluacion.motivo === 'SIN_REFERENCIA' && evaluacion.sitioSinUbicacion?.length) void this.avisarUbicacionFaltante(evaluacion.sitioSinUbicacion, f.dia);
      throw new BadRequestException({ message: evaluacion.mensaje, codigo: evaluacion.motivo });
    }

    const regionId = evaluacion.sitio.regionId ?? user.regionId ?? user.agencia?.regionId ?? user.bodega?.regionId ?? null;
    let creada;
    try {
      creada = await this.prisma.timbrada.create({
        data: {
          userId,
          tipo,
          fechaDia,
          marcadaEn: ahora,
          horaDispositivo: dto.horaDispositivo ? new Date(dto.horaDispositivo) : null,
          origen: dto.origen,
          fotoKey: foto.key,
          latitud: dto.latitud ?? null,
          longitud: dto.longitud ?? null,
          precisionM: dto.precisionM ?? null,
          verificacion: evaluacion.verificacion,
          agenciaId: evaluacion.sitio.tipo === 'AGENCIA' ? evaluacion.sitio.id : null,
          bodegaId: evaluacion.sitio.tipo === 'BODEGA' ? evaluacion.sitio.id : null,
          regionId,
          distanciaM: evaluacion.distanciaM,
          radioM: evaluacion.radioM,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(tipo === 'ENTRADA' ? 'Ya registraste tu entrada de hoy.' : 'Ya registraste tu salida de hoy.');
      throw e;
    }

    // Una salida sin entrada se acepta, pero el día queda incompleto: se avisa a la persona y a los administradores.
    if (obligatoria && tipo === 'SALIDA' && !ya.entrada) void this.horarios.avisarSalidaSinEntrada(userId, f.dia);

    return {
      id: creada.id,
      tipo: creada.tipo,
      marcadaEn: creada.marcadaEn,
      verificacion: creada.verificacion,
      distanciaM: creada.distanciaM,
      radioM: creada.radioM,
      sitio: { tipo: evaluacion.sitio.tipo, nombre: evaluacion.sitio.nombre },
      mensaje: `${tipo === 'ENTRADA' ? 'Entrada' : 'Salida'} registrada a ${Math.round(evaluacion.distanciaM)} m de ${evaluacion.sitio.nombre}.`,
    };
  }

  /** Avisa a los administradores, una vez por sitio y por día, que falta configurar su ubicación. */
  private async avisarUbicacionFaltante(sitios: SitioReferencia[], diaHoy: string): Promise<void> {
    try {
      const admins = await this.prisma.user.findMany({ where: { estado: 1, role: { capacidades: { has: 'rrhh.ubicaciones.gestionar' } } }, select: { id: true } });
      if (!admins.length) return;
      const desde = diaComoFecha(diaHoy);
      for (const sitio of sitios) {
        const yaAvisado = await this.prisma.notification.findFirst({
          where: { tipo: 'UBICACION_FALTANTE', entidadId: sitio.id, createdAt: { gte: desde } },
          select: { id: true },
        });
        if (yaAvisado) continue;
        await this.notifications.notificarUsuarios(
          admins.map((a) => a.id),
          'Falta la ubicación de un sitio',
          `Hay personal timbrando en ${sitio.nombre} sin una ubicación de referencia. Configúrala para validar las marcas.`,
          { sitioTipo: sitio.tipo, sitioId: sitio.id },
          { tipo: 'UBICACION_FALTANTE', entidadTipo: sitio.tipo, entidadId: sitio.id },
        );
      }
    } catch (e: any) {
      this.logger.warn(`No se pudo avisar la ubicación faltante: ${e?.message || e}`);
    }
  }

  private rango(dto: ConsultarTimbradasDto): { desde: Date; hasta: Date } {
    const hoy = diaComoFecha(fechaEnEcuador(new Date()).dia);
    const hasta = dto.hasta ? diaComoFecha(dto.hasta) : hoy;
    const desde = dto.desde ? diaComoFecha(dto.desde) : new Date(hasta.getTime() - (DIAS_POR_DEFECTO - 1) * 86_400_000);
    if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) throw new BadRequestException('Las fechas no son válidas.');
    if (desde > hasta) throw new BadRequestException('La fecha inicial no puede ser posterior a la final.');
    if ((hasta.getTime() - desde.getTime()) / 86_400_000 + 1 > DIAS_MAXIMO) throw new BadRequestException(`El rango no puede pasar de ${DIAS_MAXIMO} días.`);
    return { desde, hasta };
  }

  /** Historial propio. */
  async mias(dto: ConsultarTimbradasDto, user: any) {
    const { desde, hasta } = this.rango(dto);
    const filas = await this.prisma.timbrada.findMany({
      where: { userId: String(user.id), fechaDia: { gte: desde, lte: hasta } },
      orderBy: [{ fechaDia: 'desc' }, { marcadaEn: 'asc' }],
      take: FILAS_MAXIMAS,
    });
    const presentadas = await this.presentar(filas, new Map([[String(user.id), { id: String(user.id), nombre: user.nombre ?? apellidosNombres(user), rol: user.roleDetails?.namerol ?? '' }]]));
    const evaluacion = await this.horarios.evaluar([{ id: String(user.id), createdAt: user.createdAt ? new Date(user.createdAt) : new Date(0), obligatoria: this.esObligatoria(user) }], desde, hasta, filas);
    return { ...presentadas, evaluacion };
  }

  /** Timbradas de las personas dentro del alcance de quien consulta. */
  async equipo(dto: ConsultarTimbradasDto, user: any) {
    const { desde, hasta } = this.rango(dto);
    const alcance = resolverAlcance(user);
    const personas = await this.prisma.user.findMany({
      where: { ...(whereUsuariosEnAlcance(alcance) as object), ...(dto.userId ? { id: dto.userId } : {}) },
      select: { id: true, name: true, lastname: true, createdAt: true, role: { select: { namerol: true, capacidades: true } } },
    });
    if (!personas.length) return { filas: [], personas: [], evaluacion: [] };
    const filas = await this.prisma.timbrada.findMany({
      where: { userId: { in: personas.map((p) => p.id) }, fechaDia: { gte: desde, lte: hasta } },
      orderBy: [{ fechaDia: 'desc' }, { marcadaEn: 'asc' }],
      take: FILAS_MAXIMAS,
    });
    const mapa = new Map(personas.map((p) => [p.id, { id: p.id, nombre: apellidosNombres(p), rol: p.role?.namerol ?? '', obligatoria: !!p.role?.capacidades?.includes('rrhh.timbrada.obligatoria') }]));
    const resultado = await this.presentar(filas, mapa);
    // Se evalúa a todos: quien tiene la timbrada obligatoria, contra su horario; quien no, solo con el registro de sus marcas («No obligatorio timbrar»).
    const evaluacion = await this.horarios.evaluar(personas.map((p) => ({ id: p.id, createdAt: p.createdAt, obligatoria: !!p.role?.capacidades?.includes('rrhh.timbrada.obligatoria') })), desde, hasta, filas);
    return { ...resultado, personas: [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)), evaluacion };
  }

  private async presentar(filas: any[], personas: Map<string, { id: string; nombre: string; rol: string }>) {
    const agenciaIds = [...new Set(filas.map((f) => f.agenciaId).filter(Boolean))] as string[];
    const bodegaIds = [...new Set(filas.map((f) => f.bodegaId).filter(Boolean))] as string[];
    const [agencias, bodegas] = await Promise.all([
      agenciaIds.length ? this.prisma.agencia.findMany({ where: { id: { in: agenciaIds } }, select: { id: true, nombre: true } }) : [],
      bodegaIds.length ? this.prisma.bodega.findMany({ where: { id: { in: bodegaIds } }, select: { id: true, nombre: true } }) : [],
    ]);
    const nombreSitio = new Map<string, string>([...agencias, ...bodegas].map((s) => [s.id, s.nombre]));
    return {
      filas: filas.map((f) => ({
        id: f.id,
        userId: f.userId,
        persona: personas.get(f.userId)?.nombre ?? '',
        rol: personas.get(f.userId)?.rol ?? '',
        tipo: f.tipo,
        dia: dia(f.fechaDia),
        marcadaEn: f.marcadaEn,
        horaDispositivo: f.horaDispositivo,
        origen: f.origen,
        fotoKey: f.fotoKey,
        latitud: f.latitud,
        longitud: f.longitud,
        precisionM: f.precisionM,
        verificacion: f.verificacion,
        sitio: f.agenciaId ? { tipo: 'AGENCIA', nombre: nombreSitio.get(f.agenciaId) ?? '' } : f.bodegaId ? { tipo: 'BODEGA', nombre: nombreSitio.get(f.bodegaId) ?? '' } : null,
        distanciaM: f.distanciaM,
        radioM: f.radioM,
      })),
    };
  }
}
