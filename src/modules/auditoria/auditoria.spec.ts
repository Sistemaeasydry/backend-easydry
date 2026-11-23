import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuditoriaService } from './auditoria.service.js';
import { entidadDeCuerpo, esCambio, limpiarDatos, moduloDeRuta, partirRuta, whereVisibles } from './auditoria.reglas.js';

describe('qué rutas son cambios', () => {
  it('quita el prefijo de la API y separa el controlador', () => {
    expect(partirRuta('/api/v1/agencias/usuarios/update?x=1')).toEqual({ prefijo: 'agencias', resto: 'usuarios/update' });
  });

  it('los POST de crear, editar, asignar o cancelar son cambios; los de listar, ver o consultar no', () => {
    for (const ruta of ['agencias/usuarios/update', 'agencias/usuarios/update-datos', 'rrhh/tareas/crear', 'rrhh/tareas/reasignar', 'rrhh/horarios/ajustes/editar', 'rrhh/timbradas/registrar', 'roles/delete', 'inventario/despachos/crear', 'rrhh/ubicaciones/guardar']) {
      expect(esCambio('POST', `/api/v1/${ruta}`), ruta).toBe(true);
    }
    for (const ruta of ['agencias/usuarios/list', 'rrhh/timbradas/estado', 'rrhh/timbradas/equipo', 'rrhh/tareas/asignables', 'rrhh/tareas/asignadas', 'roles/detail', 'rrhh/horarios/historial', 'inventario/stock/resumen']) {
      expect(esCambio('POST', `/api/v1/${ruta}`), ruta).toBe(false);
    }
  });

  it('PUT, PATCH y DELETE siempre son cambios; GET nunca', () => {
    expect(esCambio('PATCH', '/api/v1/agencias/x')).toBe(true);
    expect(esCambio('DELETE', '/api/v1/agencias/x')).toBe(true);
    expect(esCambio('GET', '/api/v1/agencias/list')).toBe(false);
  });

  it('la sesión, las notificaciones, los reportes y la propia auditoría no se auditan', () => {
    for (const p of ['auth/login', 'auth/cambiar-password', 'notifications/marcar', 'reportes/exportaciones', 'auditoria/listar', 'sync/subir']) {
      expect(esCambio('POST', `/api/v1/${p}`), p).toBe(false);
    }
  });
});

describe('de qué pantalla es cada ruta', () => {
  it.each([
    ['agencias/usuarios/update', 'usuarios'],
    ['agencias/operadores/crear', 'operadores'],
    ['agencias/update', 'agencias'],
    ['roles/update', 'usuarios'],
    ['rrhh/tareas/crear', 'rrhh/tareas'],
    ['rrhh/horarios/editar', 'rrhh/timbradas'],
    ['rrhh/ubicaciones/guardar', 'rrhh/timbradas'],
    ['dotaciones/entregas/registrar', 'rrhh/dotaciones'],
    ['inventario/despachos/crear', 'envios'],
    ['inventario/stock/ajustar', 'inventario'],
    ['maquinaria/incidentes/crear', 'taller-tecnico'],
    ['maquinaria/update', 'maquinaria'],
    ['operaciones/catalogos/crear', 'configuracion/servicios'],
    ['operaciones/servicios/crear', 'servicios'],
  ])('%s → %s', (ruta, modulo) => {
    expect(moduloDeRuta(`/api/v1/${ruta}`)).toBe(modulo);
  });

  it('una ruta que no pertenece a ninguna pantalla no se audita', () => {
    expect(moduloDeRuta('/api/v1/storage/presigned-url')).toBeNull();
  });
});

describe('qué se guarda', () => {
  it('oculta contraseñas y datos secretos, a cualquier profundidad', () => {
    const limpio = limpiarDatos({ id: 'u1', password: 'Secreta123', nuevaContrasena: 'x', anidado: { token: 'abc', refreshToken: 'def', nombre: 'Ana' }, lista: [{ pin: '1234', ok: 1 }] }) as any;
    expect(limpio.password).toBe('[oculto]');
    expect(limpio.nuevaContrasena).toBe('[oculto]');
    expect(limpio.anidado).toEqual({ token: '[oculto]', refreshToken: '[oculto]', nombre: 'Ana' });
    expect(limpio.lista).toEqual([{ pin: '[oculto]', ok: 1 }]);
    expect(JSON.stringify(limpio)).not.toContain('Secreta123');
  });

  it('recorta textos largos, listas largas y archivos en base64', () => {
    const limpio = limpiarDatos({ texto: 'a'.repeat(1000), foto: 'data:image/png;base64,AAAA', filas: Array.from({ length: 50 }, (_, i) => i) }) as any;
    expect(limpio.texto.length).toBeLessThan(400);
    expect(limpio.foto).toBe('[archivo]');
    expect(limpio.filas).toHaveLength(21);
  });

  it('toma el id de la entidad del cuerpo', () => {
    expect(entidadDeCuerpo({ id: 'u1', name: 'Ana' })).toEqual({ tipo: 'registro', id: 'u1' });
    expect(entidadDeCuerpo({ userId: 'u2' })).toEqual({ tipo: 'usuario', id: 'u2' });
    expect(entidadDeCuerpo({})).toEqual({ tipo: null, id: null });
  });
});

