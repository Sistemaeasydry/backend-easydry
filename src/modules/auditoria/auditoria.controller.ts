import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Permiso } from '../../common/permisos/permisos.decorators.js';
import { AuditoriaService } from './auditoria.service.js';
import { ExportarAuditoriaDto, ListarAuditoriaDto } from './dto/auditoria.dto.js';

@ApiTags('Auditoría')
@Controller('auditoria')
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Permiso('auditoria.ver')
  @Post('opciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pantallas que el rol puede filtrar en la auditoría' })
  opciones(@CurrentUser() user: any) {
    return this.auditoria.opciones(user);
  }

  @Permiso('auditoria.ver')
  @Post('listar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quién hizo qué y cuándo, solo de las pantallas activas del rol y dentro de su alcance' })
  listar(@Body() dto: ListarAuditoriaDto, @CurrentUser() user: any) {
    return this.auditoria.listar(dto, user);
  }

  @Permiso('auditoria.exportar')
  @Post('exportar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Filas de la auditoría para exportar a Excel o PDF (con constancia en la bitácora)' })
  exportar(@Body() dto: ExportarAuditoriaDto, @CurrentUser() user: any) {
    return this.auditoria.exportar(dto, dto.formato, user);
  }

  @Permiso('auditoria.bitacora')
  @Post('bitacora')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quién consultó o exportó la auditoría' })
  bitacora(@CurrentUser() user: any) {
    return this.auditoria.bitacora(user);
  }
}
