-- Dotaciones (RRHH): categorías, productos con stock propio, planes, entregas y evidencias.
-- Solo CREA tablas nuevas, el módulo del menú y los permisos del SUPER_ADMIN. No toca ningún dato existente.

-- CreateTable
CREATE TABLE "dotaciones_categorias" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dotaciones_categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dotaciones_productos" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dotaciones_productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dotaciones_movimientos" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "stockDespues" INTEGER NOT NULL,
    "nota" TEXT,
    "entregaId" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dotaciones_movimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dotaciones_planes" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "fechaInicio" DATE NOT NULL,
    "cadaMeses" INTEGER,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agenciasIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dotaciones_planes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dotaciones_planes_items" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "dotaciones_planes_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dotaciones_entregas" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "fechaProgramada" DATE NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "entregadaEn" TIMESTAMP(3),
    "entregadaPorId" TEXT,
    "nota" TEXT,
    "agenciaId" TEXT,
    "regionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dotaciones_entregas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dotaciones_entregas_items" (
    "id" TEXT NOT NULL,
    "entregaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidadPlan" INTEGER NOT NULL,
    "cantidadEntregada" INTEGER,

    CONSTRAINT "dotaciones_entregas_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dotaciones_entregas_evidencias" (
    "id" TEXT NOT NULL,
    "entregaId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamanioBytes" INTEGER NOT NULL,
    "subidoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dotaciones_entregas_evidencias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dotaciones_categorias_nombre_key" ON "dotaciones_categorias"("nombre");

-- CreateIndex
CREATE INDEX "dotaciones_productos_categoriaId_idx" ON "dotaciones_productos"("categoriaId");

-- CreateIndex
CREATE UNIQUE INDEX "dotaciones_productos_categoriaId_nombre_key" ON "dotaciones_productos"("categoriaId", "nombre");

-- CreateIndex
CREATE INDEX "dotaciones_movimientos_productoId_createdAt_idx" ON "dotaciones_movimientos"("productoId", "createdAt");

-- CreateIndex
CREATE INDEX "dotaciones_movimientos_entregaId_idx" ON "dotaciones_movimientos"("entregaId");

-- CreateIndex
CREATE INDEX "dotaciones_planes_activo_idx" ON "dotaciones_planes"("activo");

-- CreateIndex
CREATE UNIQUE INDEX "dotaciones_planes_items_planId_productoId_key" ON "dotaciones_planes_items"("planId", "productoId");

-- CreateIndex
CREATE INDEX "dotaciones_entregas_estado_fechaProgramada_idx" ON "dotaciones_entregas"("estado", "fechaProgramada");

-- CreateIndex
CREATE INDEX "dotaciones_entregas_personaId_idx" ON "dotaciones_entregas"("personaId");

-- CreateIndex
CREATE UNIQUE INDEX "dotaciones_entregas_planId_personaId_fechaProgramada_key" ON "dotaciones_entregas"("planId", "personaId", "fechaProgramada");

-- CreateIndex
CREATE INDEX "dotaciones_entregas_items_entregaId_idx" ON "dotaciones_entregas_items"("entregaId");

-- CreateIndex
CREATE INDEX "dotaciones_entregas_evidencias_entregaId_idx" ON "dotaciones_entregas_evidencias"("entregaId");

-- AddForeignKey
ALTER TABLE "dotaciones_productos" ADD CONSTRAINT "dotaciones_productos_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "dotaciones_categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotaciones_movimientos" ADD CONSTRAINT "dotaciones_movimientos_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "dotaciones_productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotaciones_planes_items" ADD CONSTRAINT "dotaciones_planes_items_planId_fkey" FOREIGN KEY ("planId") REFERENCES "dotaciones_planes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotaciones_planes_items" ADD CONSTRAINT "dotaciones_planes_items_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "dotaciones_productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotaciones_entregas" ADD CONSTRAINT "dotaciones_entregas_planId_fkey" FOREIGN KEY ("planId") REFERENCES "dotaciones_planes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotaciones_entregas" ADD CONSTRAINT "dotaciones_entregas_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotaciones_entregas_items" ADD CONSTRAINT "dotaciones_entregas_items_entregaId_fkey" FOREIGN KEY ("entregaId") REFERENCES "dotaciones_entregas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotaciones_entregas_items" ADD CONSTRAINT "dotaciones_entregas_items_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "dotaciones_productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dotaciones_entregas_evidencias" ADD CONSTRAINT "dotaciones_entregas_evidencias_entregaId_fkey" FOREIGN KEY ("entregaId") REFERENCES "dotaciones_entregas"("id") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO "modulos_sistema" ("id", "codigo", "nombre", "descripcion", "icono", "rutaPrincipal", "grupo", "orden", "estado", "disponibleEnApp", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'rrhh/dotaciones', 'Dotaciones', 'Uniformes, EPP y otros productos con stock propio, planes de entrega por rol o agencia y entregas con evidencia fotográfica', 'package-check', '/rrhh/dotaciones', 'RRHH', 156, 1, false, CURRENT_TIMESTAMP)
ON CONFLICT ("codigo") DO NOTHING;

-- Solo SUPER_ADMIN (otros roles se configuran desde Roles). Suma permisos sin quitar ninguno.
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['dotaciones.ver', 'dotaciones.gestionar', 'dotaciones.entregar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'SUPER_ADMIN';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.dotaciones', 'pagina.dotaciones.entregas', 'pagina.dotaciones.productos', 'pagina.dotaciones.planes',
           'dotaciones.entregas.registrar', 'dotaciones.productos.gestionar', 'dotaciones.productos.ingreso', 'dotaciones.planes.gestionar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'SUPER_ADMIN' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');
