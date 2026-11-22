import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Permiso } from '../../common/permisos/permisos.decorators.js';
import { DotacionesService } from './dotaciones.service.js';
import {
  EstadoPlanDto,
  GuardarCategoriaDto,
  GuardarPlanDto,
  GuardarProductoDto,
  IngresoStockDto,
  ListarEntregasDto,
  OmitirEntregaDto,
  ProductoIdDto,
  RegistrarEntregaDto,
} from './dto/dotaciones.dto.js';

/** Cada operación exige su permiso base o la casilla de la pantalla (ambas otorgan lo mismo). */
const GESTIONAR_PRODUCTOS = ['dotaciones.gestionar', 'dotaciones.productos.gestionar'];
const INGRESO = ['dotaciones.gestionar', 'dotaciones.productos.ingreso'];
const GESTIONAR_PLANES = ['dotaciones.gestionar', 'dotaciones.planes.gestionar'];
const ENTREGAR = ['dotaciones.entregar', 'dotaciones.entregas.registrar'];

@ApiTags('Dotaciones')
@ApiBearerAuth()
@Controller('dotaciones')
export class DotacionesController {
  constructor(private readonly dotaciones: DotacionesService) {}

  @Permiso('dotaciones.ver')
  @Post('categorias/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Categorías de dotación' })
  listarCategorias() {
    return this.dotaciones.listarCategorias();
  }

  @Permiso(...GESTIONAR_PRODUCTOS)
  @Post('categorias/guardar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crear o editar una categoría' })
  guardarCategoria(@Body() dto: GuardarCategoriaDto) {
    return this.dotaciones.guardarCategoria(dto);
  }

  @Permiso('dotaciones.ver')
  @Post('productos/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Productos de dotación con su stock' })
  listarProductos() {
    return this.dotaciones.listarProductos();
  }

  @Permiso(...GESTIONAR_PRODUCTOS)
  @Post('productos/guardar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crear o editar un producto (el stock solo cambia con ingresos y entregas)' })
  guardarProducto(@Body() dto: GuardarProductoDto) {
    return this.dotaciones.guardarProducto(dto);
  }

  @Permiso(...INGRESO)
  @Post('productos/ingreso')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registrar un ingreso de stock' })
  registrarIngreso(@Body() dto: IngresoStockDto, @CurrentUser() user: any) {
    return this.dotaciones.registrarIngreso(dto, user);
  }

  @Permiso('dotaciones.ver')
  @Post('productos/movimientos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ingresos y salidas de un producto' })
  movimientos(@Body() dto: ProductoIdDto) {
    return this.dotaciones.movimientos(dto.productoId);
  }

  @Permiso('dotaciones.ver')
  @Post('planes/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Planes de dotación' })
  listarPlanes() {
    return this.dotaciones.listarPlanes();
  }

  @Permiso(...GESTIONAR_PLANES)
  @Post('planes/guardar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crear o editar un plan' })
  guardarPlan(@Body() dto: GuardarPlanDto, @CurrentUser() user: any) {
    return this.dotaciones.guardarPlan(dto, user);
  }

  @Permiso(...GESTIONAR_PLANES)
  @Post('planes/estado')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar un plan' })
  estadoPlan(@Body() dto: EstadoPlanDto) {
    return this.dotaciones.estadoPlan(dto);
  }

  @Permiso('dotaciones.ver')
  @Post('entregas/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Entregas de dotación (pendientes, entregadas u omitidas)' })
  listarEntregas(@Body() dto: ListarEntregasDto) {
    return this.dotaciones.listarEntregas(dto);
  }

  @Permiso(...ENTREGAR)
  @Post('entregas/registrar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Registrar una entrega con cantidades y evidencia; descuenta el stock' })
  registrarEntrega(@Body() dto: RegistrarEntregaDto, @CurrentUser() user: any) {
    return this.dotaciones.registrarEntrega(dto, user);
  }

  @Permiso(...ENTREGAR)
  @Post('entregas/omitir')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Omitir una entrega pendiente con su motivo' })
  omitirEntrega(@Body() dto: OmitirEntregaDto, @CurrentUser() user: any) {
    return this.dotaciones.omitirEntrega(dto, user);
  }
}
