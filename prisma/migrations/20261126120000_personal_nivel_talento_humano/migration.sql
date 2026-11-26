-- Nivel (JUNIOR | SENIOR) del personal operativo, solo para identificarlo. Los usuarios actuales quedan sin nivel hasta que se editen.
ALTER TABLE "User" ADD COLUMN "nivel" TEXT;

-- Talento Humano registra y edita usuarios (sin contraseñas ni roles) y ve en Gestión de Lavadores a todo el personal operativo.
-- Solo SUMA permisos a lo que ya tiene (nunca quita ni pisa lo que un administrador haya ajustado).
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY[
      'usuarios.gestionar', 'pagina.usuarios', 'pagina.usuarios.usuarios', 'usuarios.usuarios.crear', 'usuarios.usuarios.editar', 'usuarios.usuarios.estado',
      'operadores.gestionar', 'bahias.asignar', 'pagina.operadores', 'operadores.registrar', 'operadores.editar', 'operadores.bahia.asignar', 'operadores.personal_operativo',
      'datos.cedula.ver', 'datos.contacto.ver'
    ]::TEXT[])),
    "permisos" = ARRAY(SELECT DISTINCT unnest("permisos" || ARRAY['usuarios', 'operadores']::TEXT[])),
    "fechaModificacion" = CURRENT_TIMESTAMP
WHERE "namerol" = 'TALENTO_HUMANO';
