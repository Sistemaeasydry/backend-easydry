import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DotacionesService } from './dotaciones.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { fechaEnEcuador } from '../rrhh/rrhh.reglas.js';
import { sumarDias, sumarMeses } from './dotaciones.reglas.js';

/**
 * Entregas de dotación: se crean eligiendo a quién y quién las hace; al registrarlas se descuenta el stock (por talla) y se programa la
 * siguiente contando desde ese día. Usa la base real y borra lo que crea.
 */
describe('dotaciones: crear, registrar y repetir entregas (base real)', () => {
  let env: Entorno;
  let service: DotacionesService;
  const ids: Record<string, string> = {};
  const hoy = fechaEnEcuador(new Date()).dia;
  const firma = { recibeNombre: 'Ana Pérez', firmaRecibe: 'data:image/png;base64,AAAA' };

  const gestor = { id: 'gestor', role: { namerol: 'TALENTO_HUMANO', capacidades: ['dotaciones.gestionar', 'dotaciones.ver'] } };
  const coordinador = () => ({ id: ids.coord, role: { namerol: 'COORD_X', capacidades: ['dotaciones.ver', 'dotaciones.entregar'] } });
  const otro = () => ({ id: ids.otro, role: { namerol: 'COORD_X', capacidades: ['dotaciones.ver', 'dotaciones.entregar'] } });

  const planBase = (sufijo: string) => ({
    nombre: `${env.marca}-plan-${sufijo}`,
    tipo: 'FIJO' as const,
    cadaMeses: 6,
    roles: ['LAVADOR'],
    agenciasIds: [ids.agencia],
    items: [{ productoId: ids.producto, cantidad: 2 }],
  });

  const crearPlan = async (sufijo: string) => {
    const plan = await service.guardarPlan(planBase(sufijo), { id: ids.coord });
    env.rastrear('PlanDotacion', plan.id);
    return plan;
  };

  const entregaDe = (planId: string, claveDestino: string, estado = 'PENDIENTE') =>
    env.prisma.entregaDotacion.findFirstOrThrow({ where: { planId, claveDestino, estado }, include: { items: true } });

  const stockPorTalla = async () => {
    const p = await env.prisma.productoDotacion.findUniqueOrThrow({ where: { id: ids.producto }, include: { tallas: true } });
    return { total: p.stock, ...Object.fromEntries(p.tallas.map((t) => [t.nombre, t.stock])) };
  };

  /** Registrar exige fotos subidas: aquí el almacenamiento solo confirma que el archivo es una imagen. */
  const almacen = {
    inspectEvidence: async (url: string) => ({ kind: 'IMAGEN', sizeBytes: 10, key: url, mimeType: 'image/jpeg' }),
  };

  const registrar = (entregaId: string, itemId: string, tallas: Array<{ talla: string; cantidad: number }>, user: unknown) =>
    service.registrarEntrega(
      {
        entregaId,
        items: [{ itemId, cantidadEntregada: tallas.reduce((n, t) => n + t.cantidad, 0), tallas }],
        evidencias: [{ url: `${env.marca}-foto`, nombre: 'foto.jpg' }],
        ...firma,
      },
      user,
    );

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new DotacionesService(env.prisma as never, almacen as never);
    const agencia = await env.agencia('dot1');
    ids.agencia = agencia.id;
    ids.lav1 = (await env.usuario('dot-lav1', 'LAVADOR', { agenciaId: agencia.id })).id;
    ids.lav2 = (await env.usuario('dot-lav2', 'LAVADOR', { agenciaId: agencia.id })).id;
    ids.coord = (await env.usuario('dot-coord', 'TALENTO_HUMANO')).id;
    ids.otro = (await env.usuario('dot-otro', 'TALENTO_HUMANO')).id;
    const categoria = await env.prisma.categoriaDotacion.create({ data: { nombre: `${env.marca}-cat` } });
    env.rastrear('CategoriaDotacion', categoria.id);
    const producto = await service.guardarProducto({
      nombre: `${env.marca}-camiseta`, categoriaId: categoria.id, usaTallas: true, tallas: [{ nombre: 'M' }, { nombre: 'L' }],
    });
    env.rastrear('ProductoDotacion', producto.id);
    ids.producto = producto.id;
    await service.registrarIngreso({ productoId: producto.id, cantidad: 10, talla: 'M' }, gestor);
    await service.registrarIngreso({ productoId: producto.id, cantidad: 5, talla: 'L' }, gestor);
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('el stock se lleva por talla y el total es la suma', async () => {
    expect(await stockPorTalla()).toEqual({ total: 15, M: 10, L: 5 });
    await expect(service.registrarIngreso({ productoId: ids.producto, cantidad: 1 }, gestor)).rejects.toThrow(/Elige la talla/);
  });

  it('no deja quitar una talla con stock', async () => {
    const p = await env.prisma.productoDotacion.findUniqueOrThrow({ where: { id: ids.producto } });
    await expect(
      service.guardarProducto({ id: p.id, nombre: p.nombre, categoriaId: p.categoriaId, usaTallas: true, tallas: [{ nombre: 'M' }] }),
    ).rejects.toThrow(/todavía tiene 5/);
  });

  it('crear un plan no genera entregas', async () => {
    const plan = await crearPlan('vacio');
    expect(await env.prisma.entregaDotacion.count({ where: { planId: plan.id } })).toBe(0);
  });

  it('crea una entrega por persona elegida, con su coordinador, y no repite a quien ya tiene una pendiente', async () => {
    const plan = await crearPlan('personas');
    ids.plan = plan.id;
    const dto = { planId: plan.id, modo: 'PERSONAS' as const, destinos: [ids.lav1], coordinadorId: ids.coord, fecha: hoy };
    expect(await service.crearEntregas(dto)).toEqual({ creadas: 1, yaPendientes: [] });
    const repetida = await service.crearEntregas({ ...dto, destinos: [ids.lav1, ids.lav2] });
    expect(repetida.creadas).toBe(1);
    expect(repetida.yaPendientes).toHaveLength(1);
    const entrega = await entregaDe(plan.id, ids.lav1);
    expect(entrega.coordinadorId).toBe(ids.coord);
    expect(entrega.items[0].cantidadPlan).toBe(2);
    const destinos = await service.destinosParaEntrega(plan.id);
    expect(destinos.personas.map((p) => p.pendiente)).toEqual([hoy, hoy]);
    expect(destinos.agencias).toHaveLength(1);
  });

  it('en modo AGENCIA crea una sola entrega con las cantidades por el personal', async () => {
    const plan = await crearPlan('agencia');
    await service.crearEntregas({ planId: plan.id, modo: 'AGENCIA', destinos: [ids.agencia], coordinadorId: ids.coord, fecha: hoy });
    const entrega = await entregaDe(plan.id, `agencia:${ids.agencia}`);
    expect(entrega.personaId).toBeNull();
    expect(entrega.personasCubiertas).toBe(2);
    expect(entrega.items[0].cantidadPlan).toBe(4);
  });

  it('rechaza fechas pasadas, destinos fuera del plan y coordinadores sin permiso', async () => {
    const dto = { planId: ids.plan, modo: 'PERSONAS' as const, destinos: [ids.lav1], coordinadorId: ids.coord, fecha: hoy };
    await expect(service.crearEntregas({ ...dto, fecha: sumarDias(hoy, -1) })).rejects.toThrow(/hoy o futura/);
    await expect(service.crearEntregas({ ...dto, destinos: [ids.otro] })).rejects.toThrow(/no entra en este plan/);
    await expect(service.crearEntregas({ ...dto, coordinadorId: ids.lav1 })).rejects.toThrow(/permiso para registrar entregas/);
  });

  it('cada coordinador ve solo lo suyo y no puede tocar lo ajeno', async () => {
    const mias = (await service.listarEntregas({}, coordinador())).filter((e) => e.plan.startsWith(env.marca));
    expect(mias).toHaveLength(3);
    expect((await service.listarEntregas({}, otro())).filter((e) => e.plan.startsWith(env.marca))).toHaveLength(0);
    const entrega = await entregaDe(ids.plan, ids.lav1);
    await expect(registrar(entrega.id, entrega.items[0].id, [{ talla: 'M', cantidad: 2 }], otro())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.omitirEntrega({ entregaId: entrega.id, motivo: 'No aplica' }, otro())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.firmaDeEntrega(entrega.id, otro())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('las tallas deben sumar lo entregado y alcanzar; si falla no se descuenta nada', async () => {
    const entrega = await entregaDe(ids.plan, ids.lav1);
    await expect(
      service.registrarEntrega(
        { entregaId: entrega.id, items: [{ itemId: entrega.items[0].id, cantidadEntregada: 2, tallas: [{ talla: 'M', cantidad: 1 }] }], evidencias: [{ url: 'f', nombre: 'f' }], ...firma },
        coordinador(),
      ),
    ).rejects.toThrow(/deben sumar 2/);
    await expect(registrar(entrega.id, entrega.items[0].id, [{ talla: 'L', cantidad: 6 }], coordinador())).rejects.toBeInstanceOf(BadRequestException);
    expect(await stockPorTalla()).toEqual({ total: 15, M: 10, L: 5 });
    expect((await entregaDe(ids.plan, ids.lav1)).id).toBe(entrega.id);
  });

  it('al registrar descuenta por talla y programa la siguiente 6 meses después de hoy, con el mismo coordinador', async () => {
    const entrega = await entregaDe(ids.plan, ids.lav1);
    // Estaba atrasada 6 días: los 6 meses se cuentan desde que se entrega.
    await env.prisma.entregaDotacion.update({ where: { id: entrega.id }, data: { fechaProgramada: new Date(`${sumarDias(hoy, -6)}T00:00:00.000Z`) } });
    const resultado = await registrar(entrega.id, entrega.items[0].id, [{ talla: 'M', cantidad: 1 }, { talla: 'L', cantidad: 1 }], coordinador());
    expect(resultado.siguienteFecha).toBe(sumarMeses(hoy, 6));
    expect(resultado.items[0].tallas).toEqual([{ talla: 'M', cantidad: 1 }, { talla: 'L', cantidad: 1 }]);
    expect(await stockPorTalla()).toEqual({ total: 13, M: 9, L: 4 });
    const siguiente = await entregaDe(ids.plan, ids.lav1);
    expect(siguiente.fechaProgramada.toISOString().slice(0, 10)).toBe(sumarMeses(hoy, 6));
    expect(siguiente.coordinadorId).toBe(ids.coord);

    const programadas = await service.listarEntregas({ planId: ids.plan, estado: 'PROGRAMADA' }, gestor);
    expect(programadas.map((e) => [e.id, e.estado, e.momento])).toEqual([[siguiente.id, 'PROGRAMADA', 'FUTURA']]);
    await expect(registrar(siguiente.id, siguiente.items[0].id, [{ talla: 'M', cantidad: 1 }], coordinador())).rejects.toThrow(/se habilita el/);
  });

  it('se puede cambiar quién hace una entrega pendiente', async () => {
    const siguiente = await entregaDe(ids.plan, ids.lav1);
    await service.reasignarEntrega({ entregaId: siguiente.id, coordinadorId: ids.otro });
    expect((await entregaDe(ids.plan, ids.lav1)).coordinadorId).toBe(ids.otro);
  });

  it('omitir programa la siguiente, salvo que se pida no repetir', async () => {
    const entrega = await entregaDe(ids.plan, ids.lav2);
    const r = await service.omitirEntrega({ entregaId: entrega.id, motivo: 'De vacaciones' }, gestor);
    expect(r.siguienteFecha).toBe(sumarMeses(hoy, 6));
    const siguiente = await entregaDe(ids.plan, ids.lav2);
    const fin = await service.omitirEntrega({ entregaId: siguiente.id, motivo: 'Ya no aplica', noRepetir: true }, gestor);
    expect(fin.siguienteFecha).toBeNull();
    expect(await env.prisma.entregaDotacion.count({ where: { planId: ids.plan, claveDestino: ids.lav2, estado: 'PENDIENTE' } })).toBe(0);
  });

  it('no elimina lo que tiene historial', async () => {
    const producto = await env.prisma.productoDotacion.findUniqueOrThrow({ where: { id: ids.producto } });
    await expect(service.eliminarPlan(ids.plan)).rejects.toThrow(/entregas realizadas/);
    // El intento fallido no borra las pendientes ni las omitidas.
    expect(await env.prisma.entregaDotacion.count({ where: { planId: ids.plan, estado: { not: 'ENTREGADA' } } })).toBeGreaterThan(0);
    await expect(service.eliminarProducto(ids.producto)).rejects.toThrow(/en entregas/);
    await expect(service.eliminarCategoria(producto.categoriaId)).rejects.toThrow(/tiene productos/);
  });

  it('elimina un plan sin entregas realizadas, y luego su producto y su categoría', async () => {
    const categoria = await env.prisma.categoriaDotacion.create({ data: { nombre: `${env.marca}-cat-borrar` } });
    env.rastrear('CategoriaDotacion', categoria.id);
    const producto = await service.guardarProducto({ nombre: `${env.marca}-guantes`, categoriaId: categoria.id });
    env.rastrear('ProductoDotacion', producto.id);
    await service.registrarIngreso({ productoId: producto.id, cantidad: 3 }, gestor);
    const plan = await service.guardarPlan({ ...planBase('borrar'), items: [{ productoId: producto.id, cantidad: 1 }] }, { id: ids.coord });
    env.rastrear('PlanDotacion', plan.id);
    await service.crearEntregas({ planId: plan.id, modo: 'PERSONAS', destinos: [ids.lav1], coordinadorId: ids.coord, fecha: hoy });
    await expect(service.eliminarProducto(producto.id)).rejects.toBeInstanceOf(BadRequestException);

    await service.eliminarPlan(plan.id);
    expect(await env.prisma.entregaDotacion.count({ where: { planId: plan.id } })).toBe(0);
    await service.eliminarProducto(producto.id);
    await service.eliminarCategoria(categoria.id);
    expect(await env.prisma.categoriaDotacion.findUnique({ where: { id: categoria.id } })).toBeNull();
  });

  it('el listado de coordinadores trae a quienes tienen el permiso de entregar', async () => {
    const lista = await service.listarCoordinadores();
    expect(lista.some((c) => c.id === ids.coord)).toBe(true);
    expect(lista.some((c) => c.id === ids.lav1)).toBe(false);
  });
});
