import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuditoriaController } from './auditoria.controller.js';
import { AuditoriaInterceptor } from './auditoria.interceptor.js';
import { AuditoriaService } from './auditoria.service.js';

/** Global: cualquier servicio puede dejar un registro con el valor anterior y el nuevo (`AuditoriaService.registrar`). */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AuditoriaController],
  providers: [AuditoriaService, { provide: APP_INTERCEPTOR, useClass: AuditoriaInterceptor }],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
