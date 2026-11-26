-- Dotaciones: los productos pueden manejar tallas (con stock por talla); el plan solo dice qué, a quién y cada cuánto; quién entrega se
-- elige al crear cada entrega, y al registrarla se programa la siguiente contando desde la fecha en que se entregó.
ALTER TYPE "TipoNotificacion" ADD VALUE 'DOTACION_POR_ENTREGAR';

ALTER TABLE "dotaciones_productos" ADD COLUMN "usaTallas" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "dotaciones_productos_tallas" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "orden" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "dotaciones_productos_tallas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dotaciones_productos_tallas_productoId_nombre_key" ON "dotaciones_productos_tallas"("productoId", "nombre");
ALTER TABLE "dotaciones_productos_tallas" ADD CONSTRAINT "dotaciones_productos_tallas_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "dotaciones_productos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dotaciones_movimientos" ADD COLUMN "talla" TEXT;
ALTER TABLE "dotaciones_entregas_items" ADD COLUMN "tallas" JSONB;

-- Quien entrega pasa del plan a cada entrega.
ALTER TABLE "dotaciones_entregas" ADD COLUMN "coordinadorId" TEXT;
UPDATE "dotaciones_entregas" e SET "coordinadorId" = p."coordinadorId" FROM "dotaciones_planes" p WHERE p."id" = e."planId";
CREATE INDEX "dotaciones_entregas_coordinadorId_idx" ON "dotaciones_entregas"("coordinadorId");

-- Antes las entregas salían del calendario del plan. Para no cortar los ciclos que ya existen, cada destino de un plan fijo activo cuya
-- última entrega ya se cerró (y no tiene otra pendiente) queda programado `cadaMeses` después de la fecha en que se cerró.
CREATE TEMPORARY TABLE "_dotaciones_siguientes" AS
SELECT gen_random_uuid()::text AS "id", u.*,
       (((u."cerradaEn" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Guayaquil')::date + make_interval(months => u."cadaMeses"))::date AS "fecha"
FROM (
  SELECT DISTINCT ON (e."planId", e."claveDestino")
         e."planId", e."claveDestino", e."personaId", e."agenciaId", e."regionId", e."personasCubiertas", e."coordinadorId",
         COALESCE(e."entregadaEn", e."createdAt") AS "cerradaEn", p."cadaMeses"
  FROM "dotaciones_entregas" e
  JOIN "dotaciones_planes" p ON p."id" = e."planId"
  LEFT JOIN "User" persona ON persona."id" = e."personaId"
  WHERE p."activo" AND p."tipo" = 'FIJO' AND p."cadaMeses" >= 1
    AND (e."personaId" IS NULL OR persona."estado" = 1)
    AND NOT EXISTS (SELECT 1 FROM "dotaciones_entregas" x WHERE x."planId" = e."planId" AND x."claveDestino" = e."claveDestino" AND x."estado" = 'PENDIENTE')
  ORDER BY e."planId", e."claveDestino", e."fechaProgramada" DESC
) u;

INSERT INTO "dotaciones_entregas" ("id", "planId", "personaId", "claveDestino", "personasCubiertas", "fechaProgramada", "agenciaId", "regionId", "coordinadorId")
SELECT "id", "planId", "personaId", "claveDestino", "personasCubiertas", "fecha", "agenciaId", "regionId", "coordinadorId"
FROM "_dotaciones_siguientes"
ON CONFLICT ("planId", "claveDestino", "fechaProgramada") DO NOTHING;

INSERT INTO "dotaciones_entregas_items" ("id", "entregaId", "productoId", "cantidadPlan")
SELECT gen_random_uuid()::text, s."id", i."productoId", i."cantidad" * COALESCE(s."personasCubiertas", 1)
FROM "_dotaciones_siguientes" s
JOIN "dotaciones_entregas" e ON e."id" = s."id"
JOIN "dotaciones_planes_items" i ON i."planId" = s."planId";

DROP TABLE "_dotaciones_siguientes";

ALTER TABLE "dotaciones_planes" DROP COLUMN "fechaInicio",
DROP COLUMN "modoEntrega",
DROP COLUMN "coordinadorId";
