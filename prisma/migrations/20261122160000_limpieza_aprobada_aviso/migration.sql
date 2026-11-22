-- Aviso a quien registró la limpieza cuando el coordinador la aprueba (solo agrega un valor al tipo de notificación).
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'LIMPIEZA_APROBADA';
