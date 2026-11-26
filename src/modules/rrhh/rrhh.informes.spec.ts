import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InformesInspeccionService } from '../auditorias/informes.service.js';
import { SellosService } from '../auditorias/sellos.service.js';
import { CryptoService } from '../../common/crypto/crypto.service.js';
import { TareasService } from './tareas.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: los planes de acción de un informe pueden tener un responsable. Al guardar el informe, cada plan con
 * responsable se vuelve una tarea Pendiente de RRHH; sin responsable no hay tarea.
 */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('tareas de RRHH desde un informe de inspección (base real)', () => {
  let env: Entorno;
  let informes: InformesInspeccionService;
  let tareas: TareasService;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};
  let agencia: { id: string };
  const storage = { inspectEvidence: vi.fn() };

  const contenido = (planes: Array<Record<string, unknown>>) => ({
    agenciaId: agencia.id, destinatarioNombre: 'Jefe de taller', asunto: 'Visita', antecedentes: 'n/a', desarrollo: 'Todo en orden',
    calificacion: 'BUENO', novedades: [{ titulo: 'Novedad sin tarea' }], actividades: [{ nombre: 'Revisión' }], planes,
  });

  const informeListo = async (planes: Array<Record<string, unknown>>, quien = 'supervisor') => {
    const creado = await informes.create(contenido(planes) as never, actores[quien]);
    env.rastrear('InformeInspeccion', creado.id);
    for (const [tipo, nombre] of [['RESPONSABLE', 'Ana Ruiz'], ['JEFE_TALLER', 'Mario López'], ['LIDER_BAHIA', 'Luis Paz']]) {
      await informes.firmar({ informeId: creado.id, tipo, nombre, imagen: PNG } as never, actores[quien]);
    }
    return creado;
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    const crypto = new CryptoService({ get: (k: string) => process.env[k] } as never);
    const sellos = new SellosService(env.prisma as never, crypto);
    tareas = new TareasService(env.prisma as never, storage as never, env.notificaciones());
    informes = new InformesInspeccionService(env.prisma as never, sellos, crypto, undefined, env.notificaciones(), tareas);

    const region = await env.region('inf');
    const otraRegion = await env.region('inf2');
    agencia = await env.agencia('inf-a', { regionId: region.id });
    const lejana = await env.agencia('inf-b', { regionId: otraRegion.id });
    const nuevo = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      ids[clave] = (await env.usuario(clave, rol, opts)).id;
      actores[clave] = await env.actor(ids[clave]);
    };
    await nuevo('supervisor', 'SUPERVISOR', { regionId: region.id });
    await nuevo('lavador', 'LAVADOR', { agenciaId: agencia.id, regionId: region.id });
    await nuevo('lavador2', 'LAVADOR', { agenciaId: agencia.id, regionId: region.id });
    await nuevo('lejano', 'LAVADOR', { agenciaId: lejana.id, regionId: otraRegion.id });
  });

  afterAll(async () => {
    await env.prisma.tareaRrhh.deleteMany({ where: { asignadoPorId: { in: Object.values(ids) } } });
    await env.cerrar();
  });

  it('el responsable del plan se guarda con el borrador y no crea la tarea todavía', async () => {
    const x = await informeListo([{ problema: 'Piso mojado', accionRequerida: 'Bahía 2', responsableId: ids.lavador }]);
    const detalle = await informes.detail(x.id, actores.supervisor);
    expect(detalle.planes[0].responsableId).toBe(ids.lavador);
    expect(await env.prisma.tareaRrhh.count({ where: { informeId: x.id } })).toBe(0);
  });

  it('al guardar el informe, cada plan con responsable se vuelve una tarea Pendiente; el que no tiene, no', async () => {
    const x = await informeListo([
      { problema: 'Piso mojado', accionRequerida: 'Bahía 2', responsableId: ids.lavador },
      { problema: 'Sin descripción', responsableId: ids.lavador2 },
      { problema: 'Sin responsable', accionRequerida: 'Nadie' },
    ]);
    const guardado = await informes.guardar(x.id, actores.supervisor);
    expect(guardado.estado).toBe('GUARDADO');

    const creadas = await env.prisma.tareaRrhh.findMany({ where: { informeId: x.id }, orderBy: { titulo: 'asc' } });
    expect(creadas.map((t) => t.titulo)).toEqual(['Piso mojado', 'Sin descripción']);
    expect(creadas.every((t) => t.estado === 'PENDIENTE')).toBe(true);
    expect(creadas.every((t) => t.asignadoPorId === ids.supervisor)).toBe(true);
    expect(creadas.map((t) => t.asignadoAId).sort()).toEqual([ids.lavador, ids.lavador2].sort());
    // sin descripción se usa el título
    expect(creadas.find((t) => t.titulo === 'Sin descripción')?.descripcion).toBe('Sin descripción');
    expect(creadas.every((t) => t.planId && !t.novedadId)).toBe(true);

    // origen visible desde la tarea
    const t = await tareas.detalle(creadas[0].id, actores.supervisor);
    expect(t.origen).toMatchObject({ informeId: x.id, numero: x.numero });

    // aviso al responsable, con el número del informe
    const aviso = await env.esperar(() => env.prisma.notification.findFirst({ where: { tipo: 'TAREA_ASIGNADA', entidadId: creadas[0].id } }));
    expect(aviso.mensaje).toContain(x.numero);
  });

  it('un responsable fuera del alcance de quien guarda impide guardar el informe: no queda guardado ni se crea nada', async () => {
    const x = await informeListo([{ problema: 'Fuera de alcance', accionRequerida: 'x', responsableId: ids.lejano }]);
    await expect(informes.guardar(x.id, actores.supervisor)).rejects.toThrow('fuera de tu alcance');
    expect((await informes.detail(x.id, actores.supervisor)).estado).toBe('BORRADOR');
    expect(await env.prisma.tareaRrhh.count({ where: { informeId: x.id } })).toBe(0);
  });

  it('se puede enviar la tarea de un plan a un Admin o Super Admin, y crearla también desde Tareas', async () => {
    const admin = await env.usuario('adm-destino', 'ADMIN');
    const asignables = await tareas.asignables(actores.supervisor);
    expect(asignables.some((p) => p.id === admin.id)).toBe(true);
    expect(asignables.some((p) => p.rol === 'SUPER_ADMIN')).toBe(true);
    const x = await informeListo([{ problema: 'Para administración', accionRequerida: 'Revisar', responsableId: admin.id }]);
    await informes.guardar(x.id, actores.supervisor);
    expect(await env.prisma.tareaRrhh.count({ where: { informeId: x.id, asignadoAId: admin.id } })).toBe(1);
    const directa = await tareas.crear({ asignadoAId: admin.id, titulo: 'Directa' } as never, actores.supervisor);
    expect(directa.asignadoA.id).toBe(admin.id);
  });

  it('quitar el responsable antes de guardar evita la tarea', async () => {
    const x = await informeListo([{ problema: 'Se arrepintió', accionRequerida: 'x', responsableId: ids.lavador }]);
    const d = await informes.detail(x.id, actores.supervisor);
    await informes.update({ ...contenido([{ id: d.planes[0].id, problema: 'Se arrepintió', accionRequerida: 'x' }]), id: x.id } as never, actores.supervisor);
    for (const [tipo, nombre] of [['RESPONSABLE', 'Ana Ruiz'], ['JEFE_TALLER', 'Mario López'], ['LIDER_BAHIA', 'Luis Paz']]) {
      await informes.firmar({ informeId: x.id, tipo, nombre, imagen: PNG } as never, actores.supervisor);
    }
    await informes.guardar(x.id, actores.supervisor);
    expect(await env.prisma.tareaRrhh.count({ where: { informeId: x.id } })).toBe(0);
  });
});
