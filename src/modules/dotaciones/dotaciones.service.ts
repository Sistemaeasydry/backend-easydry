import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { diaComoFecha, fechaEnEcuador } from '../rrhh/rrhh.reglas.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { tienePermiso } from '../../common/permisos/capacidades.js';
import {
  agruparPorAgencia,
  claveDestino,
  estadoVisible,
  leerTallas,
  normalizarTallas,
  siguienteEntrega,
  type TallaEntregada,
  MAX_BYTES_EVIDENCIA_DOTACION,
  MAX_EVIDENCIAS_DOTACION,
  compararEntregas,
  momentoDeEntrega,
  personaEnPlan,
  ROLES_SIN_DOTACION,
  type ModoEntrega,
} from './dotaciones.reglas.js';
import type {
  CrearEntregasDto,
  EstadoPlanDto,
  GuardarCategoriaDto,
  GuardarPlanDto,
  GuardarProductoDto,
  IngresoStockDto,
  ListarEntregasDto,
  OmitirEntregaDto,
  ReasignarEntregaDto,
  RegistrarEntregaDto,
} from './dto/dotaciones.dto.js';
import { apellidosNombres } from '../../common/utils/nombre-persona.js';

const nombreDe = (u: { name: string; lastname: string }) => apellidosNombres(u);
const dia = (d: Date) => d.toISOString().slice(0, 10);
/** Un nombre eliminado queda libre para volver a usarse; en el historial se ve marcado como eliminado. */
const nombreEliminado = (nombre: string, id: string) => `${nombre} (eliminado ${id.slice(0, 4)})`;

const INCLUIR_PLAN = { items: { include: { producto: { select: { nombre: true } } } } } satisfies Prisma.PlanDotacionInclude;