describe('quién ve qué', () => {
  it('solo las pantallas del rol y, según el alcance, su región, su agencia o lo propio', () => {
    expect(whereVisibles(['usuarios'], { tipo: 'GLOBAL' })).toEqual({ modulo: { in: ['usuarios'] } });
    expect(whereVisibles(['usuarios'], { tipo: 'REGION', regionId: 'r1' })).toEqual({ modulo: { in: ['usuarios'] }, regionId: 'r1' });
    expect(whereVisibles(['usuarios'], { tipo: 'AGENCIA', agenciaId: 'a1' })).toEqual({ modulo: { in: ['usuarios'] }, agenciaId: 'a1' });
    expect(whereVisibles(['usuarios'], { tipo: 'PROPIO', userId: 'u1' })).toEqual({ modulo: { in: ['usuarios'] }, actorId: 'u1' });
    expect(whereVisibles(['usuarios'], { tipo: 'NINGUNO' })).toEqual({ id: { in: [] } });
  });
});

describe('AuditoriaService', () => {
  const usuario = (rol: string, ambito: string, capacidades: string[], extra: Record<string, unknown> = {}) => ({
    id: 'u1', name: 'Ana', lastname: 'Pérez', ...extra, roleDetails: { namerol: rol, ambito, capacidades },
  });
  const crear = () => {
    const prisma: any = {
      registroAuditoria: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      consultaAuditoria: { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
    };
    return { servicio: new AuditoriaService(prisma), prisma };
  };

  it('un rol ve solo las pantallas que tiene activas, aunque pida otra', async () => {
    const { servicio, prisma } = crear();
    // Con páginas guardadas: solo «Usuarios» y «Timbradas».
    const u = usuario('SUPERVISOR', 'REGION', ['pagina.usuarios', 'pagina.rrhh-timbradas', 'auditoria.ver'], { regionId: 'r1' });
    expect(servicio.opciones(u).modulos.map((m) => m.valor).sort()).toEqual(['rrhh/timbradas', 'usuarios']);
    await servicio.listar({ modulo: 'inventario' }, u as never);
    const filtro = prisma.registroAuditoria.findMany.mock.calls[0][0].where.AND[0];
    // Pidió «inventario», que no tiene: no se le concede y el filtro queda sin pantallas.
    expect(filtro).toMatchObject({ modulo: { in: [] }, regionId: 'r1' });
  });

  it('el alcance de la región limita las filas y la consulta queda en la bitácora', async () => {
    const { servicio, prisma } = crear();
    const u = usuario('SUPERVISOR', 'REGION', ['pagina.usuarios', 'auditoria.ver'], { regionId: 'r1' });
    await servicio.listar({}, u as never);
    expect(prisma.registroAuditoria.findMany.mock.calls[0][0].where.AND[0]).toMatchObject({ modulo: { in: ['usuarios'] }, regionId: 'r1' });
    expect(prisma.consultaAuditoria.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tipo: 'CONSULTA', userId: 'u1' }) });
  });

  it('sin permiso de cédula o contacto, esos datos salen ocultos en el antes y el después', async () => {
    const { servicio, prisma } = crear();
    prisma.registroAuditoria.findMany.mockResolvedValue([
      { id: 'a1', createdAt: new Date(), actorNombre: 'X', actorRol: 'ADMIN', modulo: 'usuarios', accion: 'x', resumen: 'r', antes: { cedula: '1712345678', ciudad: 'Quito', telefono: '0991234567' }, despues: { cedula: '1798765432' }, datos: null },
    ]);
    const u = usuario('SUPERVISOR', 'REGION', ['pagina.usuarios', 'auditoria.ver'], { regionId: 'r1' });
    const r = await servicio.listar({}, u as never);
    expect(r.filas[0].antes).toEqual({ cedula: '[sin permiso]', ciudad: 'Quito', telefono: '[sin permiso]' });
    expect(r.filas[0].despues).toEqual({ cedula: '[sin permiso]' });
  });

  it('registrar nunca rompe: si la base falla, solo se avisa', async () => {
    const { servicio, prisma } = crear();
    prisma.registroAuditoria.create.mockRejectedValue(new Error('base caída'));
    await expect(servicio.registrar({ modulo: 'usuarios', accion: 'x', metodo: 'POST', ruta: 'x', resumen: 'r' }, usuario('ADMIN', 'GLOBAL', []))).resolves.toBeUndefined();
  });

  it('registrar oculta las contraseñas del cuerpo', async () => {
    const { servicio, prisma } = crear();
    await servicio.registrar({ modulo: 'usuarios', accion: 'x', metodo: 'POST', ruta: 'x', resumen: 'r', datos: { id: 'u2', password: 'Clave12345!' } }, usuario('ADMIN', 'GLOBAL', []));
    expect(prisma.registroAuditoria.create.mock.calls[0][0].data.datos).toEqual({ id: 'u2', password: '[oculto]' });
  });

  it('la bitácora de consultas exige su permiso', async () => {
    const { servicio } = crear();
    await expect(servicio.bitacora(usuario('SUPERVISOR', 'REGION', ['auditoria.ver']) as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(servicio.bitacora(usuario('ADMIN', 'GLOBAL', ['auditoria.bitacora']) as never)).resolves.toEqual([]);
  });
});
