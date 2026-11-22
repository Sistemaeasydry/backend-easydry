-- RRHH: las operaciones de tareas y de ubicaciones pasan a tener su propia casilla, como en los demás módulos.
-- Solo SUMA permisos: nadie pierde nada y no se toca ninguna tabla de datos. Cada rol recibe las casillas nuevas
-- únicamente si ya tenía el permiso del que salen, y solo las que aún no tiene (se puede ejecutar más de una vez).

-- Tareas: quien asignaba tareas conserva crear, revisar, cancelar y reasignar.
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.tareas.crear', 'rrhh.tareas.revisar', 'rrhh.tareas.cancelar', 'rrhh.tareas.reasignar']::text[]) AS c
          WHERE NOT (c = ANY (r."capacidades")))
 WHERE 'rrhh.tareas.asignar' = ANY (r."capacidades");

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh-tareas.asignadas.crear', 'rrhh-tareas.asignadas.revisar', 'rrhh-tareas.asignadas.cancelar', 'rrhh-tareas.asignadas.reasignar']::text[]) AS c
          WHERE NOT (c = ANY (r."capacidades")))
 WHERE 'pagina.rrhh-tareas.asignadas' = ANY (r."capacidades");

-- Timbradas del equipo: quien las ve conserva la exportación.
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY['rrhh-timbradas.equipo.exportar']::text[]
 WHERE 'pagina.rrhh-timbradas.equipo' = ANY (r."capacidades") AND NOT ('rrhh-timbradas.equipo.exportar' = ANY (r."capacidades"));

-- Ubicaciones: quien las configuraba conserva quitarlas.
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY['rrhh.ubicaciones.quitar']::text[]
 WHERE 'rrhh.ubicaciones.gestionar' = ANY (r."capacidades") AND NOT ('rrhh.ubicaciones.quitar' = ANY (r."capacidades"));

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY['agencias.agencias.ubicacion.quitar']::text[]
 WHERE 'agencias.agencias.ubicacion' = ANY (r."capacidades") AND NOT ('agencias.agencias.ubicacion.quitar' = ANY (r."capacidades"));

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY['inventario.bodegas.ubicacion.quitar']::text[]
 WHERE 'inventario.bodegas.ubicacion' = ANY (r."capacidades") AND NOT ('inventario.bodegas.ubicacion.quitar' = ANY (r."capacidades"));
