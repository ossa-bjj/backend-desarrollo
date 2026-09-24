/**
 * Servidor que trata la petición igual que Vercel antes de pasársela a la app.
 *
 * Es una copia del `addHelpers` de `@vercel/node` 14.0.0 (`dist/dev-server.mjs`),
 * limitada a lo que toca al cuerpo:
 *
 * 1. Lee el cuerpo entero del stream original. Al acabar, la petición queda
 *    con `complete = true` y `readable = false`.
 * 2. Lo "restaura" sustituyendo `req.on('data'|'end')` y `req.read` por un
 *    PassThrough con los mismos bytes, pero sin deshacer esas dos marcas.
 * 3. Deja `req.body` como propiedad perezosa que, en JSON, devuelve un objeto.
 *
 * Existe porque en local nadie lee el cuerpo antes que la app, y el webhook de
 * Stripe funcionaba en los tests mientras fallaba en producción con todas las
 * firmas. Sin reproducir esto, ningún test lo habría detectado.
 */

import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import type { Express } from 'express';

const leerCuerpo = async (req: IncomingMessage): Promise<Buffer> => {
  const trozos: Buffer[] = [];
  for await (const trozo of req) trozos.push(trozo as Buffer);
  return Buffer.concat(trozos);
};

const restaurarCuerpo = (req: IncomingMessage, cuerpo: Buffer): void => {
  const replica = new PassThrough();
  const on = replica.on.bind(replica);
  const onOriginal = req.on.bind(req);
  req.read = replica.read.bind(replica);
  req.on = req.addListener = ((nombre: string, cb: (...args: unknown[]) => void) =>
    nombre === 'data' || nombre === 'end' ? on(nombre, cb) : onOriginal(nombre, cb)) as typeof req.on;
  replica.write(cuerpo);
  replica.end();
};

const propiedadPerezosa = (req: IncomingMessage, prop: string, getter: () => unknown): void => {
  const opts = { configurable: true, enumerable: true };
  Object.defineProperty(req, prop, {
    ...opts,
    get: () => {
      const valor = getter();
      Object.defineProperty(req, prop, { ...opts, writable: true, value: valor });
      return valor;
    },
    set: (valor: unknown) => {
      Object.defineProperty(req, prop, { ...opts, writable: true, value: valor });
    },
  });
};

export const servidorComoVercel = (app: Express): http.Server =>
  http.createServer(async (req, res) => {
    const tipo = req.headers['content-type'];
    const cuerpo = tipo === undefined ? Buffer.from('') : await leerCuerpo(req);
    restaurarCuerpo(req, cuerpo);
    propiedadPerezosa(req, 'body', () =>
      tipo === 'application/json' ? (cuerpo.length ? JSON.parse(cuerpo.toString()) : {}) : undefined,
    );
    app(req, res);
  });
