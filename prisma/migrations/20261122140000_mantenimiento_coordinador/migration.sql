-- Coordinador de mantenimiento responsable del mantenimiento (opcional al programar; obligatorio al asignar).
-- Solo aditiva: una columna nula con su llave foránea y su índice; los mantenimientos existentes no cambian.
ALTER TABLE "MantenimientoMaquinaria" ADD COLUMN "coordinadorId" TEXT;
ALTER TABLE "MantenimientoMaquinaria"
  ADD CONSTRAINT "MantenimientoMaquinaria_coordinadorId_fkey" FOREIGN KEY ("coordinadorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "MantenimientoMaquinaria_coordinadorId_idx" ON "MantenimientoMaquinaria"("coordinadorId");
