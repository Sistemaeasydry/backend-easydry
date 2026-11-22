/**
 * Nombre de una persona para mostrar, tablas, listas, avisos y mensajes: primero los apellidos y luego los nombres («Pérez Loor Juan»).
 * Quita el sufijo «(CI: …)» que algunos apellidos antiguos traen pegado, para que no quede en medio del nombre.
 */
export const apellidosNombres = (u: { name?: string | null; lastname?: string | null } | null | undefined): string => {
  const limpio = (t?: string | null) => String(t ?? '').replace(/\(?CI:[^)]*\)?/g, '').trim();
  return [limpio(u?.lastname), limpio(u?.name)].filter(Boolean).join(' ');
};
