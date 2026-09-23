import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Una sola MongoDB en memoria para toda la suite; el entorno de cada
    // fichero se monta encima, con su propia base de datos.
    globalSetup: ['./test/setup/mongo.ts'],
    setupFiles: ['./test/setup/entorno.ts'],
    include: ['test/**/*.test.ts'],
    // Arrancar la base de datos en memoria la primera vez puede tardar.
    hookTimeout: 60000,
    testTimeout: 20000,
  },
});
