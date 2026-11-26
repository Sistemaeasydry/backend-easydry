-- Las tareas de un informe nacen de sus planes de acción (ya no de las novedades). Las tareas antiguas conservan su novedad.
ALTER TABLE "InformePlanAccion" ADD COLUMN "responsableId" TEXT;
ALTER TABLE "tareas_rrhh" ADD COLUMN "planId" TEXT;
CREATE UNIQUE INDEX "tareas_rrhh_planId_key" ON "tareas_rrhh"("planId");

-- Admin y Super Admin también reciben tareas (siguen sin timbrar). Solo SUMA permisos.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['rrhh.tareas.propias', 'pagina.rrhh-tareas', 'pagina.rrhh-tareas.mis']::TEXT[])),
    "permisos" = ARRAY(SELECT DISTINCT unnest("permisos" || ARRAY['rrhh/tareas']::TEXT[])),
    "fechaModificacion" = CURRENT_TIMESTAMP
WHERE "namerol" IN ('ADMIN', 'SUPER_ADMIN');
