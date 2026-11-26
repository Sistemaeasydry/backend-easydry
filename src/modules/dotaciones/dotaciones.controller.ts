import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Permiso } from '../../common/permisos/permisos.decorators.js';
import { DotacionesService } from './dotaciones.service.js';
import {
  CrearEntregasDto,
  EntregaIdDto,
  EstadoPlanDto,
  GuardarCategoriaDto,
  GuardarPlanDto,
  GuardarProductoDto,
  IdDto,
  IngresoStockDto,
  ListarEntregasDto,
  OmitirEntregaDto,
  PlanIdDto,
  ProductoIdDto,
  ReasignarEntregaDto,
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

  @Permiso(...GESTIONAR_PRODUCTOS)
  @Post('categorias/eliminar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar una categoría sin productos' })
  eliminarCategoria(@Body() dto: IdDto) {
    return this.dotaciones.eliminarCategoria(dto.id);
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

  @Permiso(...GESTIONAR_PRODUCTOS)
  @Post('productos/eliminar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar un producto que no está en planes ni entregas' })
  eliminarProducto(@Body() dto: IdDto) {
    return this.dotaciones.eliminarProducto(dto.id);
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

  @Permiso(...GESTIONAR_PLANES)
  @Post('planes/eliminar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Eliminar un plan sin entregas realizadas' })
  eliminarPlan(@Body() dto: IdDto) {
    return this.dotaciones.eliminarPlan(dto.id);
  }

  @Permiso('dotaciones.ver')
  @Post('entregas/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Entregas de dotación (pendientes, entregadas u omitidas)' })
  listarEntregas(@Body() dto: ListarEntregasDto, @CurrentUser() user: any) {
    return this.dotaciones.listarEntregas(dto, user);
  }

  @Permiso('dotaciones.ver')
  @Post('entregas/firma')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nombre y firma de quien recibió una entrega' })
  firmaEntrega(@Body() dto: EntregaIdDto, @CurrentUser() user: any) {
    return this.dotaciones.firmaDeEntrega(dto.entregaId, user);
  }

  @Permiso(...GESTIONAR_PLANES)
  @Post('coordinadores/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Personas que pueden salir a entregar (rol con permiso de registrar entregas)' })
  listarCoordinadores() {
    return this.dotaciones.listarCoordinadores();
  }

  @Permiso(...GESTIONAR_PLANES)
  @Post('entregas/destinos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Personas y agencias a las que se les puede crear una entrega de un plan' })
  destinosDeEntrega(@Body() dto: PlanIdDto) {
    return this.dotaciones.destinosParaEntrega(dto.planId);
  }

  @Permiso(...GESTIONAR_PLANES)
  @Post('entregas/crear')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crear entregas: a quién, quién las entrega y en qué fecha' })
  crearEntregas(@Body() dto: CrearEntregasDto) {
    return this.dotaciones.crearEntregas(dto);
  }

  @Permiso(...GESTIONAR_PLANES)
  @Post('entregas/reasignar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar quién hace una entrega pendiente' })
  reasignarEntrega(@Body() dto: ReasignarEntregaDto) {
    return this.dotaciones.reasignarEntrega(dto);
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
