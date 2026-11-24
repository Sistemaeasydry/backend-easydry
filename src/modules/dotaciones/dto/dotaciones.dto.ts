import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FIRMA_PNG, MAX_BYTES_FIRMA_DOTACION, MAX_EVIDENCIAS_DOTACION, MODOS_ENTREGA } from '../dotaciones.reglas.js';

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export class GuardarCategoriaDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @IsNotEmpty() @MaxLength(60) nombre!: string;
  @IsOptional() @IsBoolean() activa?: boolean;
}

export class GuardarProductoDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @IsNotEmpty() @MaxLength(100) nombre!: string;
  @IsUUID() categoriaId!: string;
  @IsOptional() @IsBoolean() activo?: boolean;
}

export class IngresoStockDto {
  @IsUUID() productoId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) cantidad!: number;
  @IsOptional() @IsString() @MaxLength(300) nota?: string;
}

export class ProductoIdDto {
  @IsUUID() productoId!: string;
}

export class ItemPlanDto {
  @IsUUID() productoId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000) cantidad!: number;
}

export class GuardarPlanDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @IsNotEmpty() @MaxLength(120) nombre!: string;
  @IsIn(['FIJO', 'OCASIONAL']) tipo!: 'FIJO' | 'OCASIONAL';
  @Matches(DIA) fechaInicio!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) cadaMeses?: number;
  @IsArray() @IsString({ each: true }) roles!: string[];
  @IsArray() @IsUUID('all', { each: true }) agenciasIds!: string[];
  /** PERSONAS: una entrega y una firma por persona. AGENCIA: una sola entrega por agencia. */
  @IsIn(MODOS_ENTREGA as unknown as string[]) modoEntrega!: 'PERSONAS' | 'AGENCIA';
  /** Coordinador que sale a entregar. */
  @IsUUID() coordinadorId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ItemPlanDto) items!: ItemPlanDto[];
}

export class EstadoPlanDto {
  @IsUUID() id!: string;
  @IsBoolean() activo!: boolean;
}

export class ListarEntregasDto {
  @IsOptional() @IsIn(['PENDIENTE', 'ENTREGADA', 'OMITIDA']) estado?: 'PENDIENTE' | 'ENTREGADA' | 'OMITIDA';
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsString() @MaxLength(100) buscar?: string;
}

export class ItemEntregadoDto {
  @IsUUID() itemId!: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(1000) cantidadEntregada!: number;
}

export class EvidenciaDotacionDto {
  /** URL o clave del archivo ya subido con `storage/upload` (FOTO_DOTACION). */
  @IsString() @IsNotEmpty() @MaxLength(1000) url!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) nombre!: string;
}

export class RegistrarEntregaDto {
  @IsUUID() entregaId!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ItemEntregadoDto) items!: ItemEntregadoDto[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_EVIDENCIAS_DOTACION) @ValidateNested({ each: true }) @Type(() => EvidenciaDotacionDto) evidencias!: EvidenciaDotacionDto[];
  @IsOptional() @IsString() @MaxLength(500) nota?: string;
  /** Nombre de quien recibe. */
  @IsString() @MinLength(3) @MaxLength(120) recibeNombre!: string;
  /** Firma de quien recibe, dibujada en pantalla (PNG en data URL). */
  @IsString() @Matches(FIRMA_PNG, { message: 'La firma no es válida.' }) @MaxLength(MAX_BYTES_FIRMA_DOTACION) firmaRecibe!: string;
}

export class EntregaIdDto {
  @IsUUID() entregaId!: string;
}

export class OmitirEntregaDto {
  @IsUUID() entregaId!: string;
  @IsString() @MinLength(5) @MaxLength(300) motivo!: string;
}
