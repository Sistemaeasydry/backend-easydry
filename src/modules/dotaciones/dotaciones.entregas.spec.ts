import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DotacionesService } from './dotaciones.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { fechaEnEcuador } from '../rrhh/rrhh.reglas.js';

/**
 * Entregas de dotación con coordinador: el plan dice si se entrega persona por persona o a la agencia completa, y solo el coordinador del
 * plan (o quien gestiona dotaciones) ve y registra sus entregas. Usa la base real y borra lo que crea.
 */
describe('dotaciones: coordinador y entrega a la agencia (base real)', () => {
  let env: Entorno;
  let service: DotacionesService;
  const ids: Record<string, string> = {};

  const gestor = { id: 'gestor', role: { namerol: 'TALENTO_HUMANO', capacidades: ['dotaciones.gestionar', 'dotaciones.ver'] } };
  const coordinador = () => ({ id: ids.coord, role: { namerol: 'COORD_X', capacidades: ['dotaciones.ver', 'dotaciones.entregar'] } });
  const otro = () => ({ id: ids.otro, role: { namerol: 'COORD_X', capacidades: ['dotaciones.ver', 'dotaciones.entregar'] } });

  const planBase = (modoEntrega: 'PERSONAS' | 'AGENCIA') => ({
    nombre: `${env.marca}-plan-${modoEntrega}`,
    tipo: 'OCASIONAL' as const,
    fechaInicio: fechaEnEcuador(new Date()).dia,
    roles: ['LAVADOR'],
    agenciasIds: [ids.agencia],
    modoEntrega,
    coordinadorId: ids.coord,
    items: [{ productoId: ids.producto, cantidad: 2 }],
  });

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new DotacionesService(env.prisma as never, undefined as never);
    const agencia = await env.agencia('dot1');
    ids.agencia = agencia.id;
    ids.lav1 = (await env.usuario('dot-lav1', 'LAVADOR', { agenciaId: agencia.id })).id;
    ids.lav2 = (await env.usuario('dot-lav2', 'LAVADOR', { agenciaId: agencia.id })).id;
    // El coordinador debe tener un rol con el permiso de entregar: se toma el rol oficial de Talento Humano y se verifica aquí.
    const th = await env.prisma.user.findFirst({ where: { estado: 1, role: { capacidades: { has: 'dotaciones.entregar' } } }, select: { id: true } });
    ids.coord = th?.id ?? (await env.usuario('dot-coord', 'TALENTO_HUMANO')).id;
    ids.otro = (await env.usuario('dot-otro', 'TALENTO_HUMANO')).id;
    const categoria = await env.prisma.categoriaDotacion.create({ data: { nombre: `${env.marca}-cat` } });
    env.rastrear('CategoriaDotacion', categoria.id);
    const producto = await env.prisma.productoDotacion.create({ data: { nombre: `${env.marca}-camiseta`, categoriaId: categoria.id, stock: 50 } });
    env.rastrear('ProductoDotacion', producto.id);
    ids.producto = producto.id;
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('en modo PERSONAS genera una entrega por persona', async () => {
    const plan = await service.guardarPlan(planBase('PERSONAS'), { id: ids.coord });
    env.rastrear('PlanDotacion', plan.id);
    const entregas = await env.prisma.entregaDotacion.findMany({ where: { planId: plan.id }, include: { items: true } });
    expect(entregas).toHaveLength(2);
    expect(entregas.every((e) => e.personaId && e.claveDestino === e.personaId && e.items[0].cantidadPlan === 2)).toBe(true);
    expect(plan.modoEntrega).toBe('PERSONAS');
    expect(plan.coordinadorId).toBe(ids.coord);
  });

  it('en modo AGENCIA genera una sola entrega, con las cantidades por el personal de la agencia', async () => {
    const plan = await service.guardarPlan(planBase('AGENCIA'), { id: ids.coord });
    env.rastrear('PlanDotacion', plan.id);
    const entregas = await env.prisma.entregaDotacion.findMany({ where: { planId: plan.id }, include: { items: true } });
    expect(entregas).toHaveLength(1);
    expect(entregas[0].personaId).toBeNull();
    expect(entregas[0].claveDestino).toBe(`agencia:${ids.agencia}`);
    expect(entregas[0].personasCubiertas).toBe(2);
    expect(entregas[0].items[0].cantidadPlan).toBe(4); // 2 por persona × 2 personas
    // Volver a generar no la repite.
    expect(await service.generarEntregasDePlan(plan.id)).toBe(0);
  });

  it('el coordinador del plan ve solo lo suyo; otro coordinador no ve nada y quien gestiona ve todo', async () => {
    const mias = await service.listarEntregas({}, coordinador());
    expect(mias.length).toBeGreaterThanOrEqual(3);
    expect(mias.every((e) => e.coordinador !== null)).toBe(true);
    const deAgencia = mias.find((e) => e.modo === 'AGENCIA');
    expect(deAgencia?.persona).toMatch(/^Agencia /);
    expect(deAgencia?.personasCubiertas).toBe(2);

    const deOtro = await service.listarEntregas({}, otro());
    expect(deOtro.filter((e) => e.plan.startsWith(env.marca))).toHaveLength(0);

    const todas = await service.listarEntregas({}, gestor);
    expect(todas.filter((e) => e.plan.startsWith(env.marca)).length).toBe(3);
  });

  it('otro coordinador no puede registrar ni omitir la entrega de un plan ajeno', async () => {
    const entrega = await env.prisma.entregaDotacion.findFirstOrThrow({ where: { plan: { nombre: { startsWith: env.marca } } } });
    await expect(
      service.registrarEntrega(
        { entregaId: entrega.id, items: [], evidencias: [], recibeNombre: 'Ana Pérez', firmaRecibe: 'data:image/png;base64,AAAA' } as never,
        otro(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.omitirEntrega({ entregaId: entrega.id, motivo: 'No aplica' } as never, otro())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.firmaDeEntrega(entrega.id, otro())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('registrar exige el nombre de quien recibe', async () => {
    const entrega = await env.prisma.entregaDotacion.findFirstOrThrow({ where: { plan: { nombre: { startsWith: env.marca } } } });
    await expect(
      service.registrarEntrega({ entregaId: entrega.id, items: [], evidencias: [], recibeNombre: '  ', firmaRecibe: 'data:image/png;base64,AAAA' } as never, coordinador()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el coordinador de un plan debe poder registrar entregas', async () => {
    const lavador = await env.usuario('dot-sin-permiso', 'LAVADOR');
    await expect(service.guardarPlan({ ...planBase('PERSONAS'), coordinadorId: lavador.id }, { id: ids.coord })).rejects.toThrow(/permiso para registrar entregas/);
  });

  it('el listado de coordinadores trae a quienes tienen el permiso de entregar', async () => {
    const lista = await service.listarCoordinadores();
    expect(lista.some((c) => c.id === ids.coord)).toBe(true);
    expect(lista.some((c) => c.id === ids.lav1)).toBe(false);
  });
});
