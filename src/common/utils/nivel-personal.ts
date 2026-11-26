import { BadRequestException } from '@nestjs/common';

export const NIVELES_PERSONAL = ['JUNIOR', 'SENIOR'] as const;

/**
 * Nivel (junior o senior) que debe quedar guardado: los roles operativos (categoría OPERADOR) lo llevan obligatorio cuando se crea o se
 * edita a la persona; los administrativos nunca lo tienen. `undefined` = no tocar lo guardado.
 */
export function nivelAGuardar(categoriaRol: string | null | undefined, nuevo: string | null | undefined, actual: string | null, exigir: boolean): string | null | undefined {
  if (categoriaRol !== 'OPERADOR') return actual ? null : undefined;
  const pedido = nuevo === undefined ? undefined : nuevo || null;
  const final = pedido === undefined ? actual : pedido;
  if (exigir && !final) throw new BadRequestException('Indica si la persona es Junior o Senior.');
  return pedido;
}
