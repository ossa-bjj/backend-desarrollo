/**
 * `POST /api/pedidos/:id/pago/iniciar`: la puerta por la que se arranca un cobro.
 *
 * Dos cosas que comprobar aquí. Una, quién puede llamar y sobre qué pedidos: un
 * pedido ajeno, uno ya pagado o uno sin tarificar no se cobran. Y dos, con qué
 * se llama a Stripe: el importe en céntimos y, sobre todo, el `orderId` en la
 * metadata, que es lo único que después permite al webhook saber qué pedido
 * marcar como pagado.
 *
 * El SDK de Stripe está simulado: aquí no se crean cobros de verdad.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { OrderStatus } from '../../src/orders/order.model';
import { crearPedido, lineaDeProducto, releerPedido } from '../ayudas/pedidos';
import { sesionDe, sesionDeAdmin } from '../ayudas/sesion';

import { reiniciarStripeSimulado, stripeSimulado } from '../ayudas/stripe-simulado';

// El factory importa la ayuda por su cuenta: `vi.mock` se eleva por encima de
// los imports y no puede leer lo de arriba. Es el mismo módulo, así que el
// simulado que se inspecciona en los tests es el que recibe la app.
vi.mock('../../src/payments/stripe.utils', async () => {
  const { moduloStripeSimulado } = await import('../ayudas/stripe-simulado');
  return moduloStripeSimulado();
});

let app: Express;

const cliente = sesionDe();

const iniciar = (pedidoId: unknown, cuerpo: Record<string, unknown>, cabecera = cliente.cabecera) =>
  request(app)
    .post(`/api/pedidos/${String(pedidoId)}/pago/iniciar`)
    .set('Authorization', cabecera)
    .send(cuerpo);

const pedidoDelCliente = (extra: Parameters<typeof crearPedido>[0] = {}) =>
  crearPedido({ user: cliente.id, ...extra });

beforeAll(async () => {
  app = (await import('../../index')).default;
});

beforeEach(() => {
  reiniciarStripeSimulado();
});

describe('iniciar pago · quién puede', () => {
  it('sin token no se arranca ningún cobro', async () => {
    const pedido = await pedidoDelCliente();

    const respuesta = await request(app).post(`/api/pedidos/${pedido._id}/pago/iniciar`).send({});

    expect(respuesta.status).toBe(401);
    expect(stripeSimulado.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('nadie paga el pedido de otro', async () => {
    const pedido = await crearPedido({ user: new Types.ObjectId() });

    const respuesta = await iniciar(pedido._id, {});

    expect(respuesta.status).toBe(403);
    expect(stripeSimulado.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('un admin sí puede arrancarlo por el cliente', async () => {
    const pedido = await crearPedido({ user: new Types.ObjectId() });

    const respuesta = await iniciar(pedido._id, {}, sesionDeAdmin().cabecera);

    expect(respuesta.status).toBe(200);
  });

  it('un identificador que no es un ObjectId se rechaza', async () => {
    const respuesta = await iniciar('no-es-un-id', {});

    expect(respuesta.status).toBe(400);
  });

  it('un pedido inexistente responde 404', async () => {
    const respuesta = await iniciar(new Types.ObjectId(), {});

    expect(respuesta.status).toBe(404);
  });
});

describe('iniciar pago · qué pedidos se pueden cobrar', () => {
  it('no se cobra dos veces un pedido ya pagado', async () => {
    const pedido = await pedidoDelCliente({ estado: OrderStatus.PAGADO });

    const respuesta = await iniciar(pedido._id, {});

    expect(respuesta.status).toBe(409);
    expect(stripeSimulado.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('no se cobra un presupuesto que el admin todavía no ha tarificado', async () => {
    const pedido = await pedidoDelCliente({ estado: OrderStatus.PENDIENTE_CONFIRMACION });

    const respuesta = await iniciar(pedido._id, {});

    expect(respuesta.status).toBe(409);
    expect(respuesta.body.error).toContain('pendiente de confirmación');
  });

  it.each([OrderStatus.CANCELADO, OrderStatus.RECHAZADO])('no se cobra un pedido %s', async (estado) => {
    const pedido = await pedidoDelCliente({ estado });

    const respuesta = await iniciar(pedido._id, {});

    expect(respuesta.status).toBe(409);
    expect(stripeSimulado.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('no se cobra un importe de cero', async () => {
    const pedido = await pedidoDelCliente({ items: [lineaDeProducto({ price: 0 })], total: 0 });

    const respuesta = await iniciar(pedido._id, {});

    expect(respuesta.status).toBe(400);
    expect(stripeSimulado.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('rechaza un método de pago inventado', async () => {
    const pedido = await pedidoDelCliente();

    const respuesta = await iniciar(pedido._id, { metodo: 'criptomonedas' });

    expect(respuesta.status).toBe(400);
    expect(stripeSimulado.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('iniciar pago · lo que se le pide a Stripe', () => {
  it('manda el importe en céntimos y ata el cobro al pedido con la metadata', async () => {
    const pedido = await pedidoDelCliente({ items: [lineaDeProducto({ price: 34.99 })] });

    const respuesta = await iniciar(pedido._id, { metodo: 'stripe' });

    expect(respuesta.status).toBe(200);
    expect(stripeSimulado.paymentIntents.create).toHaveBeenCalledTimes(1);
    const enviado = stripeSimulado.paymentIntents.create.mock.calls[0][0];
    expect(enviado.amount).toBe(3499);
    expect(enviado.currency).toBe('eur');
    // Sin esto el webhook no sabría qué pedido marcar.
    expect(enviado.metadata?.orderId).toBe(String(pedido._id));
    expect(enviado.metadata?.usuario).toBe(String(cliente.id));
  });

  it('el botón de tarjeta ofrece tarjeta y nada más', async () => {
    const pedido = await pedidoDelCliente();

    await iniciar(pedido._id, { metodo: 'stripe' });

    expect(stripeSimulado.paymentIntents.create.mock.calls[0][0].payment_method_types).toEqual(['card']);
  });

  it('el botón de Bizum crea un intento de Bizum', async () => {
    const pedido = await pedidoDelCliente();

    await iniciar(pedido._id, { metodo: 'bizum' });

    expect(stripeSimulado.paymentIntents.create.mock.calls[0][0].payment_method_types).toEqual(['bizum']);
  });

  it('sin método, cobra con tarjeta', async () => {
    const pedido = await pedidoDelCliente();

    await iniciar(pedido._id, {});

    expect(stripeSimulado.paymentIntents.create.mock.calls[0][0].payment_method_types).toEqual(['card']);
  });

  it('devuelve el clientSecret y guarda el intento en el pedido', async () => {
    const pedido = await pedidoDelCliente();

    const respuesta = await iniciar(pedido._id, { metodo: 'bizum' });

    expect(respuesta.body.data).toMatchObject({
      proveedor: 'bizum',
      clientSecret: 'pi_creado_en_el_test_secret',
      orderId: String(pedido._id),
    });
    const guardado = await releerPedido(pedido._id);
    expect(guardado.pago?.paymentIntentId).toBe('pi_creado_en_el_test');
    expect(guardado.pago?.proveedor).toBe('bizum');
  });
});

describe('iniciar pago · reutilización del intento', () => {
  const conIntentoVivo = (proveedor: string) =>
    pedidoDelCliente({
      pago: { proveedor, paymentIntentId: 'pi_vivo', estado: 'requires_payment_method' },
    });

  it('recargar la pantalla de pago reutiliza el intento en vez de crear otro', async () => {
    const pedido = await conIntentoVivo('stripe');

    const respuesta = await iniciar(pedido._id, { metodo: 'stripe' });

    expect(respuesta.body.data.clientSecret).toBe('pi_vivo_secret');
    expect(stripeSimulado.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('un intento de Bizum no se reutiliza para pagar con tarjeta', async () => {
    const pedido = await conIntentoVivo('bizum');

    await iniciar(pedido._id, { metodo: 'stripe' });

    expect(stripeSimulado.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(stripeSimulado.paymentIntents.create).toHaveBeenCalledTimes(1);
  });

  it('si el admin ha retarificado el pedido, se corrige el importe del intento', async () => {
    const pedido = await pedidoDelCliente({
      items: [lineaDeProducto({ price: 80 })],
      pago: { proveedor: 'stripe', paymentIntentId: 'pi_vivo', estado: 'requires_payment_method' },
    });

    await iniciar(pedido._id, { metodo: 'stripe' });

    expect(stripeSimulado.paymentIntents.update).toHaveBeenCalledWith('pi_vivo', { amount: 8000 });
    expect(stripeSimulado.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('no toca el importe si no ha cambiado', async () => {
    const pedido = await conIntentoVivo('stripe');

    await iniciar(pedido._id, { metodo: 'stripe' });

    expect(stripeSimulado.paymentIntents.update).not.toHaveBeenCalled();
  });

  it('crea uno nuevo si el intento guardado ya no existe en Stripe', async () => {
    stripeSimulado.paymentIntents.retrieve.mockRejectedValueOnce(new Error('No such payment_intent'));
    const pedido = await conIntentoVivo('stripe');

    const respuesta = await iniciar(pedido._id, { metodo: 'stripe' });

    expect(respuesta.status).toBe(200);
    expect(stripeSimulado.paymentIntents.create).toHaveBeenCalledTimes(1);
  });

  it('crea uno nuevo si el intento guardado ya no admite pago', async () => {
    stripeSimulado.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_vivo',
      client_secret: 'pi_vivo_secret',
      status: 'canceled',
      amount: 5000,
    });
    const pedido = await conIntentoVivo('stripe');

    await iniciar(pedido._id, { metodo: 'stripe' });

    expect(stripeSimulado.paymentIntents.create).toHaveBeenCalledTimes(1);
  });
});
