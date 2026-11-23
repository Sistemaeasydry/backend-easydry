import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** Filtros de la auditoría. El servidor siempre los cruza con las pantallas activas del rol y con su alcance. */
export class ListarAuditoriaDto {
  @ApiPropertyOptional({ description: 'Código de la pantalla (p. ej. «usuarios», «rrhh/timbradas»)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  modulo?: string;

  @ApiPropertyOptional({ description: 'Parte del nombre de quien hizo el cambio' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  actor?: string;

  @ApiPropertyOptional({ description: 'Busca en el resumen y en la acción' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  texto?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD, hora de Ecuador' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  desde?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD, hora de Ecuador' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  hasta?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  tamano?: number;
}

export class ExportarAuditoriaDto extends ListarAuditoriaDto {
  @ApiPropertyOptional({ enum: ['EXCEL', 'PDF'] })
  @IsIn(['EXCEL', 'PDF'])
  formato!: 'EXCEL' | 'PDF';
}
