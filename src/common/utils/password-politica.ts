import { BadRequestException } from '@nestjs/common';

/**
 * Política de contraseñas del sistema. Es la ÚNICA definición: la usan el backend (crear usuarios y asignar contraseñas), el script de
 * importación del Excel y el seed. Debe coincidir con `frontend-easy-dry/src/app/core/utils/password-politica.ts`, que la repite para
 * avisar al usuario antes de enviar el formulario.
 *
 * Única regla: un largo mínimo. No se exigen mayúsculas, números ni símbolos. (Que la contraseña y su confirmación coincidan lo
 * comprueban los formularios; el servidor solo recibe la contraseña final.)
 */
export const PASSWORD_LARGO_MINIMO = 8;
export const PASSWORD_MENSAJE = `La contraseña debe tener al menos ${PASSWORD_LARGO_MINIMO} caracteres.`;

/** Devuelve el motivo por el que la contraseña no sirve, o `null` si cumple la política. El segundo parámetro se conserva por compatibilidad y no se usa. */
export function motivoPasswordDebil(password: string, _email?: string): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_LARGO_MINIMO) return PASSWORD_MENSAJE;
  return null;
}

/** Si se envió la repetición de la contraseña, debe ser idéntica. Sin repetición (scripts, importaciones) no se compara. */
export function exigirConfirmacion(password: string, confirmacion?: string | null): void {
  if (confirmacion === undefined || confirmacion === null) return;
  if (confirmacion.trim() !== password.trim()) throw new BadRequestException('La contraseña y su repetición no coinciden.');
}

export function exigirPasswordSegura(password: string, email?: string): void {
  const motivo = motivoPasswordDebil(password, email);
  if (motivo) throw new BadRequestException(motivo);
}
