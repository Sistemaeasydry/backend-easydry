import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DotacionesController } from './dotaciones.controller.js';
import { DotacionesCronService } from './dotaciones.cron.js';
import { DotacionesService } from './dotaciones.service.js';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [DotacionesController],
  providers: [DotacionesService, DotacionesCronService],
})
export class DotacionesModule {}
