-- Revisión de las limpiezas de maquinaria: el coordinador de mantenimiento las aprueba o las rechaza con un motivo.
-- Solo aditiva: no borra ni cambia datos existentes.
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'LIMPIEZA_RECHAZADA';

ALTER TABLE "LimpiezaMaquinaria"
  ADD COLUMN "estadoRevision" TEXT NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN "revisadoPorId" TEXT,
  ADD COLUMN "fechaRevision" TIMESTAMP(3),
  ADD COLUMN "motivoRechazo" TEXT;

-- Las limpiezas registradas antes de esta función quedan como aprobadas (sin revisor): solo las nuevas esperan revisión.
UPDATE "LimpiezaMaquinaria" SET "estadoRevision" = 'APROBADA';

ALTER TABLE "LimpiezaMaquinaria"
  ADD CONSTRAINT "LimpiezaMaquinaria_revisadoPorId_fkey" FOREIGN KEY ("revisadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "LimpiezaMaquinaria_estadoRevision_idx" ON "LimpiezaMaquinaria"("estadoRevision");
CREATE INDEX "LimpiezaMaquinaria_revisadoPorId_idx" ON "LimpiezaMaquinaria"("revisadoPorId");

-- Permiso nuevo para aprobar o rechazar limpiezas: lo reciben el coordinador de mantenimiento y los administradores.
-- Cualquier otro rol lo puede activar desde Roles.
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['limpiezas.aprobar', 'taller.limpiezas.aprobar']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" IN ('ADMIN', 'SUPER_ADMIN', 'COORD_MANTENIMIENTO');
