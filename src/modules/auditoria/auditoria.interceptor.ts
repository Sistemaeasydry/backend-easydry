import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { PERMISO_KEY } from '../../common/permisos/permisos.decorators.js';
import { AuditoriaService } from './auditoria.service.js';
import { entidadDeCuerpo, esCambio, moduloDeRuta, partirRuta, resumenDe } from './auditoria.reglas.js';

/**
 * Rutas que dejan su propio registro, con el valor anterior y el nuevo: el interceptor no las duplica.
 * Se escriben como `prefijo/resto`, sin `api/v1`.
 */
export const RUTAS_CON_DETALLE: ReadonlySet<string> = new Set(['agencias/usuarios/update-datos', 'roles/update']);

/**
 * Deja constancia de todo cambio que termina bien: quién lo hizo, en qué pantalla, con qué datos (sin secretos) y cuándo.
 * Solo registra cambios (no consultas) y nunca interrumpe la respuesta.
 */
@Injectable()
export class AuditoriaInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditoria: AuditoriaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const url: string = req?.originalUrl ?? req?.url ?? '';
    const metodo: string = req?.method ?? '';
    const modulo = esCambio(metodo, url) ? moduloDeRuta(url) : null;
    if (!modulo) return next.handle();
    const { prefijo, resto } = partirRuta(url);
    if (RUTAS_CON_DETALLE.has(`${prefijo}/${resto}`)) return next.handle();

    return next.handle().pipe(
      tap(() => {
        const user = req?.user;
        if (!user?.id) return;
        const codigos = this.reflector.get<string[] | undefined>(PERMISO_KEY, context.getHandler());
        const accion = codigos?.[0] ?? null;
        const entidad = entidadDeCuerpo(req.body);
        void this.auditoria.registrar(
          {
            modulo,
            accion: accion ?? `${metodo.toUpperCase()} ${prefijo}/${resto}`,
            metodo: metodo.toUpperCase(),
            ruta: `${prefijo}/${resto}`,
            resumen: resumenDe(accion, metodo, url),
            entidadTipo: entidad.tipo,
            entidadId: entidad.id,
            datos: req.body,
            agenciaId: typeof req.body?.agenciaId === 'string' ? req.body.agenciaId : undefined,
            ip: req.ip ?? null,
          },
          user,
        );
      }),
    );
  }
}
