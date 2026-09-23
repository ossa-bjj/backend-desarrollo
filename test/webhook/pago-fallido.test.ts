/**
 * `payment_intent.payment_failed`: la tarjeta la rechaza el banco, o el cliente
 * no completa la autenticación.
 *
 * Un pago fallido no es el final del pedido: el cliente puede volver a
 * intentarlo, así que el pedido tiene que quedarse pagable.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Types } from 'mongoose';
import { OrderStatus } from '../../src/orders/order.model';
import { cargarApp, entregarEvento, evento, paymentIntent } from '../ayudas/webhook';
import { crearPedido, crearProducto, lineaDeProducto, releerPedido, stockDeTalla } from '../ayudas/pedidos';

let app: Express;

const pagoFallido = (orderId: string | undefined, id = 'pi_fallido') =>
  evento('payment_intent.payment_failed', paymentIntent({ id, estado: 'requires_payment_method', orderId }));

beforeAll(async () => {
  app = await cargarApp();
});

describe('webhook de Stripe · pago fallido', () => {
  it('guarda el estado del intento y deja el pedido pendiente', async () => {
    const pedido = await crearPedido({
      pago: { proveedor: 'stripe', paymentIntentId: 'pi_fallido', estado: 'requires_confirmation' },
    });

    const respuesta = await entregarEvento(app, pagoFallido(String(pedido._id)));

    expect(respuesta.status).toBe(200);
    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.PENDIENTE);
    expect(guardado.pago?.estado).toBe('requires_payment_method');
    expect(guardado.pago?.pagadoEn).toBeUndefined();
  });

  it('no toca el stock', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 3 }] });
    const pedido = await crearPedido({ items: [lineaDeProducto({ quantity: 1, talla: 'M' })] });

    await entregarEvento(app, pagoFallido(String(pedido._id)));

    expect(await stockDeTalla(1011, 'M')).toBe(3);
  });

  it('deja el pedido en condiciones de volver a intentarlo', async () => {
    const pedido = await crearPedido();

    await entregarEvento(app, pagoFallido(String(pedido._id)));
    const guardado = await releerPedido(pedido._id);

    const { motivoParaNoCobrar } = await import('../../src/payments/pago.service');
    expect(motivoParaNoCobrar(guardado)).toBeNull();
  });

  it('no degrada un pedido que ya estaba pagado', async () => {
    const pedido = await crearPedido({
      estado: OrderStatus.PAGADO,
      pago: {
        proveedor: 'stripe',
        paymentIntentId: 'pi_fallido',
        estado: 'succeeded',
        pagadoEn: new Date(),
      },
    });

    await entregarEvento(app, pagoFallido(String(pedido._id)));

    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.PAGADO);
    expect(guardado.pago?.estado).toBe('succeeded');
  });

  it('acepta el aviso de un pedido que ya no existe sin romperse', async () => {
    const respuesta = await entregarEvento(app, pagoFallido(String(new Types.ObjectId())));

    expect(respuesta.status).toBe(200);
  });
});
