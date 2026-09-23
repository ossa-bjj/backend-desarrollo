/**
 * Entorno de los tests: una MongoDB de verdad, en memoria, y las variables que
 * `validateEnvironment()` exige al importar la app.
 *
 * Las variables se fijan aquí, antes de que ningún test importe `index.ts`.
 * `dotenv` no pisa lo que ya existe en `process.env`, así que el `.env` real del
 * proyecto no se cuela en las pruebas.
 */

import { afterAll, afterEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

/** Secreto con el que se firman los eventos falsos de Stripe en los tests. */
export const SECRETO_WEBHOOK = 'whsec_secreto_de_pruebas';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-pruebas';
process.env.R2_ACCOUNT_ID = 'cuenta-de-pruebas';
process.env.R2_ACCESS_KEY_ID = 'clave-de-pruebas';
process.env.R2_SECRET_ACCESS_KEY = 'secreta-de-pruebas';
process.env.R2_BUCKET_NAME = 'bucket-de-pruebas';
process.env.R2_PUBLIC_DOMAIN = 'https://media.example.test';
process.env.ALLOWED_ORIGINS = 'https://tienda.example.test';
// Clave de juguete: nunca se llama a la API de Stripe, solo se usa el SDK para
// firmar y verificar eventos, que es puro HMAC en local.
process.env.STRIPE_SECRET_KEY = 'sk_test_de_pruebas';
process.env.STRIPE_WEBHOOK_SECRET = SECRETO_WEBHOOK;

let servidorMongo: MongoMemoryServer;

beforeAll(async () => {
  servidorMongo = await MongoMemoryServer.create();
  process.env.DB_URL = servidorMongo.getUri('arturosalas_test');

  // La app conecta de forma perezosa, en la primera petición. Los tests crean
  // pedidos antes de esa petición, así que la conexión se abre aquí; `connectDB`
  // la encuentra ya lista y no abre otra.
  await mongoose.connect(process.env.DB_URL);
});

// Cada test arranca con la base vacía: así ninguno depende de lo que dejó otro.
afterEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  const colecciones = await mongoose.connection.db!.collections();
  await Promise.all(colecciones.map((coleccion) => coleccion.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await servidorMongo?.stop();
});