const INCLUIR_ENTREGA = {
  plan: { select: { id: true, nombre: true, tipo: true, cadaMeses: true } },
  persona: { select: { id: true, name: true, lastname: true, role: { select: { namerol: true } }, agencia: { select: { nombre: true } } } },
  items: {
    include: {
      producto: {
        select: { nombre: true, stock: true, usaTallas: true, tallas: { orderBy: { orden: 'asc' as const } }, categoria: { select: { nombre: true } } },
      },
    },
  },
  evidencias: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.EntregaDotacionInclude;

type PlanCompleto = Prisma.PlanDotacionGetPayload<{ include: typeof INCLUIR_PLAN }>;
type EntregaCompleta = Prisma.EntregaDotacionGetPayload<{ include: typeof INCLUIR_ENTREGA }>;

@Injectable()
export class DotacionesService {
  private readonly logger = new Logger(DotacionesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Optional() private readonly notificaciones?: NotificationsService,
  ) {}

  private async unico<T>(accion: () => Promise<T>, mensaje: string): Promise<T> {
    try {
      return await accion();
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException(mensaje);
      throw e;
    }
  }

  // ───────────────────────── Categorías y productos ─────────────────────────

  async listarCategorias() {
    const categorias = await this.prisma.categoriaDotacion.findMany({
      where: { eliminadoEn: null },
      orderBy: { nombre: 'asc' },
      include: { _count: { select: { productos: { where: { eliminadoEn: null } } } } },
    });
    return categorias.map((c) => ({ id: c.id, nombre: c.nombre, activa: c.activa, productos: c._count.productos }));
  }

  async guardarCategoria(dto: GuardarCategoriaDto) {
    const nombre = dto.nombre.trim();
    if (!nombre) throw new BadRequestException('Escribe el nombre de la categoría.');
    return this.unico(async () => {
      if (dto.id) {
        const existe = await this.prisma.categoriaDotacion.findUnique({ where: { id: dto.id } });
        if (!existe || existe.eliminadoEn) throw new NotFoundException('La categoría no existe.');
        return this.prisma.categoriaDotacion.update({ where: { id: dto.id }, data: { nombre, ...(dto.activa === undefined ? {} : { activa: dto.activa }) } });
      }
      return this.prisma.categoriaDotacion.create({ data: { nombre } });
    }, 'Ya existe una categoría con ese nombre.');
  }

  async eliminarCategoria(id: string) {
    const categoria = await this.prisma.categoriaDotacion.findUnique({ where: { id }, include: { _count: { select: { productos: { where: { eliminadoEn: null } } } } } });
    if (!categoria || categoria.eliminadoEn) throw new NotFoundException('La categoría no existe.');
    if (categoria._count.productos) throw new BadRequestException('La categoría tiene productos: elimínalos o cámbialos de categoría primero.');
    await this.prisma.categoriaDotacion.update({ where: { id }, data: { eliminadoEn: new Date(), activa: false, nombre: nombreEliminado(categoria.nombre, id) } });
    return { id };
  }

  async listarProductos() {
    const productos = await this.prisma.productoDotacion.findMany({
      where: { eliminadoEn: null },
      orderBy: [{ categoria: { nombre: 'asc' } }, { nombre: 'asc' }],
      include: { categoria: { select: { id: true, nombre: true } }, tallas: { orderBy: { orden: 'asc' } } },
    });
    return productos.map((p) => ({
      id: p.id, nombre: p.nombre, categoriaId: p.categoriaId, categoria: p.categoria.nombre, stock: p.stock, activo: p.activo,
      usaTallas: p.usaTallas, tallas: p.tallas.map((t) => ({ nombre: t.nombre, stock: t.stock })),
    }));
  }

  async guardarProducto(dto: GuardarProductoDto) {
    const nombre = dto.nombre.trim();
    if (!nombre) throw new BadRequestException('Escribe el nombre del producto.');
    const categoria = await this.prisma.categoriaDotacion.findUnique({ where: { id: dto.categoriaId } });
    if (!categoria || categoria.eliminadoEn) throw new BadRequestException('La categoría no existe.');
    return this.unico(
      () =>
        this.prisma.$transaction(async (tx) => {
          const antes = dto.id ? await tx.productoDotacion.findUnique({ where: { id: dto.id }, include: { tallas: true } }) : null;
          if (dto.id && (!antes || antes.eliminadoEn)) throw new NotFoundException('El producto no existe.');
          const usaTallas = dto.usaTallas ?? antes?.usaTallas ?? false;
          // El stock nunca se edita aquí: solo cambia con ingresos y entregas.
          const data = { nombre, categoriaId: dto.categoriaId, usaTallas, ...(dto.activo === undefined ? {} : { activo: dto.activo }) };
          const producto = antes ? await tx.productoDotacion.update({ where: { id: antes.id }, data }) : await tx.productoDotacion.create({ data });
          await this.guardarTallas(tx, producto, antes, dto);
          return producto;
        }),
      'Ya existe un producto con ese nombre en esa categoría.',
    );
  }

  /**
   * Deja las tallas del producto como las pide la pantalla. No se puede quitar una talla con stock. Al activar las tallas en un producto
   * que ya tenía stock hay que repartirlo entre ellas; al desactivarlas el total se conserva en el producto.
   */
  private async guardarTallas(
    tx: Prisma.TransactionClient,
    producto: { id: string; stock: number; usaTallas: boolean },
    antes: { usaTallas: boolean; tallas: Array<{ id: string; nombre: string; stock: number }> } | null,
    dto: GuardarProductoDto,
  ): Promise<void> {
    if (!producto.usaTallas) {
      if (antes?.usaTallas) await tx.tallaDotacion.deleteMany({ where: { productoId: producto.id } });
      return;
    }
    if (!dto.tallas && antes?.usaTallas) return;
    const enviadas = dto.tallas ?? [];
    const nombres = normalizarTallas(enviadas.map((t) => t.nombre));
    if (!nombres.length) throw new BadRequestException('Escribe al menos una talla.');
    const activando = !antes?.usaTallas;
    const reparto = new Map(enviadas.map((t) => [t.nombre.trim().toLowerCase(), t.stock ?? 0]));
    if (activando && nombres.reduce((n, t) => n + (reparto.get(t.toLowerCase()) ?? 0), 0) !== producto.stock) {
      throw new BadRequestException(`Reparte entre las tallas las ${producto.stock} unidades que hay en stock.`);
    }
    const actuales = antes?.usaTallas ? antes.tallas : [];
    for (const t of actuales) {
      if (nombres.some((n) => n.toLowerCase() === t.nombre.toLowerCase())) continue;
      if (t.stock > 0) throw new BadRequestException(`No se puede quitar la talla «${t.nombre}»: todavía tiene ${t.stock} en stock.`);
      await tx.tallaDotacion.delete({ where: { id: t.id } });
    }
    for (const [orden, nombre] of nombres.entries()) {
      const previa = actuales.find((t) => t.nombre.toLowerCase() === nombre.toLowerCase());
      if (previa) await tx.tallaDotacion.update({ where: { id: previa.id }, data: { nombre, orden } });
      else await tx.tallaDotacion.create({ data: { productoId: producto.id, nombre, orden, stock: activando ? (reparto.get(nombre.toLowerCase()) ?? 0) : 0 } });
    }
  }

  /**
   * Deja de listarse y sale de los planes y de las entregas que aún no se hacen. Sus movimientos y las entregas ya cerradas se conservan.
   * Un plan que se queda sin productos se desactiva, y una entrega pendiente que se queda sin productos se descarta.
   */
  async eliminarProducto(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const producto = await tx.productoDotacion.findUnique({ where: { id } });
      if (!producto || producto.eliminadoEn) throw new NotFoundException('El producto no existe.');
      await tx.entregaDotacionItem.deleteMany({ where: { productoId: id, entrega: { estado: 'PENDIENTE' } } });
      await tx.entregaDotacion.deleteMany({ where: { estado: 'PENDIENTE', items: { none: {} } } });
      await tx.planDotacionItem.deleteMany({ where: { productoId: id } });
      await tx.planDotacion.updateMany({ where: { eliminadoEn: null, items: { none: {} } }, data: { activo: false } });
      await tx.productoDotacion.update({ where: { id }, data: { eliminadoEn: new Date(), activo: false, nombre: nombreEliminado(producto.nombre, id) } });
    });
    return { id };
  }

  async registrarIngreso(dto: IngresoStockDto, user: any) {
    return this.prisma.$transaction(async (tx) => {
      const producto = await tx.productoDotacion.findUnique({ where: { id: dto.productoId }, include: { tallas: true } });
      if (!producto || producto.eliminadoEn) throw new NotFoundException('El producto no existe.');
      const talla = producto.usaTallas ? producto.tallas.find((t) => t.nombre === dto.talla?.trim()) : undefined;
      if (producto.usaTallas && !talla) throw new BadRequestException('Elige la talla que ingresa.');
      if (talla) await tx.tallaDotacion.update({ where: { id: talla.id }, data: { stock: { increment: dto.cantidad } } });
      const actualizado = await tx.productoDotacion.update({ where: { id: dto.productoId }, data: { stock: { increment: dto.cantidad } } });
      await tx.movimientoDotacion.create({
        data: {
          productoId: dto.productoId, tipo: 'INGRESO', cantidad: dto.cantidad, stockDespues: actualizado.stock, talla: talla?.nombre ?? null,
          nota: dto.nota?.trim() || null, actorId: String(user.id),
        },
      });
      return { id: actualizado.id, stock: actualizado.stock };
    });
  }

  async movimientos(productoId: string) {
    const lista = await this.prisma.movimientoDotacion.findMany({ where: { productoId }, orderBy: { createdAt: 'desc' }, take: 200 });
    const actores = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(lista.map((m) => m.actorId))] } },
      select: { id: true, name: true, lastname: true },
    });
    const nombre = new Map(actores.map((a) => [a.id, apellidosNombres(a)]));
    return lista.map((m) => ({
      id: m.id, tipo: m.tipo, cantidad: m.cantidad, stockDespues: m.stockDespues, talla: m.talla, nota: m.nota, entregaId: m.entregaId,
      actor: nombre.get(m.actorId) ?? '—', creadoEn: m.createdAt,
    }));
  }

  // ───────────────────────── Planes ─────────────────────────

  private presentarPlan(p: PlanCompleto) {
    return {
      id: p.id,
      nombre: p.nombre,
      tipo: p.tipo,
      cadaMeses: p.cadaMeses,
      roles: p.roles,
      agenciasIds: p.agenciasIds,
      activo: p.activo,
      items: p.items.map((i) => ({ productoId: i.productoId, producto: i.producto.nombre, cantidad: i.cantidad })),
    };
  }

  async listarPlanes() {
    const planes = await this.prisma.planDotacion.findMany({ where: { eliminadoEn: null }, orderBy: [{ activo: 'desc' }, { createdAt: 'desc' }], include: INCLUIR_PLAN });
    return planes.map((p) => this.presentarPlan(p));
  }

  private async nombresDeCoordinadores(ids: Array<string | null>): Promise<Map<string, string>> {
    const unicos = [...new Set(ids.filter((i): i is string => !!i))];
    if (!unicos.length) return new Map();
    const usuarios = await this.prisma.user.findMany({ where: { id: { in: unicos } }, select: { id: true, name: true, lastname: true } });
    return new Map(usuarios.map((u) => [u.id, nombreDe(u)]));
  }

  /** Personas que pueden salir a entregar: las de un rol con el permiso de registrar entregas. */
  async listarCoordinadores() {
    const usuarios = await this.prisma.user.findMany({
      where: { estado: 1, role: { OR: [{ capacidades: { has: 'dotaciones.entregar' } }, { namerol: 'SUPER_ADMIN' }] } },
      select: { id: true, name: true, lastname: true, role: { select: { namerol: true } }, agencia: { select: { nombre: true } } },
    });
    return usuarios
      .map((u) => ({ id: u.id, nombre: nombreDe(u), rol: u.role.namerol, agencia: u.agencia?.nombre ?? null }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  /** Quien va a entregar debe existir, estar activo y poder registrar entregas. */
  private async exigirCoordinadorValido(id: string) {
    const c = await this.prisma.user.findUnique({ where: { id }, select: { estado: true, role: { select: { namerol: true, capacidades: true } } } });
    if (!c || c.estado !== 1) throw new BadRequestException('El coordinador elegido no existe o está inactivo.');
    if (c.role.namerol !== 'SUPER_ADMIN' && !c.role.capacidades.includes('dotaciones.entregar')) {
      throw new BadRequestException('El coordinador elegido no tiene permiso para registrar entregas de dotación.');
    }
  }

  async guardarPlan(dto: GuardarPlanDto, user: any) {
    if (dto.tipo === 'FIJO' && !dto.cadaMeses) throw new BadRequestException('Indica cada cuántos meses se repite.');
    const roles = [...new Set(dto.roles.filter((r) => !ROLES_SIN_DOTACION.includes(r)))];
    const productos = [...new Set(dto.items.map((i) => i.productoId))];
    if (productos.length !== dto.items.length) throw new BadRequestException('Un producto solo puede aparecer una vez en el plan.');
    const existentes = await this.prisma.productoDotacion.count({ where: { id: { in: productos }, activo: true } });
    if (existentes !== productos.length) throw new BadRequestException('Algún producto no existe o está inactivo.');
    const data = {
      nombre: dto.nombre.trim(),
      tipo: dto.tipo,
      cadaMeses: dto.tipo === 'FIJO' ? dto.cadaMeses! : null,
      roles,
      agenciasIds: dto.agenciasIds,
    };
    const items = dto.items.map((i) => ({ productoId: i.productoId, cantidad: i.cantidad }));
    const plan = await this.prisma.$transaction(async (tx) => {
      if (dto.id) {
        const existe = await tx.planDotacion.findUnique({ where: { id: dto.id } });
        if (!existe || existe.eliminadoEn) throw new NotFoundException('El plan no existe.');
        // Las entregas ya creadas no cambian: el plan editado rige para las que se creen o programen después.
        await tx.planDotacionItem.deleteMany({ where: { planId: dto.id } });
        return tx.planDotacion.update({ where: { id: dto.id }, data: { ...data, items: { create: items } }, include: INCLUIR_PLAN });
      }
      return tx.planDotacion.create({ data: { ...data, creadoPorId: String(user.id), items: { create: items } }, include: INCLUIR_PLAN });
    });
    return this.presentarPlan(plan);
  }

  async estadoPlan(dto: EstadoPlanDto) {
    const existe = await this.prisma.planDotacion.findUnique({ where: { id: dto.id } });
    if (!existe || existe.eliminadoEn) throw new NotFoundException('El plan no existe.');
    await this.prisma.planDotacion.update({ where: { id: dto.id }, data: { activo: dto.activo } });
    return { id: dto.id, activo: dto.activo };
  }

  /** Deja de listarse y se descartan sus entregas pendientes. Las entregas realizadas y omitidas se conservan como historial. */
  async eliminarPlan(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const plan = await tx.planDotacion.findUnique({ where: { id }, select: { eliminadoEn: true } });
      if (!plan || plan.eliminadoEn) throw new NotFoundException('El plan no existe.');
      await tx.entregaDotacion.deleteMany({ where: { planId: id, estado: 'PENDIENTE' } });
      await tx.planDotacion.update({ where: { id }, data: { eliminadoEn: new Date(), activo: false } });
    });
    return { id };
  }

  // ───────────────────────── Crear y programar entregas ─────────────────────────

  /** Personas activas que pueden recibir dotación (los roles de administración quedan fuera). */
  private personasConDotacion(db: Prisma.TransactionClient = this.prisma) {
    return db.user.findMany({
      where: { estado: 1, role: { namerol: { notIn: ROLES_SIN_DOTACION } } },
      select: { id: true, name: true, lastname: true, agenciaId: true, regionId: true, role: { select: { namerol: true } }, agencia: { select: { nombre: true } } },
    });
  }

  /** Un destino por persona o, en modo AGENCIA, uno por agencia (con las cantidades del plan por cada persona que la integra). */
  private destinosDelPlan(
    plan: { roles: string[]; agenciasIds: string[] },
    modo: ModoEntrega,
    personas: Awaited<ReturnType<DotacionesService['personasConDotacion']>>,
  ) {
    const elegibles = personas.filter((p) => personaEnPlan(plan, { rol: p.role.namerol, agenciaId: p.agenciaId }));
    return modo === 'AGENCIA'
      ? [...agruparPorAgencia(elegibles)].map(([agenciaId, grupo]) => ({
          id: agenciaId,
          personaId: null as string | null,
          clave: claveDestino(grupo[0], agenciaId, 'AGENCIA'),
          agenciaId: agenciaId as string | null,
          regionId: grupo[0].regionId,
          personas: grupo.length,
          nombre: grupo[0].agencia?.nombre ?? '—',
          rol: 'AGENCIA',
          agenciaNombre: grupo[0].agencia?.nombre ?? null,
        }))
      : elegibles.map((p) => ({
          id: p.id,
          personaId: p.id as string | null,
          clave: p.id,
          agenciaId: p.agenciaId,
          regionId: p.regionId,
          personas: 1,
          nombre: nombreDe(p),
          rol: p.role.namerol,
          agenciaNombre: p.agencia?.nombre ?? null,
        }));
  }

  private async planActivo(planId: string) {
    const plan = await this.prisma.planDotacion.findUnique({ where: { id: planId }, include: { items: true } });
    if (!plan) throw new NotFoundException('El plan no existe.');
    if (!plan.activo) throw new BadRequestException('El plan está desactivado.');
    return plan;
  }

  /** A quién se le puede crear una entrega del plan: su alcance, con la entrega que ya tenga pendiente y la última que recibió. */
  async destinosParaEntrega(planId: string) {
    const plan = await this.planActivo(planId);
    const personas = await this.personasConDotacion();
    const previas = await this.prisma.entregaDotacion.findMany({
      where: { planId, estado: { in: ['PENDIENTE', 'ENTREGADA'] } },
      select: { claveDestino: true, estado: true, fechaProgramada: true, entregadaEn: true },
      orderBy: { fechaProgramada: 'asc' },
    });
    const pendiente = new Map<string, string>();
    const ultima = new Map<string, string>();
    for (const e of previas) {
      if (e.estado === 'PENDIENTE') pendiente.set(e.claveDestino, dia(e.fechaProgramada));
      else if (e.entregadaEn) ultima.set(e.claveDestino, fechaEnEcuador(e.entregadaEn).dia);
    }
    const presentar = (modo: ModoEntrega) =>
      this.destinosDelPlan(plan, modo, personas)
        .map((d) => ({
          id: d.id, nombre: d.nombre, rol: d.rol, agencia: d.agenciaNombre, personas: d.personas,
          pendiente: pendiente.get(d.clave) ?? null, ultimaEntrega: ultima.get(d.clave) ?? null,
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return { personas: presentar('PERSONAS'), agencias: presentar('AGENCIA') };
  }

  /** Crea una entrega por destino elegido. Quien ya tiene una pendiente de ese plan no recibe otra. */
  async crearEntregas(dto: CrearEntregasDto) {
    if (dto.fecha < fechaEnEcuador(new Date()).dia) throw new BadRequestException('La fecha de la entrega debe ser hoy o futura.');
    const plan = await this.planActivo(dto.planId);
    await this.exigirCoordinadorValido(dto.coordinadorId);
    const porId = new Map(this.destinosDelPlan(plan, dto.modo, await this.personasConDotacion()).map((d) => [d.id, d]));
    const elegidos = [...new Set(dto.destinos)].map((id) => {
      const destino = porId.get(id);
      if (!destino) throw new BadRequestException('Alguno de los elegidos no entra en este plan.');
      return destino;
    });
    const resultado = await this.prisma.$transaction(
      async (tx) => {
        let creadas = 0;
        const yaPendientes: string[] = [];
        for (const d of elegidos) {
          if (await this.crearEntrega(tx, plan, d, dto.fecha, dto.coordinadorId)) creadas++;
          else yaPendientes.push(d.nombre);
        }
        return { creadas, yaPendientes };
      },
      { timeout: 60_000 },
    );
    if (resultado.creadas) {
      const n = resultado.creadas;
      await this.avisarCoordinador(dto.coordinadorId, 'Tienes entregas de dotación', `${plan.nombre}: ${n} ${n === 1 ? 'entrega' : 'entregas'} para el ${dto.fecha}.`);
    }
    return resultado;
  }

  /** Inserta la entrega si ese destino no tiene ya una pendiente del plan ni una en esa fecha. */
  private async crearEntrega(
    tx: Prisma.TransactionClient,
    plan: { id: string; items: Array<{ productoId: string; cantidad: number }> },
    destino: ReturnType<DotacionesService['destinosDelPlan']>[number],
    fecha: string,
    coordinadorId: string | null,
  ): Promise<boolean> {
    const fechaProgramada = diaComoFecha(fecha);
    const ya = await tx.entregaDotacion.findFirst({
      where: { planId: plan.id, claveDestino: destino.clave, OR: [{ estado: 'PENDIENTE' }, { fechaProgramada }] },
      select: { id: true },
    });
    if (ya) return false;
    await tx.entregaDotacion.create({
      data: {
        planId: plan.id, personaId: destino.personaId, claveDestino: destino.clave, fechaProgramada, coordinadorId,
        agenciaId: destino.agenciaId, regionId: destino.regionId,
        personasCubiertas: destino.personaId ? null : destino.personas,
        items: { create: plan.items.map((i) => ({ productoId: i.productoId, cantidadPlan: i.cantidad * destino.personas })) },
      },
    });
    return true;
  }

  /**
   * En un plan fijo activo, programa la siguiente entrega al mismo destino y coordinador contando desde `desde` (el día en que se cerró la
   * anterior). No programa nada si el destino ya no entra en el plan (persona inactiva o que cambió de rol o agencia).
   */
  private async programarSiguiente(
    tx: Prisma.TransactionClient,
    entrega: { planId: string; personaId: string | null; agenciaId: string | null; coordinadorId: string | null },
    desde: string,
  ): Promise<string | null> {
    const plan = await tx.planDotacion.findUnique({ where: { id: entrega.planId }, include: { items: true } });
    if (!plan?.activo || !plan.items.length) return null;
    const fecha = siguienteEntrega(plan, desde);
    if (!fecha) return null;
    const id = entrega.personaId ?? entrega.agenciaId;
    const destino = this.destinosDelPlan(plan, entrega.personaId ? 'PERSONAS' : 'AGENCIA', await this.personasConDotacion(tx)).find((d) => d.id === id);
    if (!destino) return null;
    return (await this.crearEntrega(tx, plan, destino, fecha, entrega.coordinadorId)) ? fecha : null;
  }

  async reasignarEntrega(dto: ReasignarEntregaDto) {
    const entrega = await this.prisma.entregaDotacion.findUnique({ where: { id: dto.entregaId }, include: { plan: { select: { nombre: true } } } });
    if (!entrega) throw new NotFoundException('La entrega no existe.');
    if (entrega.estado !== 'PENDIENTE') throw new BadRequestException('Solo se puede reasignar una entrega pendiente.');
    await this.exigirCoordinadorValido(dto.coordinadorId);
    await this.prisma.entregaDotacion.update({ where: { id: dto.entregaId }, data: { coordinadorId: dto.coordinadorId } });
    if (entrega.coordinadorId !== dto.coordinadorId) {
      await this.avisarCoordinador(dto.coordinadorId, 'Te asignaron una entrega de dotación', `${entrega.plan.nombre}: para el ${dia(entrega.fechaProgramada)}.`);
    }
    return { id: dto.entregaId, coordinadorId: dto.coordinadorId };
  }

  private async avisarCoordinador(coordinadorId: string, titulo: string, mensaje: string): Promise<void> {
    await this.notificaciones?.notificarUsuarios(
      [coordinadorId], titulo, mensaje, { type: 'DOTACION_POR_ENTREGAR' }, { tipo: 'DOTACION_POR_ENTREGAR', entidadTipo: 'ENTREGA_DOTACION' },
    );
  }

  /** Cron diario: avisa a cada coordinador de las entregas suyas que tocan hoy. Devuelve cuántas entregas se avisaron. */
  async avisarEntregasDelDia(ahora = new Date()): Promise<number> {
    const hoy = fechaEnEcuador(ahora).dia;
    const grupos = await this.prisma.entregaDotacion.groupBy({
      by: ['coordinadorId'],
      where: { estado: 'PENDIENTE', fechaProgramada: diaComoFecha(hoy), coordinadorId: { not: null }, plan: { activo: true } },
      _count: { _all: true },
    });
    let total = 0;
    for (const g of grupos) {
      const n = g._count._all;
      total += n;
      await this.avisarCoordinador(g.coordinadorId!, 'Hoy toca entregar dotación', n === 1 ? 'Tienes 1 entrega para hoy.' : `Tienes ${n} entregas para hoy.`);
    }
    return total;
  }

  // ───────────────────────── Entregas ─────────────────────────

  private presentarEntrega(e: EntregaCompleta, agencias: Map<string, string> = new Map(), coordinadores: Map<string, string> = new Map()) {
    return {
      id: e.id,
      planId: e.planId,
      plan: e.plan.nombre,
      modo: e.persona ? 'PERSONAS' : 'AGENCIA',
      coordinadorId: e.coordinadorId,
      coordinador: e.coordinadorId ? (coordinadores.get(e.coordinadorId) ?? null) : null,
      repiteCadaMeses: e.plan.tipo === 'FIJO' ? e.plan.cadaMeses : null,
      personaId: e.personaId,
      persona: e.persona ? apellidosNombres(e.persona) : `Agencia ${agencias.get(e.agenciaId ?? '') ?? '—'}`,
      personasCubiertas: e.personasCubiertas,
      rol: e.persona ? e.persona.role.namerol : 'AGENCIA',
      agencia: e.persona ? (e.persona.agencia?.nombre ?? null) : (agencias.get(e.agenciaId ?? '') ?? null),
      recibeNombre: e.recibeNombre,
      firmada: !!e.firmaRecibe,
      fechaProgramada: dia(e.fechaProgramada),
      estado: e.estado,
      entregadaEn: e.entregadaEn,
      nota: e.nota,
      items: e.items.map((i) => ({
        id: i.id, productoId: i.productoId, producto: i.producto.nombre, categoria: i.producto.categoria.nombre,
        stock: i.producto.stock, cantidadPlan: i.cantidadPlan, cantidadEntregada: i.cantidadEntregada,
        usaTallas: i.producto.usaTallas, tallasStock: i.producto.tallas.map((t) => ({ nombre: t.nombre, stock: t.stock })),
        tallas: leerTallas(i.tallas),
      })),
      evidencias: e.evidencias.map((v) => ({ id: v.id, key: v.key, nombre: v.nombre, mime: v.mime })),
    };
  }

  /** Quien gestiona dotaciones ve y registra todas las entregas; un coordinador solo las que se le asignaron. */
  private veTodas(user: any): boolean {
    return tienePermiso(user, 'dotaciones.gestionar');
  }

  private async presentarEntregas(lista: EntregaCompleta[]) {
    const agenciaIds = [...new Set(lista.map((e) => e.agenciaId).filter((a): a is string => !!a))];
    const agencias = new Map(
      (agenciaIds.length ? await this.prisma.agencia.findMany({ where: { id: { in: agenciaIds } }, select: { id: true, nombre: true } }) : []).map((a) => [a.id, a.nombre]),
    );
    const coordinadores = await this.nombresDeCoordinadores(lista.map((e) => e.coordinadorId));
    return lista.map((e) => this.presentarEntrega(e, agencias, coordinadores));
  }

  /**
   * Listado priorizado: primero lo atrasado que sigue sin entregarse, luego lo de hoy, después lo que viene y al final lo ya entregado u
   * omitido. Lo de fecha futura se muestra como PROGRAMADA. Se puede filtrar por plan, persona y rango de fechas.
   */
  async listarEntregas(dto: ListarEntregasDto, user: any) {
    const hoy = fechaEnEcuador(new Date()).dia;
    const estado = dto.estado;
    const quierePendientes = !estado || estado === 'PENDIENTE' || estado === 'POR_ENTREGAR';
    const quiereCerradas = !estado || estado === 'ENTREGADA' || estado === 'OMITIDA';
    const quiereProgramadas = !estado || estado === 'PROGRAMADA' || estado === 'POR_ENTREGAR';
    const buscar = dto.buscar?.trim();
    const base: Prisma.EntregaDotacionWhereInput = {
      ...(this.veTodas(user) ? {} : { coordinadorId: String(user.id) }),
      ...(dto.planId ? { planId: dto.planId } : {}),
      ...(dto.desde || dto.hasta
        ? { fechaProgramada: { ...(dto.desde ? { gte: diaComoFecha(dto.desde) } : {}), ...(dto.hasta ? { lte: diaComoFecha(dto.hasta) } : {}) } }
        : {}),
      ...(buscar ? { persona: { OR: [{ name: { contains: buscar, mode: 'insensitive' } }, { lastname: { contains: buscar, mode: 'insensitive' } }] } } : {}),
    };
    const pendientesQue = (extra: Prisma.EntregaDotacionWhereInput) =>
      this.prisma.entregaDotacion.findMany({
        where: { AND: [base, { estado: 'PENDIENTE' }, extra] },
        include: INCLUIR_ENTREGA,
        orderBy: [{ fechaProgramada: 'asc' }, { createdAt: 'asc' }],
        take: 1000,
      });

    const [pendientes, programadas, cerradas] = await Promise.all([
      quierePendientes ? pendientesQue({ fechaProgramada: { lte: diaComoFecha(hoy) } }) : [],
      // Un plan desactivado no tiene próximas entregas (al reactivarlo vuelven a verse).
      quiereProgramadas ? pendientesQue({ fechaProgramada: { gt: diaComoFecha(hoy) }, plan: { activo: true } }) : [],
      quiereCerradas
        ? this.prisma.entregaDotacion.findMany({
            where: { ...base, estado: estado === 'ENTREGADA' || estado === 'OMITIDA' ? estado : { in: ['ENTREGADA', 'OMITIDA'] } },
            include: INCLUIR_ENTREGA,
            orderBy: [{ fechaProgramada: 'desc' }, { createdAt: 'desc' }],
            take: 500,
          })
        : [],
    ]);

    return (await this.presentarEntregas([...pendientes, ...programadas, ...cerradas]))
      .map((e) => ({ ...e, estado: estadoVisible(e.estado, e.fechaProgramada, hoy) }))
      .map((e) => ({ ...e, momento: momentoDeEntrega(e.estado, e.fechaProgramada, hoy) }))
      .sort(compararEntregas);
  }

  /** La firma de quien recibió (imagen pesada: no viaja en el listado). */
  async firmaDeEntrega(entregaId: string, user: any) {
    const e = await this.prisma.entregaDotacion.findUnique({ where: { id: entregaId }, select: { recibeNombre: true, firmaRecibe: true, coordinadorId: true } });
    if (!e) throw new NotFoundException('La entrega no existe.');
    this.exigirAcceso(e.coordinadorId, user);
    return { recibeNombre: e.recibeNombre, firma: e.firmaRecibe };
  }

  private exigirAcceso(coordinadorId: string | null, user: any): void {
    if (this.veTodas(user) || coordinadorId === String(user.id)) return;
    throw new ForbiddenException('Esta entrega está asignada a otro coordinador.');
  }

  private async entregaRegistrada(id: string) {
    const e = await this.prisma.entregaDotacion.findUniqueOrThrow({ where: { id }, include: INCLUIR_ENTREGA });
    return (await this.presentarEntregas([e]))[0];
  }

  private async prepararEvidencias(dto: RegistrarEntregaDto, userId: string) {
    if (dto.evidencias.length < 1 || dto.evidencias.length > MAX_EVIDENCIAS_DOTACION) {
      throw new BadRequestException(`Sube de 1 a ${MAX_EVIDENCIAS_DOTACION} fotos de evidencia.`);
    }
    const claves = new Set<string>();
    const resultado: { key: string; nombre: string; mime: string; tamanioBytes: number; subidoPorId: string }[] = [];
    for (const a of dto.evidencias) {
      const ins = await this.storage.inspectEvidence(a.url, { prefix: `rrhh/dotaciones/${userId}/`, sinLimiteDuracion: true });
      if (ins.kind !== 'IMAGEN') throw new BadRequestException(`«${a.nombre}» no es una foto.`);
      if (ins.sizeBytes > MAX_BYTES_EVIDENCIA_DOTACION) throw new BadRequestException(`«${a.nombre}» pesa más de ${MAX_BYTES_EVIDENCIA_DOTACION / 1024 / 1024} MB.`);
      if (claves.has(ins.key)) continue;
      claves.add(ins.key);
      resultado.push({ key: ins.key, nombre: a.nombre, mime: ins.mimeType, tamanioBytes: ins.sizeBytes, subidoPorId: userId });
    }
    return resultado;
  }

  async registrarEntrega(dto: RegistrarEntregaDto, user: any) {
    const userId = String(user.id);
    const recibeNombre = dto.recibeNombre.trim();
    if (recibeNombre.length < 3) throw new BadRequestException('Escribe el nombre de quien recibe.');
    const previa = await this.prisma.entregaDotacion.findUnique({ where: { id: dto.entregaId }, select: { coordinadorId: true } });
    if (!previa) throw new NotFoundException('La entrega no existe.');
    this.exigirAcceso(previa.coordinadorId, user);
    const evidencias = await this.prepararEvidencias(dto, userId);
    const hoy = fechaEnEcuador(new Date()).dia;
    const siguienteFecha = await this.prisma.$transaction(async (tx) => {
      const entrega = await tx.entregaDotacion.findUnique({
        where: { id: dto.entregaId },
        include: { items: { include: { producto: { select: { nombre: true, usaTallas: true } } } } },
      });
      if (!entrega) throw new NotFoundException('La entrega no existe.');
      if (entrega.estado !== 'PENDIENTE') throw new BadRequestException('Esa entrega ya fue registrada.');
      if (dia(entrega.fechaProgramada) > hoy) throw new BadRequestException(`Esa entrega se habilita el ${dia(entrega.fechaProgramada)}.`);
      const enviados = new Map(dto.items.map((i) => [i.itemId, i]));
      for (const id of enviados.keys()) {
        if (!entrega.items.some((i) => i.id === id)) throw new BadRequestException('Hay un producto que no pertenece a la entrega.');
      }
      if (!dto.items.some((i) => i.cantidadEntregada > 0)) throw new BadRequestException('Indica al menos un producto entregado.');
      // Se cierra primero: si dos registran a la vez, solo uno pasa y el stock no se descuenta dos veces.
      const cerrada = await tx.entregaDotacion.updateMany({
        where: { id: entrega.id, estado: 'PENDIENTE' },
        data: { estado: 'ENTREGADA', entregadaEn: new Date(), entregadaPorId: userId, nota: dto.nota?.trim() || null, recibeNombre, firmaRecibe: dto.firmaRecibe },
      });
      if (cerrada.count === 0) throw new BadRequestException('Esa entrega ya fue registrada.');
      for (const item of entrega.items) {
        const enviado = enviados.get(item.id);
        const cant = enviado?.cantidadEntregada ?? 0;
        const tallas = item.producto.usaTallas ? this.repartoDeTallas(item.producto.nombre, cant, enviado?.tallas ?? []) : [];
        await tx.entregaDotacionItem.update({
          where: { id: item.id },
          data: { cantidadEntregada: cant, tallas: tallas.length ? (tallas as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
        });
        if (cant <= 0) continue;
        // Un movimiento por talla; los productos sin tallas, uno solo.
        const partes: Array<{ talla: string | null; cantidad: number }> = item.producto.usaTallas ? tallas : [{ talla: null, cantidad: cant }];
        for (const parte of partes) {
          if (parte.talla !== null) {
            const bajoTalla = await tx.tallaDotacion.updateMany({
              where: { productoId: item.productoId, nombre: parte.talla, stock: { gte: parte.cantidad } },
              data: { stock: { decrement: parte.cantidad } },
            });
            if (bajoTalla.count === 0) throw new BadRequestException(`No hay stock suficiente de «${item.producto.nombre}» talla ${parte.talla} para entregar ${parte.cantidad}.`);
          }
          // Descuento atómico: solo baja si todavía alcanza.
          const bajo = await tx.productoDotacion.updateMany({ where: { id: item.productoId, stock: { gte: parte.cantidad } }, data: { stock: { decrement: parte.cantidad } } });
          if (bajo.count === 0) throw new BadRequestException(`No hay stock suficiente de «${item.producto.nombre}» para entregar ${parte.cantidad}.`);
          const prod = await tx.productoDotacion.findUniqueOrThrow({ where: { id: item.productoId }, select: { stock: true } });
          await tx.movimientoDotacion.create({
            data: { productoId: item.productoId, tipo: 'SALIDA', cantidad: parte.cantidad, stockDespues: prod.stock, talla: parte.talla, nota: dto.nota?.trim() || null, entregaId: entrega.id, actorId: userId },
          });
        }
      }
      await tx.entregaDotacionEvidencia.createMany({ data: evidencias.map((e) => ({ ...e, entregaId: entrega.id })) });
      return this.programarSiguiente(tx, entrega, hoy);
    });
    return { ...(await this.entregaRegistrada(dto.entregaId)), siguienteFecha };
  }

  /** Valida que las tallas de un producto sumen la cantidad entregada y devuelve solo las que llevan unidades. */
  private repartoDeTallas(producto: string, cantidad: number, enviadas: TallaEntregada[]): TallaEntregada[] {
    const reparto = new Map<string, number>();
    for (const t of enviadas) if (t.cantidad > 0) reparto.set(t.talla, (reparto.get(t.talla) ?? 0) + t.cantidad);
    if ([...reparto.values()].reduce((a, b) => a + b, 0) !== cantidad) throw new BadRequestException(`Indica las tallas de «${producto}»: deben sumar ${cantidad}.`);
    return [...reparto].map(([talla, n]) => ({ talla, cantidad: n }));
  }

  async omitirEntrega(dto: OmitirEntregaDto, user: any) {
    const entrega = await this.prisma.entregaDotacion.findUnique({ where: { id: dto.entregaId } });
    if (!entrega) throw new NotFoundException('La entrega no existe.');
    this.exigirAcceso(entrega.coordinadorId, user);
    if (entrega.estado !== 'PENDIENTE') throw new BadRequestException('Solo se puede omitir una entrega pendiente.');
    const hoy = fechaEnEcuador(new Date()).dia;
    const siguienteFecha = await this.prisma.$transaction(async (tx) => {
      const cerrada = await tx.entregaDotacion.updateMany({
        where: { id: dto.entregaId, estado: 'PENDIENTE' },
        data: { estado: 'OMITIDA', nota: dto.motivo.trim(), entregadaPorId: String(user.id), entregadaEn: new Date() },
      });
      if (cerrada.count === 0) throw new BadRequestException('Solo se puede omitir una entrega pendiente.');
      return dto.noRepetir ? null : this.programarSiguiente(tx, entrega, hoy);
    });
    return { id: dto.entregaId, estado: 'OMITIDA', siguienteFecha };
  }
}
