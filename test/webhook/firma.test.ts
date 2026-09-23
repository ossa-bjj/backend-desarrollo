/**
 * Autenticación del webhook.
 *
 * Esta ruta es pública: lo único que separa un aviso de Stripe de alguien
 * dando por cobrado un pedido que nadie ha pagado es la firma. Por eso se
 * prueba antes que ningún flujo de negocio.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { OrderStatus } from '../../src/orders/order.model';
import { cargarApp, entregarEvento, evento, paymentIntent, RUTA_WEBHOOK } from '../ayudas/webhook';
import { crearPedido, releerPedido } from '../ayudas/pedidos';

let app: Express;

beforeAll(async () => {
  app = await cargarApp();
});

describe('webhook de Stripe · firma', () => {
  it('rechaza la petición sin cabecera stripe-signature', async () => {
    const respuesta = await request(app)
      .post(RUTA_WEBHOOK)
      .set('content-type', 'application/json')
      .send(JSON.stringify(evento('payment_intent.succeeded', paymentIntent({ estado: 'succeeded' }))));

    expect(respuesta.status).toBe(400);
  });

  it('rechaza una firma inventada', async () => {
    const respuesta = await request(app)
      .post(RUTA_WEBHOOK)
      .set('stripe-signature', 't=1,v1=firmafalsa')
      .set('content-type', 'application/json')
      .send(JSON.stringify(evento('payment_intent.succeeded', paymentIntent({ estado: 'succeeded' }))));

    expect(respuesta.status).toBe(400);
  });

  it('rechaza una firma hecha con otro secreto y no toca el pedido', async () => {
    const pedido = await crearPedido();

    const respuesta = await entregarEvento(
      app,
      evento('payment_intent.succeeded', paymentIntent({ estado: 'succeeded', orderId: String(pedido._id) })),
      { secreto: 'whsec_otro_secreto_distinto' },
    );

    expect(respuesta.status).toBe(400);
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.PENDIENTE);
  });

  it('rechaza un evento firmado hace mucho, para que no se pueda reenviar más tarde', async () => {
    const pedido = await crearPedido();
    const haceUnaHora = Math.floor(Date.now() / 1000) - 3600;

    const respuesta = await entregarEvento(
      app,
      evento('payment_intent.succeeded', paymentIntent({ estado: 'succeeded', orderId: String(pedido._id) })),
      { timestamp: haceUnaHora },
    );

    expect(respuesta.status).toBe(400);
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.PENDIENTE);
  });

  it('rechaza un cuerpo manipulado después de firmarlo', async () => {
    const pedido = await crearPedido();
    const original = JSON.stringify(
      evento('payment_intent.succeeded', paymentIntent({ estado: 'succeeded', orderId: 'otro-pedido' })),
    );
    const manipulado = original.replace('otro-pedido', String(pedido._id));

    const { firmar } = await import('../ayudas/webhook');
    const respuesta = await request(app)
      .post(RUTA_WEBHOOK)
      .set('stripe-signature', firmar(original))
      .set('content-type', 'application/json')
      .send(manipulado);

    expect(respuesta.status).toBe(400);
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.PENDIENTE);
  });

  it('acepta un evento bien firmado', async () => {
    const respuesta = await entregarEvento(
      app,
      evento('payment_intent.succeeded', paymentIntent({ estado: 'succeeded' })),
    );

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ received: true });
  });

  it('responde 200 a un evento que no escuchamos, para que Stripe no lo reintente', async () => {
    const respuesta = await entregarEvento(
      app,
      evento('customer.created', { id: 'cus_de_pruebas', object: 'customer' }),
    );

    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toEqual({ received: true });
  });
});
