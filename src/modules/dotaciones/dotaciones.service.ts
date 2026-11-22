import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { diaComoFecha, fechaEnEcuador } from '../rrhh/rrhh.reglas.js';
import {
  MAX_BYTES_EVIDENCIA_DOTACION,
  MAX_EVIDENCIAS_DOTACION,
  ocurrenciaVigente,
  personaEnPlan,
  ROLES_SIN_DOTACION,
} from './dotaciones.reglas.js';
import type {
  EstadoPlanDto,
  GuardarCategoriaDto,
  GuardarPlanDto,
  GuardarProductoDto,
  IngresoStockDto,
  ListarEntregasDto,
  OmitirEntregaDto,
  RegistrarEntregaDto,
} from './dto/dotaciones.dto.js';
import { apellidosNombres } from '../../common/utils/nombre-persona.js';

const nombreDe = (u: { name: string; lastname: string }) => apellidosNombres(u);
const dia = (d: Date) => d.toISOString().slice(0, 10);

const INCLUIR_PLAN = { items: { include: { producto: { select: { nombre: true } } } } } satisfies Prisma.PlanDotacionInclude;

const INCLUIR_ENTREGA = {
  plan: { select: { id: true, nombre: true } },
  persona: { select: { id: true, name: true, lastname: true, role: { select: { namerol: true } }, agencia: { select: { nombre: true } } } },
  items: { include: { producto: { select: { nombre: true, stock: true, categoria: { select: { nombre: true } } } } } },
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
    const categorias = await this.prisma.categoriaDotacion.findMany({ orderBy: { nombre: 'asc' }, include: { _count: { select: { productos: true } } } });
    return categorias.map((c) => ({ id: c.id, nombre: c.nombre, activa: c.activa, productos: c._count.productos }));
  }

  async guardarCategoria(dto: GuardarCategoriaDto) {
    const nombre = dto.nombre.trim();
    if (!nombre) throw new BadRequestException('Escribe el nombre de la categoría.');
    return this.unico(async () => {
      if (dto.id) {
        const existe = await this.prisma.categoriaDotacion.findUnique({ where: { id: dto.id } });
        if (!existe) throw new NotFoundException('La categoría no existe.');
        return this.prisma.categoriaDotacion.update({ where: { id: dto.id }, data: { nombre, ...(dto.activa === undefined ? {} : { activa: dto.activa }) } });
      }
      return this.prisma.categoriaDotacion.create({ data: { nombre } });
    }, 'Ya existe una categoría con ese nombre.');
  }

  async listarProductos() {
    const productos = await this.prisma.productoDotacion.findMany({
      orderBy: [{ categoria: { nombre: 'asc' } }, { nombre: 'asc' }],
      include: { categoria: { select: { id: true, nombre: true } } },
    });
    return productos.map((p) => ({ id: p.id, nombre: p.nombre, categoriaId: p.categoriaId, categoria: p.categoria.nombre, stock: p.stock, activo: p.activo }));
  }

  async guardarProducto(dto: GuardarProductoDto) {
    const nombre = dto.nombre.trim();
    if (!nombre) throw new BadRequestException('Escribe el nombre del producto.');
    const categoria = await this.prisma.categoriaDotacion.findUnique({ where: { id: dto.categoriaId } });
    if (!categoria) throw new BadRequestException('La categoría no existe.');
    return this.unico(async () => {
      if (dto.id) {
        const existe = await this.prisma.productoDotacion.findUnique({ where: { id: dto.id } });
        if (!existe) throw new NotFoundException('El producto no existe.');
        // El stock nunca se edita aquí: solo cambia con ingresos y entregas.
        return this.prisma.productoDotacion.update({
          where: { id: dto.id },
          data: { nombre, categoriaId: dto.categoriaId, ...(dto.activo === undefined ? {} : { activo: dto.activo }) },
        });
      }
      return this.prisma.productoDotacion.create({ data: { nombre, categoriaId: dto.categoriaId } });
    }, 'Ya existe un producto con ese nombre en esa categoría.');
  }

  async registrarIngreso(dto: IngresoStockDto, user: any) {
    return this.prisma.$transaction(async (tx) => {
      const producto = await tx.productoDotacion.findUnique({ where: { id: dto.productoId } });
      if (!producto) throw new NotFoundException('El producto no existe.');
      const actualizado = await tx.productoDotacion.update({ where: { id: dto.productoId }, data: { stock: { increment: dto.cantidad } } });
      await tx.movimientoDotacion.create({
        data: { productoId: dto.productoId, tipo: 'INGRESO', cantidad: dto.cantidad, stockDespues: actualizado.stock, nota: dto.nota?.trim() || null, actorId: String(user.id) },
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
      id: m.id, tipo: m.tipo, cantidad: m.cantidad, stockDespues: m.stockDespues, nota: m.nota, entregaId: m.entregaId,
      actor: nombre.get(m.actorId) ?? '—', creadoEn: m.createdAt,
    }));
  }

  // ───────────────────────── Planes ─────────────────────────

  private presentarPlan(p: PlanCompleto) {
    return {
      id: p.id,
      nombre: p.nombre,
      tipo: p.tipo,
      fechaInicio: dia(p.fechaInicio),
      cadaMeses: p.cadaMeses,
      roles: p.roles,
      agenciasIds: p.agenciasIds,
      activo: p.activo,
      items: p.items.map((i) => ({ productoId: i.productoId, producto: i.producto.nombre, cantidad: i.cantidad })),
    };
  }

  async listarPlanes() {
    const planes = await this.prisma.planDotacion.findMany({ orderBy: [{ activo: 'desc' }, { createdAt: 'desc' }], include: INCLUIR_PLAN });
    return planes.map((p) => this.presentarPlan(p));
  }

  async guardarPlan(dto: GuardarPlanDto, user: any) {
    const hoy = fechaEnEcuador(new Date()).dia;
    if (dto.tipo === 'FIJO' && !dto.cadaMeses) throw new BadRequestException('Indica cada cuántos meses se repite.');
    if (dto.tipo === 'OCASIONAL' && dto.fechaInicio < hoy) throw new BadRequestException('Una entrega ocasional debe tener fecha de hoy o futura.');
    const roles = [...new Set(dto.roles.filter((r) => !ROLES_SIN_DOTACION.includes(r)))];
    const productos = [...new Set(dto.items.map((i) => i.productoId))];
    if (productos.length !== dto.items.length) throw new BadRequestException('Un producto solo puede aparecer una vez en el plan.');
    const existentes = await this.prisma.productoDotacion.count({ where: { id: { in: productos }, activo: true } });
    if (existentes !== productos.length) throw new BadRequestException('Algún producto no existe o está inactivo.');
    const data = {
      nombre: dto.nombre.trim(),
      tipo: dto.tipo,
      fechaInicio: diaComoFecha(dto.fechaInicio),
      cadaMeses: dto.tipo === 'FIJO' ? dto.cadaMeses! : null,
      roles,
      agenciasIds: dto.agenciasIds,
    };
    const items = dto.items.map((i) => ({ productoId: i.productoId, cantidad: i.cantidad }));
    const plan = await this.prisma.$transaction(async (tx) => {
      if (dto.id) {
        const existe = await tx.planDotacion.findUnique({ where: { id: dto.id } });
        if (!existe) throw new NotFoundException('El plan no existe.');
        // Lo ya generado no cambia: el plan editado rige para las próximas entregas.
        await tx.planDotacionItem.deleteMany({ where: { planId: dto.id } });
        return tx.planDotacion.update({ where: { id: dto.id }, data: { ...data, items: { create: items } }, include: INCLUIR_PLAN });
      }
      return tx.planDotacion.create({ data: { ...data, creadoPorId: String(user.id), items: { create: items } }, include: INCLUIR_PLAN });
    });
    await this.generarEntregasDePlan(plan.id);
    return this.presentarPlan(plan);
  }

  async estadoPlan(dto: EstadoPlanDto) {
    const existe = await this.prisma.planDotacion.findUnique({ where: { id: dto.id } });
    if (!existe) throw new NotFoundException('El plan no existe.');
    await this.prisma.planDotacion.update({ where: { id: dto.id }, data: { activo: dto.activo } });
    if (dto.activo) await this.generarEntregasDePlan(dto.id);
    return { id: dto.id, activo: dto.activo };
  }

  // ───────────────────────── Generación de entregas ─────────────────────────

  /** Genera las entregas pendientes del plan para la ocurrencia que toca hoy. Es idempotente: una persona no repite en la misma fecha. */
  async generarEntregasDePlan(planId: string, ahora = new Date()): Promise<number> {
    const plan = await this.prisma.planDotacion.findUnique({ where: { id: planId }, include: { items: true } });
    if (!plan || !plan.activo || plan.items.length === 0) return 0;
    const hoy = fechaEnEcuador(ahora).dia;
    const ocurrencia = ocurrenciaVigente(
      { tipo: plan.tipo, fechaInicio: dia(plan.fechaInicio), cadaMeses: plan.cadaMeses },
      hoy,
      fechaEnEcuador(plan.createdAt).dia,
    );
    if (!ocurrencia) return 0;
    const personas = await this.prisma.user.findMany({
      where: { estado: 1, role: { namerol: { notIn: ROLES_SIN_DOTACION } } },
      select: { id: true, agenciaId: true, regionId: true, role: { select: { namerol: true } } },
    });
    const elegibles = personas.filter((p) => personaEnPlan(plan, { rol: p.role.namerol, agenciaId: p.agenciaId }));
    const fecha = diaComoFecha(ocurrencia);
    let creadas = 0;
    for (const p of elegibles) {
      const ya = await this.prisma.entregaDotacion.findUnique({
        where: { planId_personaId_fechaProgramada: { planId, personaId: p.id, fechaProgramada: fecha } },
        select: { id: true },
      });
      if (ya) continue;
      await this.prisma.entregaDotacion.create({
        data: {
          planId, personaId: p.id, fechaProgramada: fecha, agenciaId: p.agenciaId, regionId: p.regionId,
          items: { create: plan.items.map((i) => ({ productoId: i.productoId, cantidadPlan: i.cantidad })) },
        },
      });
      creadas++;
    }
    return creadas;
  }

  /** Cron diario: revisa todos los planes activos. */
  async generarEntregasPendientes(): Promise<number> {
    const planes = await this.prisma.planDotacion.findMany({ where: { activo: true }, select: { id: true } });
    let total = 0;
    for (const { id } of planes) {
      try {
        total += await this.generarEntregasDePlan(id);
      } catch (e: any) {
        this.logger.error(`No se pudieron generar las entregas del plan ${id}: ${e?.message || e}`);
      }
    }
    return total;
  }

  // ───────────────────────── Entregas ─────────────────────────

  private presentarEntrega(e: EntregaCompleta) {
    return {
      id: e.id,
      planId: e.planId,
      plan: e.plan.nombre,
      personaId: e.personaId,
      persona: apellidosNombres(e.persona),
      rol: e.persona.role.namerol,
      agencia: e.persona.agencia?.nombre ?? null,
      fechaProgramada: dia(e.fechaProgramada),
      estado: e.estado,
      entregadaEn: e.entregadaEn,
      nota: e.nota,
      items: e.items.map((i) => ({
        id: i.id, productoId: i.productoId, producto: i.producto.nombre, categoria: i.producto.categoria.nombre,
        stock: i.producto.stock, cantidadPlan: i.cantidadPlan, cantidadEntregada: i.cantidadEntregada,
      })),
      evidencias: e.evidencias.map((v) => ({ id: v.id, key: v.key, nombre: v.nombre, mime: v.mime })),
    };
  }

  async listarEntregas(dto: ListarEntregasDto) {
    const buscar = dto.buscar?.trim();
    const where: Prisma.EntregaDotacionWhereInput = {
      ...(dto.estado ? { estado: dto.estado } : {}),
      ...(dto.planId ? { planId: dto.planId } : {}),
      ...(buscar ? { persona: { OR: [{ name: { contains: buscar, mode: 'insensitive' } }, { lastname: { contains: buscar, mode: 'insensitive' } }] } } : {}),
    };
    const lista = await this.prisma.entregaDotacion.findMany({ where, include: INCLUIR_ENTREGA, orderBy: [{ fechaProgramada: 'asc' }, { createdAt: 'asc' }], take: 500 });
    return lista.map((e) => this.presentarEntrega(e));
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
    const evidencias = await this.prepararEvidencias(dto, userId);
    await this.prisma.$transaction(async (tx) => {
      const entrega = await tx.entregaDotacion.findUnique({ where: { id: dto.entregaId }, include: { items: { include: { producto: { select: { nombre: true } } } } } });
      if (!entrega) throw new NotFoundException('La entrega no existe.');
      if (entrega.estado !== 'PENDIENTE') throw new BadRequestException('Esa entrega ya fue registrada.');
      const cantidades = new Map(dto.items.map((i) => [i.itemId, i.cantidadEntregada]));
      for (const id of cantidades.keys()) {
        if (!entrega.items.some((i) => i.id === id)) throw new BadRequestException('Hay un producto que no pertenece a la entrega.');
      }
      if (![...cantidades.values()].some((c) => c > 0)) throw new BadRequestException('Indica al menos un producto entregado.');
      for (const item of entrega.items) {
        const cant = cantidades.get(item.id) ?? 0;
        await tx.entregaDotacionItem.update({ where: { id: item.id }, data: { cantidadEntregada: cant } });
        if (cant <= 0) continue;
        // Descuento atómico: solo baja si todavía alcanza.
        const bajo = await tx.productoDotacion.updateMany({ where: { id: item.productoId, stock: { gte: cant } }, data: { stock: { decrement: cant } } });
        if (bajo.count === 0) throw new BadRequestException(`No hay stock suficiente de «${item.producto.nombre}» para entregar ${cant}.`);
        const prod = await tx.productoDotacion.findUniqueOrThrow({ where: { id: item.productoId }, select: { stock: true } });
        await tx.movimientoDotacion.create({
          data: { productoId: item.productoId, tipo: 'SALIDA', cantidad: cant, stockDespues: prod.stock, nota: dto.nota?.trim() || null, entregaId: entrega.id, actorId: userId },
        });
      }
      await tx.entregaDotacionEvidencia.createMany({ data: evidencias.map((e) => ({ ...e, entregaId: entrega.id })) });
      await tx.entregaDotacion.update({
        where: { id: entrega.id },
        data: { estado: 'ENTREGADA', entregadaEn: new Date(), entregadaPorId: userId, nota: dto.nota?.trim() || null },
      });
    });
    const e = await this.prisma.entregaDotacion.findUniqueOrThrow({ where: { id: dto.entregaId }, include: INCLUIR_ENTREGA });
    return this.presentarEntrega(e);
  }

  async omitirEntrega(dto: OmitirEntregaDto, user: any) {
    const entrega = await this.prisma.entregaDotacion.findUnique({ where: { id: dto.entregaId } });
    if (!entrega) throw new NotFoundException('La entrega no existe.');
    if (entrega.estado !== 'PENDIENTE') throw new BadRequestException('Solo se puede omitir una entrega pendiente.');
    await this.prisma.entregaDotacion.update({
      where: { id: dto.entregaId },
      data: { estado: 'OMITIDA', nota: dto.motivo.trim(), entregadaPorId: String(user.id), entregadaEn: new Date() },
    });
    return { id: dto.entregaId, estado: 'OMITIDA' };
  }
}
