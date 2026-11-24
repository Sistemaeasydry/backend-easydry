import { describe, expect, it } from 'vitest';
import { exigirPasswordSegura, motivoPasswordDebil, PASSWORD_MENSAJE } from './password-politica.js';
import { tokenRevocado } from '../../modules/auth/jwt.strategy.js';

describe('política de contraseñas', () => {
  it.each(['12345678', 'lavadoseco', 'LAVADOSECO', 'Lavado#2026Seco', 'Ñandú$Verde', 'password', 'con espacios dentro'])('acepta %s (solo cuenta el largo)', (clave) => {
    expect(motivoPasswordDebil(clave)).toBeNull();
  });

  it.each(['', 'a', 'Ab1#xyz', '1234567'])('rechaza "%s" por corta', (clave) => {
    expect(motivoPasswordDebil(clave)).toBe(PASSWORD_MENSAJE);
  });

  it('el mínimo es de 8 caracteres: con 7 no pasa y con 8 sí', () => {
    expect(motivoPasswordDebil('abcdefgh')).toBeNull(); // 8
    expect(motivoPasswordDebil('abcdefg')).not.toBeNull(); // 7
  });

  it('exigirPasswordSegura lanza 400 con el motivo', () => {
    expect(() => exigirPasswordSegura('debil')).toThrow(PASSWORD_MENSAJE);
    expect(() => exigirPasswordSegura('cualquiera')).not.toThrow();
  });
});

describe('revocación de access tokens', () => {
  const t = (seg: number) => new Date(seg * 1000);
  it('sin revocación, el token vale', () => expect(tokenRevocado(1000, null)).toBe(false));
  it('un token emitido antes de la revocación no vale', () => expect(tokenRevocado(1000, t(1500))).toBe(true));
  it('un token emitido después de la revocación vale', () => expect(tokenRevocado(2000, t(1500))).toBe(false));
  it('un token sin fecha de emisión no vale si hubo revocación', () => expect(tokenRevocado(undefined, t(1500))).toBe(true));
});
