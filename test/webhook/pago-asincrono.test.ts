/**
 * Pagos asíncronos: Bizum.
 *
 * El cliente confirma en su banco y el dinero no está confirmado al momento.
 * Stripe manda primero `payment_intent.processing` y, minutos después, el
 * desenlace. Durante la espera el pedido NO está pagado: ni se reserva el
 * horario en firme ni baja el stock.
 *
 * Esto importa porque el cobro puede llegar por el webhook mucho después de que
 * el cliente cierre la web, y porque los avisos pueden llegar desordenados.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { OrderStatus } from '../../src/orders/order.model';
import { cargarApp, entregarEvento, evento, paymentIntent } from '../ayudas/webhook';
import { crearPedido, crearProducto, lineaDeProducto, releerPedido, stockDeTalla } from '../ayudas/pedidos';

let app: Express;

const ID_INTENTO = 'pi_bizum_asincrono';

const enCurso = (orderId: string) =>
  evento('payment_intent.processing', paymentIntent({ id: ID_INTENTO, estado: 'processing', orderId }));

const completado = (orderId: string) =>
  evento('payment_intent.succeeded', paymentIntent({ id: ID_INTENTO, estado: 'succeeded', orderId }));

const fallido = (orderId: string) =>
  evento(
    'payment_intent.payment_failed',
    paymentIntent({ id: ID_INTENTO, estado: 'requires_payment_method', orderId }),
  );

const pedidoDeBizum = () =>
  crearPedido({
    items: [lineaDeProducto({ quantity: 1, talla: 'M' })],
    pago: { proveedor: 'bizum', paymentIntentId: ID_INTENTO, estado: 'requires_action' },
  });

beforeAll(async () => {
  app = await cargarApp();
});

describe('webhook de Stripe · pago asíncrono (Bizum)', () => {
  it('mientras el pago está en curso, el pedido no se da por pagado', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 3 }] });
    const pedido = await pedidoDeBizum();

    const respuesta = await entregarEvento(app, enCurso(String(pedido._id)));

    expect(respuesta.status).toBe(200);
    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.PENDIENTE);
    expect(guardado.pago?.estado).toBe('processing');
    expect(guardado.pago?.pagadoEn).toBeUndefined();
    expect(await stockDeTalla(1011, 'M')).toBe(3);
  });

  it('cuando el banco confirma, el pedido pasa a pagado y baja el stock', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 3 }] });
    const pedido = await pedidoDeBizum();

    await entregarEvento(app, enCurso(String(pedido._id)));
    await entregarEvento(app, completado(String(pedido._id)));

    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.PAGADO);
    expect(guardado.pago?.proveedor).toBe('bizum');
    expect(await stockDeTalla(1011, 'M')).toBe(2);
  });

  it('cuando el banco rechaza, el pedido sigue pendiente y sin tocar el stock', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 3 }] });
    const pedido = await pedidoDeBizum();

    await entregarEvento(app, enCurso(String(pedido._id)));
    await entregarEvento(app, fallido(String(pedido._id)));

    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.PENDIENTE);
    expect(guardado.pago?.estado).toBe('requires_payment_method');
    expect(await stockDeTalla(1011, 'M')).toBe(3);
  });

  it('un aviso de "en curso" que llega tarde no desmarca un pedido ya pagado', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 3 }] });
    const pedido = await pedidoDeBizum();

    await entregarEvento(app, completado(String(pedido._id)));
    // Stripe no garantiza el orden de entrega: el aviso anterior puede llegar
    // después, y reintentarse durante horas.
    await entregarEvento(app, enCurso(String(pedido._id)));

    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.PAGADO);
    expect(guardado.pago?.estado).toBe('succeeded');
    expect(await stockDeTalla(1011, 'M')).toBe(2);
  });

  it('un rechazo que llega después del cobro no deshace el pago', async () => {
    const pedido = await pedidoDeBizum();

    await entregarEvento(app, completado(String(pedido._id)));
    await entregarEvento(app, fallido(String(pedido._id)));

    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.PAGADO);
    expect(guardado.pago?.estado).toBe('succeeded');
  });
});
