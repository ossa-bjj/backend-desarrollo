import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup/entorno.ts'],
    include: ['test/**/*.test.ts'],
    // Todos los ficheros en el mismo proceso: así se arranca una única MongoDB
    // en memoria, y no una por fichero.
    pool: 'forks',
    fileParallelism: false,
    isolate: false,
    // Arrancar la base de datos en memoria la primera vez puede tardar.
    hookTimeout: 60000,
    testTimeout: 20000,
  },
});
