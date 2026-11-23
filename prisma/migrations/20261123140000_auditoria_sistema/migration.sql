-- Auditoría del sistema: registro inmutable de quién hizo qué y cuándo, y bitácora de quién la consultó o exportó.
-- Solo CREA tablas nuevas, el módulo del menú y los permisos de ADMIN y SUPER_ADMIN. No toca ningún dato existente.

-- CreateTable
CREATE TABLE "auditoria_registros" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "actorNombre" TEXT NOT NULL,
    "actorRol" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "entidadTipo" TEXT,
    "entidadId" TEXT,
    "resumen" TEXT NOT NULL,
    "antes" JSONB,
    "despues" JSONB,
    "datos" JSONB,
    "agenciaId" TEXT,
    "regionId" TEXT,
    "ip" TEXT,

    CONSTRAINT "auditoria_registros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria_consultas" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "userNombre" TEXT NOT NULL,
    "userRol" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "filtros" JSONB,
    "filas" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "auditoria_consultas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auditoria_registros_createdAt_idx" ON "auditoria_registros"("createdAt");
CREATE INDEX "auditoria_registros_modulo_createdAt_idx" ON "auditoria_registros"("modulo", "createdAt");
CREATE INDEX "auditoria_registros_actorId_createdAt_idx" ON "auditoria_registros"("actorId", "createdAt");
CREATE INDEX "auditoria_registros_agenciaId_idx" ON "auditoria_registros"("agenciaId");
CREATE INDEX "auditoria_registros_regionId_idx" ON "auditoria_registros"("regionId");
CREATE INDEX "auditoria_consultas_createdAt_idx" ON "auditoria_consultas"("createdAt");
CREATE INDEX "auditoria_consultas_userId_createdAt_idx" ON "auditoria_consultas"("userId", "createdAt");

-- Módulo del menú.
INSERT INTO "modulos_sistema" ("id", "codigo", "nombre", "descripcion", "icono", "rutaPrincipal", "grupo", "orden", "estado", "disponibleEnApp", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'auditoria', 'Auditoría', 'Quién hizo qué y cuándo en el sistema, con el valor anterior y el nuevo; cada rol ve solo los módulos que tiene activos y los cambios de su alcance', 'history', '/auditoria', 'Administración', 215, 1, false, CURRENT_TIMESTAMP)
ON CONFLICT ("codigo") DO NOTHING;

-- ADMIN y SUPER_ADMIN la ven, la exportan y consultan su bitácora (otros roles se configuran desde Roles y permisos). Solo SUMA permisos.
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['auditoria.ver', 'auditoria.exportar', 'auditoria.bitacora', 'pagina.auditoria']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" IN ('ADMIN', 'SUPER_ADMIN');
