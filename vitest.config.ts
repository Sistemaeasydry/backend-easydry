import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Las pruebas de integración usan la base real y se ejecutan varios archivos en paralelo: con carga, preparar los
    // datos de una prueba o esperar un aviso en segundo plano puede tardar más de los 5 s que vitest da por defecto.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Con todos los núcleos, los avisos que se envían en segundo plano llegan tarde a las pruebas de notificaciones (pasan solas pero fallan
    // al azar en la corrida completa). Con 4 archivos a la vez la suite es estable.
    maxWorkers: 4,
    // Un reintento por prueba: las de notificaciones esperan avisos asíncronos y, bajo carga, alguna llega justo tarde. Si falla de verdad, falla las 3 veces.
    retry: 2,
  },
});
