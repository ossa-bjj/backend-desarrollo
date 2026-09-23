/**
 * Arranca una sola MongoDB en memoria para toda la suite y pasa su dirección a
 * los ficheros de test.
 *
 * Vive aparte de `entorno.ts` porque esto corre una vez, antes que nada,
 * mientras que `entorno.ts` corre en cada fichero. Así los ficheros pueden ir
 * aislados entre sí —que es lo que permite simular el SDK de Stripe en uno sin
 * contaminar a los demás— sin pagar un arranque de la base de datos por fichero.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  interface ProvidedContext {
    direccionMongo: string;
  }
}

export default async function ({ provide }: TestProject) {
  const servidor = await MongoMemoryServer.create();
  provide('direccionMongo', servidor.getUri());

  return async () => {
    await servidor.stop();
  };
}
