-- RRHH: el personal operativo (líder y backup; lavador y pulidor ya no asignaban) solo recibe tareas: deja de asignarlas, revisarlas,
-- cancelarlas y reasignarlas. Conservan recibir y completar las suyas y ver las timbradas de su agencia.
-- Solo QUITA esas casillas a los dos roles oficiales; no se toca ninguna tabla de datos (las tareas ya asignadas siguen igual) y se
-- puede ejecutar más de una vez. Si se quiere devolver, se vuelve a marcar desde Roles y permisos.
UPDATE "roles" r
   SET "capacidades" = ARRAY(
         SELECT c FROM unnest(r."capacidades") AS c
          WHERE c <> ALL (ARRAY[
            'rrhh.tareas.asignar', 'rrhh.tareas.crear', 'rrhh.tareas.revisar', 'rrhh.tareas.cancelar', 'rrhh.tareas.reasignar',
            'pagina.rrhh-tareas.asignadas', 'rrhh-tareas.asignadas.crear', 'rrhh-tareas.asignadas.revisar', 'rrhh-tareas.asignadas.cancelar', 'rrhh-tareas.asignadas.reasignar'
          ]::text[]))
 WHERE r."namerol" IN ('LIDER', 'BACKUP')
   AND r."capacidades" && ARRAY['rrhh.tareas.asignar', 'pagina.rrhh-tareas.asignadas']::text[];
