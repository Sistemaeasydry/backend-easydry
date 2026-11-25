-- Talento Humano, Contabilidad y Marketing (personal de la Oficina Matriz) ven los retos activos, en la web y en la app.
-- Solo SUMA permisos y el módulo "productividad" a lo que ya tienen (nunca quita ni pisa lo que un administrador haya ajustado).

UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['retos.ver', 'sistema.app.retos', 'pagina.productividad', 'pagina.productividad.retos']::TEXT[])),
    "permisos" = ARRAY(SELECT DISTINCT unnest("permisos" || ARRAY['productividad']::TEXT[])),
    "fechaModificacion" = CURRENT_TIMESTAMP
WHERE "namerol" = 'TALENTO_HUMANO';

-- Contabilidad y Marketing: la página de retos exige poder consultar agencias y la página de sistema (sincronizar) para la app.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['retos.ver', 'sistema.app.retos', 'pagina.productividad', 'pagina.productividad.retos', 'agencias.ver', 'pagina.sistema']::TEXT[])),
    "permisos" = ARRAY(SELECT DISTINCT unnest("permisos" || ARRAY['productividad']::TEXT[])),
    "acciones" = COALESCE("acciones", '{}'::jsonb) || '{"verTodasSucursales": true, "verOtrosSucursales": true}'::jsonb,
    "fechaModificacion" = CURRENT_TIMESTAMP
WHERE "namerol" IN ('CONTABILIDAD', 'MARKETING');
