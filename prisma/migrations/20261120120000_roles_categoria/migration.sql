-- Categoría del rol: ADMINISTRACION u OPERADOR (aditiva).
ALTER TABLE "roles" ADD COLUMN "categoria" TEXT NOT NULL DEFAULT 'OPERADOR';

-- Los roles oficiales de oficina, coordinación y supervisión son de administración; el resto queda como operador.
UPDATE "roles" SET "categoria" = 'ADMINISTRACION' WHERE "namerol" IN ('ADMIN','APROBADOR','ASISTENTE_BODEGA','COORD_BODEGA','COORD_COMERCIAL','COORD_MANTENIMIENTO','COORD_SERVICIOS_ESPECIALES','JEFE_COMERCIAL','SUPERVISOR','SUPER_ADMIN');
