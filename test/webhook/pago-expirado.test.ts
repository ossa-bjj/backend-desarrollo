/**
 * `payment_intent.canceled`: el intento de cobro ya no vale.
 *
 * Stripe lo manda cuando el intento caduca (Bizum no confirmado, autenticación
 * abandonada) o cuando se cancela desde el panel. El pedido no se cancela: lo
 * que caduca es el intento, y el cliente sigue pudiendo pagar. Lo que importa
 * es que el pedido deje de apuntar a un intento muerto, porque al volver a
 * pagar se reutiliza el que hubiera guardado.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Types } from 'mongoose';
import { OrderStatus } from '../../src/orders/order.model';
import { cargarApp, entregarEvento, evento, paymentIntent } from '../ayudas/webhook';
import { crearPedido, crearProducto, lineaDeProducto, releerPedido, stockDeTalla } from '../ayudas/pedidos';

let app: Express;

const pagoCancelado = (orderId: string | undefined, id = 'pi_caducado') =>
  evento('payment_intent.canceled', paymentIntent({ id, estado: 'canceled', orderId }));

beforeAll(async () => {
  app = await cargarApp();
});

describe('webhook de Stripe · intento caducado o cancelado', () => {
  it('anota que el intento quedó cancelado', async () => {
    const pedido = await crearPedido({
      pago: { proveedor: 'bizum', paymentIntentId: 'pi_caducado', estado: 'requires_action' },
    });

    const respuesta = await entregarEvento(app, pagoCancelado(String(pedido._id)));

    expect(respuesta.status).toBe(200);
    expect((await releerPedido(pedido._id)).pago?.estado).toBe('canceled');
  });

  it('deja el pedido pendiente y pagable', async () => {
    const pedido = await crearPedido({
      pago: { proveedor: 'bizum', paymentIntentId: 'pi_caducado', estado: 'requires_action' },
    });

    await entregarEvento(app, pagoCancelado(String(pedido._id)));
    const guardado = await releerPedido(pedido._id);

    expect(guardado.status).toBe(OrderStatus.PENDIENTE);
    const { motivoParaNoCobrar } = await import('../../src/payments/pago.service');
    expect(motivoParaNoCobrar(guardado)).toBeNull();
  });

  it('no toca el stock', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 3 }] });
    const pedido = await crearPedido({
      items: [lineaDeProducto({ quantity: 1, talla: 'M' })],
      pago: { proveedor: 'stripe', paymentIntentId: 'pi_caducado', estado: 'requires_action' },
    });

    await entregarEvento(app, pagoCancelado(String(pedido._id)));

    expect(await stockDeTalla(1011, 'M')).toBe(3);
  });

  it('no toca un pedido que ya está pagado', async () => {
    const pedido = await crearPedido({
      estado: OrderStatus.PAGADO,
      pago: {
        proveedor: 'stripe',
        paymentIntentId: 'pi_pagado',
        estado: 'succeeded',
        pagadoEn: new Date(),
      },
    });

    await entregarEvento(app, pagoCancelado(String(pedido._id), 'pi_caducado'));

    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.PAGADO);
    expect(guardado.pago?.estado).toBe('succeeded');
  });

  it('acepta el aviso de un pedido que ya no existe sin romperse', async () => {
    const respuesta = await entregarEvento(app, pagoCancelado(String(new Types.ObjectId())));

    expect(respuesta.status).toBe(200);
  });
});
