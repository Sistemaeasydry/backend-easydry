-- Avance de la atención de incidencias y mantenimientos: En camino y Atendiendo (con su fecha y hora).
-- Solo aditiva: columnas nulas y valores nuevos del tipo de notificación; no cambia datos existentes.
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'INCIDENCIA_EN_CAMINO';
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'INCIDENCIA_ATENDIENDO';
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'MANTENIMIENTO_EN_CAMINO';
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'MANTENIMIENTO_ATENDIENDO';

ALTER TABLE "IncidenteTecnico"
  ADD COLUMN "fechaEnCamino" TIMESTAMP(3),
  ADD COLUMN "fechaAtendiendo" TIMESTAMP(3);

ALTER TABLE "MantenimientoMaquinaria"
  ADD COLUMN "fechaEnCamino" TIMESTAMP(3),
  ADD COLUMN "fechaAtendiendo" TIMESTAMP(3);
