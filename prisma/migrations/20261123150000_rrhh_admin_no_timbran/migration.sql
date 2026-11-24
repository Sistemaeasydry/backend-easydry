-- ADMIN y SUPER_ADMIN no timbran: se les quita el permiso de timbrar (y sus casillas) que habían recibido. Siguen viendo las timbradas
-- del equipo y los horarios. Si más adelante se quiere que timbren, se activa desde Roles y permisos.
UPDATE "roles" r
   SET "capacidades" = ARRAY(
         SELECT c FROM unnest(r."capacidades") AS c
          WHERE c NOT IN ('rrhh.timbrar', 'pagina.rrhh-timbradas.marcar', 'rrhh-timbradas.marcar.obligatoria', 'rrhh.timbrada.obligatoria'))
 WHERE r."namerol" IN ('ADMIN', 'SUPER_ADMIN');
