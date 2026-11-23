-- RRHH: la timbrada obligatoria pasa a ser una casilla por rol (Roles y permisos). Solo SUMA permisos: nadie pierde nada y no se
-- toca ninguna tabla de datos. Se puede ejecutar más de una vez.
--
-- Quien ya timbraba conserva la obligación (se evalúa su horario y se avisa si falta una marca). ADMIN, SUPER_ADMIN y APROBADOR
-- quedan con timbrar voluntario: ADMIN y SUPER_ADMIN reciben la casilla de timbrar, sin la obligación.

-- Roles que timban: conservan la obligación, salvo los tres que parten como voluntarios.
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrada.obligatoria', 'rrhh-timbradas.marcar.obligatoria']::text[]) AS c
          WHERE NOT (c = ANY (r."capacidades")))
 WHERE 'rrhh.timbrar' = ANY (r."capacidades")
   AND r."namerol" NOT IN ('ADMIN', 'SUPER_ADMIN', 'APROBADOR');

-- ADMIN y SUPER_ADMIN pueden timbrar de forma voluntaria (antes no podían).
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.timbrar', 'pagina.rrhh-timbradas.marcar']::text[]) AS c
          WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" IN ('ADMIN', 'SUPER_ADMIN')
   AND 'pagina.rrhh-timbradas' = ANY (r."capacidades");
