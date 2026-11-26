import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AgenciasService } from './agencias.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: en Gestión de Lavadores cada botón tiene su permiso —editar datos y asignar o quitar de una
 * bahía— y el servidor los exige por separado aunque el formulario los mande juntos. Además, dejar a un
 * lavador sin bahía («en reserva») funciona de verdad.
 */
describe('Gestión de Lavadores: permisos por botón (base real)', () => {
  let env: Entorno;
  let service: AgenciasService;
  let agencia: any;
  let bahia: any;
  let otraBahia: any;
  let admin: any;

  /** Quien llama, con exactamente estos permisos. */
  const con = (...capacidades: string[]) => ({ id: admin.id, role: { namerol: 'ROL_DE_PRUEBA', capacidades } });
  const bahiaActual = async (usuarioId: string) =>
    (await env.prisma.bahiaOperador.findFirst({ where: { operadorId: usuarioId, activo: true } }))?.bahiaId ?? null;

  /** Un lavador nuevo con su bahía ya asignada. */
  const lavadorEnBahia = async (sufijo: string) => {
    const l = await env.usuario(sufijo, 'LAVADOR', { agenciaId: agencia.id });
    await service.asignarOperadorABahia({ bahiaId: bahia.id, operadorId: l.id } as any, admin.id);
    return l;
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AgenciasService(env.prisma as never);
    agencia = await env.agencia('A1', { numeroBahias: 2, maxLavadoresPorBahia: 1 });
    bahia = await env.bahia('B1', agencia.id);
    otraBahia = await env.bahia('B2', agencia.id);
    admin = await env.usuario('admin', 'ADMIN');
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('dejar a un lavador sin bahía (en reserva)', () => {
    it('con «Asignar y quitar de bahía» queda sin bahía, tanto con null como con cadena vacía', async () => {
      for (const vacio of [null, '']) {
        const l = await lavadorEnBahia(`reserva${vacio === null ? 'N' : 'V'}`);
        expect(await bahiaActual(l.id)).toBe(bahia.id);

        await service.updateOperador({ id: l.id, bahiaId: vacio } as any, admin.id, con('operadores.bahia.asignar'));

        expect(await bahiaActual(l.id)).toBeNull();
        expect((await env.prisma.bahia.findUniqueOrThrow({ where: { id: bahia.id } })).operadorActualId).toBeNull();
      }
    });

    it('sin el permiso de bahía el servidor lo rechaza y no cambia nada', async () => {
      const l = await lavadorEnBahia('sinQuitar');

      await expect(
        service.updateOperador({ id: l.id, bahiaId: null } as any, admin.id, con('operadores.editar')),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(await bahiaActual(l.id)).toBe(bahia.id);
      await service.asignarOperadorABahia({ bahiaId: bahia.id, operadorId: null } as any, admin.id);
    });

    it('dejar sin bahía a quien ya estaba sin bahía no exige nada', async () => {
      const l = await env.usuario('yaEnReserva', 'LAVADOR', { agenciaId: agencia.id });

      await expect(service.updateOperador({ id: l.id, bahiaId: '' } as any, admin.id, con('operadores.ver'))).resolves.toBeDefined();
    });
  });

  describe('asignar a otra bahía', () => {
    it('con «Asignar y quitar de bahía» cambia de bahía', async () => {
      const l = await lavadorEnBahia('cambia');

      await service.updateOperador({ id: l.id, bahiaId: otraBahia.id } as any, admin.id, con('operadores.bahia.asignar'));

      expect(await bahiaActual(l.id)).toBe(otraBahia.id);
      await service.asignarOperadorABahia({ bahiaId: otraBahia.id, operadorId: null } as any, admin.id);
    });

    it('mandar la bahía que ya tiene no cuenta como asignar', async () => {
      const l = await lavadorEnBahia('misma');

      await expect(
        service.updateOperador({ id: l.id, bahiaId: bahia.id } as any, admin.id, con('operadores.editar')),
      ).resolves.toBeDefined();
      await service.asignarOperadorABahia({ bahiaId: bahia.id, operadorId: null } as any, admin.id);
    });

    it('«Asignar lavadores a bahía» de Gestión de Agencias también vale (es la misma acción en otra pantalla)', async () => {
      const l = await lavadorEnBahia('desdeAgencias');

      await service.updateOperador({ id: l.id, bahiaId: otraBahia.id } as any, admin.id, con('agencias.bahias.asignar'));

      expect(await bahiaActual(l.id)).toBe(otraBahia.id);
      await service.asignarOperadorABahia({ bahiaId: otraBahia.id, operadorId: null } as any, admin.id);
    });
  });

  describe('editar datos: el rol no se cambia desde esta pantalla', () => {
    it('con «Editar datos» puede cambiar los datos', async () => {
      const l = await env.usuario('soloEditar', 'LAVADOR', { agenciaId: agencia.id, name: 'Original' });

      await service.updateOperador({ id: l.id, nombres: 'Nuevo', apellidos: 'Apellido Uno', nivel: 'SENIOR' } as any, admin.id, con('operadores.editar'));
      expect(await env.prisma.user.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ name: 'Nuevo', lastname: 'Apellido Uno', nivel: 'SENIOR' });
    });

    it('aunque se envíe un rol distinto, el rol queda como estaba', async () => {
      const l = await env.usuario('rolIgnorado', 'LAVADOR', { agenciaId: agencia.id });

      await service.updateOperador({ id: l.id, rol: 'PULIDOR' } as any, admin.id, con('operadores.editar'));
      expect((await env.prisma.user.findUniqueOrThrow({ where: { id: l.id }, include: { role: true } })).role.namerol).toBe('LAVADOR');
    });

    it('sin el permiso no cambia nada', async () => {
      const l = await env.usuario('ninguno', 'LAVADOR', { agenciaId: agencia.id, name: 'Intacto' });

      await expect(service.updateOperador({ id: l.id, nombres: 'Cambio', apellidos: 'Total', nivel: 'JUNIOR' } as any, admin.id, con('operadores.ver'))).rejects.toBeInstanceOf(ForbiddenException);
      expect((await env.prisma.user.findUniqueOrThrow({ where: { id: l.id } })).name).toBe('Intacto');
    });
  });

  describe('protecciones del personal operativo', () => {
    const base = { nombres: 'Ana', apellidos: 'Prueba', password: 'Lavado#2026Seco', nivel: 'JUNIOR' };

    it('por esta pantalla no se puede crear un administrador ni un líder', async () => {
      for (const rol of ['ADMIN', 'LIDER']) {
        const dto = { ...base, cedula: '0966666666', rol, agenciaId: agencia.id } as any;
        await expect(service.createOperador(dto, admin.id, con('operadores.registrar'))).rejects.toThrow(/solo se registran lavadores y pulidores/);
      }
    });

    it('el nivel es obligatorio al registrar', async () => {
      const dto = { ...base, nivel: undefined, cedula: '0955555555', rol: 'LAVADOR', agenciaId: agencia.id } as any;
      await expect(service.createOperador(dto, admin.id, con('operadores.registrar'))).rejects.toThrow(/Junior o Senior/);
    });

    it('no se puede editar a personal administrativo', async () => {
      await expect(service.updateOperador({ id: admin.id, estado: 0 } as any, admin.id, con('operadores.editar'))).rejects.toThrow(/solo se edita al personal operativo/);
    });

    it('la casilla de todo el personal operativo hace aparecer a los líderes; sin ella no', async () => {
      const lider = await env.usuario('lider-visible', 'LIDER', { agenciaId: agencia.id });
      const lista = async (...caps: string[]) => ((await service.listOperadores({ agenciaId: agencia.id } as any, { ...con(...caps), role: { ...con(...caps).role, ambito: 'GLOBAL' } })) as any[]).map((x) => x.id);
      expect(await lista('operadores.ver', 'operadores.editar')).not.toContain(lider.id);
      expect(await lista('operadores.ver', 'operadores.editar', 'operadores.personal_operativo')).toContain(lider.id);
    });

    it('quien gestiona usuarios sin ser administrador no puede tocar ni crear administradores', async () => {
      const gestor = con('usuarios.gestionar');
      await expect(service.toggleEstadoUsuario({ usuarioId: admin.id, estado: 0 } as any, gestor)).rejects.toThrow(/Solo un Admin/);
      await expect(service.updateUsuario({ id: admin.id, name: 'Otro' } as any, gestor)).rejects.toThrow(/Solo un Admin/);
      await expect(
        service.createUsuario({ name: 'X', lastname: 'Y', email: `${env.marca}-adm@prueba.local`, password: 'Lavado#2026Seco', rolNombre: 'ADMIN' } as any, gestor),
      ).rejects.toThrow(/Solo un Admin/);
      const l = await env.usuario('para-ascender', 'LAVADOR', { agenciaId: agencia.id });
      const rolAdmin = await env.prisma.role.findUniqueOrThrow({ where: { namerol: 'ADMIN' } });
      await expect(service.updateUsuario({ id: l.id, roleId: rolAdmin.id } as any, gestor)).rejects.toThrow(/Solo un Admin/);
    });
  });

  describe('Talento Humano gestiona usuarios (con los permisos reales de su rol)', () => {
    const talentoHumano = async () => {
      const rol = await env.prisma.role.findUniqueOrThrow({ where: { namerol: 'TALENTO_HUMANO' } });
      return { id: admin.id, role: { namerol: 'TALENTO_HUMANO', ambito: 'GLOBAL', capacidades: rol.capacidades } };
    };

    it('crea un operativo con nivel, lo ve en Usuarios y en Lavadores, y le cambia el nivel desde ambas', async () => {
      const th = await talentoHumano();
      const creado: any = await service.createUsuario(
        { name: 'Ana', lastname: 'Nivel', email: `${env.marca}-nivel@prueba.local`, password: 'Lavado#2026Seco', rolNombre: 'LAVADOR', agenciaId: agencia.id, nivel: 'JUNIOR' } as never,
        th,
      );
      env.rastrear('User', creado.user.id);
      expect(creado.user.nivel).toBe('JUNIOR');
      const enUsuarios = async () => ((await service.listUsuariosPorAgencia({ page: 1, pageSize: 50, agenciaId: agencia.id } as never, th)) as any).items.find((u: any) => u.id === creado.user.id);
      const enLavadores = async () => ((await service.listOperadores({ agenciaId: agencia.id } as never, th)) as any[]).find((u) => u.id === creado.user.id);
      expect(await enUsuarios()).toMatchObject({ nivel: 'JUNIOR', role: { categoria: 'OPERADOR' } });
      expect(await enLavadores()).toMatchObject({ nivel: 'JUNIOR' });
      await service.updateUsuario({ id: creado.user.id, name: 'Ana', nivel: 'SENIOR' } as never, th);
      expect((await enUsuarios()).nivel).toBe('SENIOR');
      await service.updateOperador({ id: creado.user.id, nombres: 'Ana', apellidos: 'Nivel', nivel: 'JUNIOR' } as never, admin.id, th);
      expect((await enLavadores()).nivel).toBe('JUNIOR');
    });

    it('no puede crear Backups ni administradores', async () => {
      const th = await talentoHumano();
      const base = { name: 'X', lastname: 'Y', password: 'Lavado#2026Seco', agenciaId: agencia.id, nivel: 'JUNIOR' };
      for (const rolNombre of ['BACKUP', 'ADMIN']) {
        await expect(service.createUsuario({ ...base, email: `${env.marca}-th-crea-${rolNombre}@prueba.local`, rolNombre } as never, th)).rejects.toBeInstanceOf(ForbiddenException);
      }
    });
  });

  describe('registrar con bahía', () => {
    it('registrar a alguien con una bahía asignada exige «Asignar a bahía» además de «Registrar»', async () => {
      const dto = { nombres: 'Nuevo', apellidos: 'Lavador', nivel: 'JUNIOR', cedula: '0999999999', password: 'Lavado#2026Seco', rol: 'LAVADOR', agenciaId: agencia.id, bahiaId: bahia.id } as any;

      await expect(service.createOperador(dto, admin.id, con('operadores.registrar'))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('registrar sin bahía (en reserva) solo exige «Registrar»', async () => {
      const dto = { nombres: 'Reserva', apellidos: 'Lavador', nivel: 'JUNIOR', cedula: '0988888888', password: 'Lavado#2026Seco', rol: 'LAVADOR', agenciaId: agencia.id } as any;

      const creado: any = await service.createOperador(dto, admin.id, con('operadores.registrar'));

      expect(creado.id).toBeTruthy();
      // Ya no hay contraseña temporal: la define quien registra y no se devuelve.
      expect(JSON.stringify(creado)).not.toMatch(/passwordTemporal|Lavado#2026Seco/);
      env.rastrear('User', creado.id);
      // Apellidos y nombres se guardan separados y la cédula en su propio campo; se presentan primero los apellidos.
      expect(await env.prisma.user.findUniqueOrThrow({ where: { id: creado.id } })).toMatchObject({ name: 'Reserva', lastname: 'Lavador', cedula: '0988888888', nivel: 'JUNIOR' });
      expect(creado).toMatchObject({ nombre: 'Lavador Reserva', apellidos: 'Lavador', nombres: 'Reserva' });
    });

    it('la contraseña es obligatoria y debe tener al menos 8 caracteres', async () => {
      const base = { nombres: 'Sin', apellidos: 'Clave', nivel: 'JUNIOR', cedula: '0977777777', rol: 'LAVADOR', agenciaId: agencia.id } as any;
      await expect(service.createOperador(base, admin.id, con('operadores.registrar'))).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createOperador({ ...base, password: 'corta12' }, admin.id, con('operadores.registrar'))).rejects.toThrow(/al menos 8 caracteres/);
      expect(await env.prisma.user.count({ where: { email: 'op.0977777777@easydry.internal' } })).toBe(0);
    });
  });
});
