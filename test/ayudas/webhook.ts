/**
 * Ayudas para hablar con el webhook de Stripe como lo haría Stripe.
 *
 * La firma se genera con el propio SDK (`generateTestHeaderString`), que es el
 * mismo HMAC que Stripe calcula en sus servidores. Así el test ejercita la
 * verificación de verdad y no una versión de juguete.
 */

import type { Express } from 'express';
import request from 'supertest';
import Stripe from 'stripe';
import { SECRETO_WEBHOOK } from '../setup/entorno';

export const RUTA_WEBHOOK = '/api/pedidos/webhook';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/** Importa la app ya con el entorno de pruebas puesto. */
export const cargarApp = async (): Promise<Express> => (await import('../../index')).default;

/** Envuelve un objeto en la forma que tiene un evento de Stripe. */
export const evento = (tipo: string, objeto: Record<string, unknown>): Record<string, unknown> => ({
  id: `evt_${Math.random().toString(36).slice(2, 12)}`,
  object: 'event',
  api_version: '2025-01-01',
  created: Math.floor(Date.now() / 1000),
  type: tipo,
  data: { object: objeto },
});

export const firmar = (cuerpo: string, opciones: { secreto?: string; timestamp?: number } = {}): string =>
  stripe.webhooks.generateTestHeaderString({
    payload: cuerpo,
    secret: opciones.secreto ?? SECRETO_WEBHOOK,
    timestamp: opciones.timestamp,
  });

/** Entrega un evento firmado, tal y como llega de Stripe. */
export const entregarEvento = async (
  app: Express,
  cuerpoEvento: Record<string, unknown>,
  opciones: { secreto?: string; timestamp?: number } = {},
) => {
  const cuerpo = JSON.stringify(cuerpoEvento);

  return request(app)
    .post(RUTA_WEBHOOK)
    .set('stripe-signature', firmar(cuerpo, opciones))
    .set('content-type', 'application/json')
    .send(cuerpo);
};

/** PaymentIntent mínimo con lo que el webhook llega a mirar. */
export const paymentIntent = (opciones: {
  id?: string;
  estado: string;
  orderId?: string;
  importe?: number;
}): Record<string, unknown> => ({
  id: opciones.id ?? 'pi_de_pruebas',
  object: 'payment_intent',
  amount: opciones.importe ?? 5000,
  currency: 'eur',
  status: opciones.estado,
  metadata: opciones.orderId ? { orderId: opciones.orderId } : {},
});

/** Charge mínimo, que es lo que viaja en los eventos de reembolso. */
export const cargo = (opciones: {
  id?: string;
  paymentIntentId: string;
  importe?: number;
  reembolsado?: number;
  reembolsoId?: string;
}): Record<string, unknown> => {
  const importe = opciones.importe ?? 5000;
  const reembolsado = opciones.reembolsado ?? importe;

  return {
    id: opciones.id ?? 'ch_de_pruebas',
    object: 'charge',
    amount: importe,
    amount_refunded: reembolsado,
    currency: 'eur',
    payment_intent: opciones.paymentIntentId,
    refunded: reembolsado >= importe,
    refunds: {
      object: 'list',
      data: [{ id: opciones.reembolsoId ?? 're_de_pruebas', amount: reembolsado, status: 'succeeded' }],
    },
  };
};
