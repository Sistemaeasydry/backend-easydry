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

export class TallaProductoDto {
  @IsString() @IsNotEmpty() @MaxLength(20) nombre!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000) stock?: number;
}

export class GuardarProductoDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @IsNotEmpty() @MaxLength(100) nombre!: string;
  @IsUUID() categoriaId!: string;
  @IsOptional() @IsBoolean() activo?: boolean;
  @IsOptional() @IsBoolean() usaTallas?: boolean;
  /** Tallas del producto cuando usa tallas. Al activarlas en un producto que ya tiene stock, `stock` reparte ese stock. */
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => TallaProductoDto) tallas?: TallaProductoDto[];
}

export class IngresoStockDto {
  @IsUUID() productoId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) cantidad!: number;
  /** Obligatoria si el producto usa tallas. */
  @IsOptional() @IsString() @MaxLength(20) talla?: string;
  @IsOptional() @IsString() @MaxLength(300) nota?: string;
}

export class IdDto {
  @IsUUID() id!: string;
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
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) cadaMeses?: number;
  @IsArray() @IsString({ each: true }) roles!: string[];
  @IsArray() @IsUUID('all', { each: true }) agenciasIds!: string[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ItemPlanDto) items!: ItemPlanDto[];
}

export class EstadoPlanDto {
  @IsUUID() id!: string;
  @IsBoolean() activo!: boolean;
}

export class PlanIdDto {
  @IsUUID() planId!: string;
}

export class CrearEntregasDto {
  @IsUUID() planId!: string;
  /** PERSONAS: una entrega y una firma por persona. AGENCIA: una sola entrega por agencia. */
  @IsIn(MODOS_ENTREGA as unknown as string[]) modo!: 'PERSONAS' | 'AGENCIA';
  /** Ids de personas (modo PERSONAS) o de agencias (modo AGENCIA) que reciben. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @IsString({ each: true }) destinos!: string[];
  /** Coordinador que sale a entregar. */
  @IsUUID() coordinadorId!: string;
  /** Fecha en que se debe entregar, `AAAA-MM-DD` (hoy o futura). */
  @Matches(DIA) fecha!: string;
}

export class ReasignarEntregaDto {
  @IsUUID() entregaId!: string;
  @IsUUID() coordinadorId!: string;
}

export class ListarEntregasDto {
  /**
   * PENDIENTE = atrasadas y de hoy · PROGRAMADA = las que vienen (se habilitan en su fecha) · POR_ENTREGAR = pendientes + programadas ·
   * ENTREGADA / OMITIDA = cerradas. Sin estado: todas.
   */
  @IsOptional() @IsIn(['PENDIENTE', 'ENTREGADA', 'OMITIDA', 'PROGRAMADA', 'POR_ENTREGAR']) estado?: 'PENDIENTE' | 'ENTREGADA' | 'OMITIDA' | 'PROGRAMADA' | 'POR_ENTREGAR';
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsString() @MaxLength(100) buscar?: string;
  /** Rango de fecha programada, `AAAA-MM-DD` (ambos extremos incluidos). */
  @IsOptional() @Matches(DIA) desde?: string;
  @IsOptional() @Matches(DIA) hasta?: string;
}

export class TallaEntregadaDto {
  @IsString() @IsNotEmpty() @MaxLength(20) talla!: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(1000) cantidad!: number;
}

export class ItemEntregadoDto {
  @IsUUID() itemId!: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(1000) cantidadEntregada!: number;
  /** En productos con tallas, el reparto de lo entregado (la cantidad es la suma). */
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => TallaEntregadaDto) tallas?: TallaEntregadaDto[];
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
  /** Corta el ciclo: no programa la siguiente entrega a este destino. */
  @IsOptional() @IsBoolean() noRepetir?: boolean;
}
