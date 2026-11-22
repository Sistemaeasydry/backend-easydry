import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CacheService } from '../../common/cache/cache.service.js';
import { DotacionesService } from './dotaciones.service.js';

@Injectable()
export class DotacionesCronService {
  private readonly logger = new Logger(DotacionesCronService.name);

  constructor(
    private readonly dotaciones: DotacionesService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  /** Todos los días a las 06:00: genera las entregas pendientes de los planes que tocan hoy. Con varias instancias, solo una lo ejecuta. */
  @Cron('0 6 * * *', { timeZone: 'America/Guayaquil' })
  async programado_generarEntregas(): Promise<void> {
    const tarea = async () => {
      try {
        const n = await this.dotaciones.generarEntregasPendientes();
        if (n) this.logger.log(`Entregas de dotación generadas: ${n}`);
      } catch (e: any) {
        this.logger.error(`No se pudieron generar las entregas de dotación: ${e?.message || e}`);
      }
    };
    if (this.cache) await this.cache.unaVez('cron:dotaciones', 3600, tarea);
    else await tarea();
  }
}
