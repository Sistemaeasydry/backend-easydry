-- Dotaciones: un coordinador entrega (por plan), la entrega puede ser a la agencia completa o persona por persona,
-- y al final se registra quién recibió y su firma en pantalla.
ALTER TABLE "dotaciones_planes" ADD COLUMN "modoEntrega" TEXT NOT NULL DEFAULT 'PERSONAS',
ADD COLUMN "coordinadorId" TEXT;

ALTER TABLE "dotaciones_entregas" ADD COLUMN "claveDestino" TEXT,
ADD COLUMN "personasCubiertas" INTEGER,
ADD COLUMN "recibeNombre" TEXT,
ADD COLUMN "firmaRecibe" TEXT;

-- Las entregas que ya existen eran a una persona: su destino es esa persona.
UPDATE "dotaciones_entregas" SET "claveDestino" = "personaId";

ALTER TABLE "dotaciones_entregas" ALTER COLUMN "claveDestino" SET NOT NULL,
ALTER COLUMN "personaId" DROP NOT NULL;

DROP INDEX "dotaciones_entregas_planId_personaId_fechaProgramada_key";
CREATE UNIQUE INDEX "dotaciones_entregas_planId_claveDestino_fechaProgramada_key" ON "dotaciones_entregas"("planId", "claveDestino", "fechaProgramada");

ALTER TABLE "dotaciones_entregas" DROP CONSTRAINT "dotaciones_entregas_personaId_fkey";
ALTER TABLE "dotaciones_entregas" ADD CONSTRAINT "dotaciones_entregas_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
