/**
 * `PATCH /api/pedidos/:id/status` a "cancelado" sobre un pedido ya cobrado:
 * el reembolso que sale de nuestro propio panel.
 *
 * Es la otra mitad de lo que cubre `test/webhook/reembolso.test.ts`, que mira el
 * camino contrario —la devolución hecha desde el panel de Stripe—.
 *
 * Lo que importa aquí es el orden: primero se devuelve el dinero y solo después
 * se cambia el estado. Si el reembolso falla, el pedido tiene que quedarse como
 * estaba; dejarlo cancelado con el importe retenido sería peor que no haber
 * empezado.
 *
 * El SDK de Stripe está simulado: aquí no se devuelve dinero de verdad.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { OrderStatus } from '../../src/orders/order.model';
import { crearPedido, crearProducto, lineaDeProducto, releerPedido, stockDeTalla } from '../ayudas/pedidos';
import { sesionDeAdmin } from '../ayudas/sesion';

import { reiniciarStripeSimulado, stripeSimulado } from '../ayudas/stripe-simulado';
import { sesionDe } from '../ayudas/sesion';

vi.mock('../../src/payments/stripe.utils', async () => {
  const { moduloStripeSimulado } = await import('../ayudas/stripe-simulado');
  return moduloStripeSimulado();
});

let app: Express;

const admin = sesionDeAdmin();

const cambiarEstado = (pedidoId: unknown, status: string) =>
  request(app)
    .patch(`/api/pedidos/${String(pedidoId)}/status`)
    .set('Authorization', admin.cabecera)
    .send({ status });

/** Pedido cobrado con tarjeta, con una unidad ya descontada del catálogo. */
const pedidoCobrado = (extra: Parameters<typeof crearPedido>[0] = {}) =>
  crearPedido({
    estado: OrderStatus.PAGADO,
    items: [lineaDeProducto({ quantity: 1, talla: 'M' })],
    pago: {
      proveedor: 'stripe',
      paymentIntentId: 'pi_cobrado',
      estado: 'succeeded',
      pagadoEn: new Date(),
    },
    ...extra,
  });

beforeAll(async () => {
  app = (await import('../../index')).default;
});

beforeEach(() => {
  reiniciarStripeSimulado();
});

describe('reembolso desde el panel', () => {
  it('devuelve el importe por Stripe al cancelar un pedido cobrado', async () => {
    const pedido = await pedidoCobrado();

    const respuesta = await cambiarEstado(pedido._id, OrderStatus.CANCELADO);

    expect(respuesta.status).toBe(200);
    expect(stripeSimulado.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_cobrado' });
    expect(respuesta.body.message).toContain('re_creado_en_el_test');
  });

  it('anota el reembolso y deja el pedido cancelado', async () => {
    const pedido = await pedidoCobrado();

    await cambiarEstado(pedido._id, OrderStatus.CANCELADO);

    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.CANCELADO);
    expect(guardado.pago?.reembolsoId).toBe('re_creado_en_el_test');
    expect(guardado.pago?.reembolsadoEn).toBeInstanceOf(Date);
  });

  it('devuelve las unidades al catálogo', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 2 }] });
    const pedido = await pedidoCobrado();

    await cambiarEstado(pedido._id, OrderStatus.CANCELADO);

    expect(await stockDeTalla(1011, 'M')).toBe(3);
  });

  it('no devuelve stock de una línea que nunca llegó a descontarse', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 0 }] });
    const pedido = await pedidoCobrado();
    pedido.incidenciasStock = [{ codigoArticulo: 1011, talla: 'M', solicitadas: 1, detectadaEn: new Date() }];
    await pedido.save();

    await cambiarEstado(pedido._id, OrderStatus.CANCELADO);

    expect(await stockDeTalla(1011, 'M')).toBe(0);
  });

  it('si Stripe no acepta la devolución, el pedido se queda como estaba', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 2 }] });
    stripeSimulado.refunds.create.mockRejectedValueOnce(new Error('charge already refunded'));
    const pedido = await pedidoCobrado();

    const respuesta = await cambiarEstado(pedido._id, OrderStatus.CANCELADO);

    expect(respuesta.status).toBe(409);
    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.PAGADO);
    expect(guardado.pago?.reembolsoId).toBeUndefined();
    // Ni el dinero ni el stock se han movido.
    expect(await stockDeTalla(1011, 'M')).toBe(2);
  });

  it('no reembolsa dos veces el mismo cobro', async () => {
    const pedido = await pedidoCobrado({
      pago: {
        proveedor: 'stripe',
        paymentIntentId: 'pi_cobrado',
        estado: 'succeeded',
        pagadoEn: new Date(),
        reembolsoId: 're_anterior',
        reembolsadoEn: new Date(),
      },
    });

    const respuesta = await cambiarEstado(pedido._id, OrderStatus.CANCELADO);

    expect(respuesta.status).toBe(409);
    expect(stripeSimulado.refunds.create).not.toHaveBeenCalled();
  });

  it('cancelar un pedido que nunca se cobró no llama a Stripe', async () => {
    const pedido = await crearPedido({ estado: OrderStatus.PENDIENTE });

    const respuesta = await cambiarEstado(pedido._id, OrderStatus.CANCELADO);

    expect(respuesta.status).toBe(200);
    expect(stripeSimulado.refunds.create).not.toHaveBeenCalled();
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.CANCELADO);
  });

  it('pasar un pedido cobrado a preparando no devuelve nada', async () => {
    const pedido = await pedidoCobrado();

    const respuesta = await cambiarEstado(pedido._id, OrderStatus.PREPARANDO);

    expect(respuesta.status).toBe(200);
    expect(stripeSimulado.refunds.create).not.toHaveBeenCalled();
  });

  it('solo un admin puede cancelar y reembolsar', async () => {
    const pedido = await pedidoCobrado();

    const respuesta = await request(app)
      .patch(`/api/pedidos/${pedido._id}/status`)
      .set('Authorization', sesionDe().cabecera)
      .send({ status: OrderStatus.CANCELADO });

    expect(respuesta.status).toBe(403);
    expect(stripeSimulado.refunds.create).not.toHaveBeenCalled();
  });
});
