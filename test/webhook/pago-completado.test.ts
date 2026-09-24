/**
 * `payment_intent.succeeded`: el dinero ha entrado.
 *
 * Es el único punto por el que un pedido pasa a PAGADO desde Stripe, y arrastra
 * dos consecuencias que no se pueden quedar a medias: la reserva del horario
 * deja de caducar y el stock baja.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Types } from 'mongoose';
import { OrderStatus } from '../../src/orders/order.model';
import { cargarApp, cargo, entregarEvento, evento, paymentIntent } from '../ayudas/webhook';
import {
  crearPedido,
  crearProducto,
  lineaDeProducto,
  lineaDeServicio,
  releerPedido,
  stockDeTalla,
} from '../ayudas/pedidos';

let app: Express;

const pagoCompletado = (orderId: string | undefined, id = 'pi_completado') =>
  evento('payment_intent.succeeded', paymentIntent({ id, estado: 'succeeded', orderId }));

beforeAll(async () => {
  app = await cargarApp();
});

describe('webhook de Stripe · pago completado', () => {
  it('marca el pedido como pagado y guarda la referencia del cobro', async () => {
    const pedido = await crearPedido();

    const respuesta = await entregarEvento(app, pagoCompletado(String(pedido._id)));

    expect(respuesta.status).toBe(200);
    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.PAGADO);
    expect(guardado.pago?.paymentIntentId).toBe('pi_completado');
    expect(guardado.pago?.estado).toBe('succeeded');
    expect(guardado.pago?.pagadoEn).toBeInstanceOf(Date);
  });

  it('descuenta el stock de la talla comprada', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 3 }] });
    const pedido = await crearPedido({ items: [lineaDeProducto({ quantity: 2, talla: 'M' })] });

    await entregarEvento(app, pagoCompletado(String(pedido._id)));

    expect(await stockDeTalla(1011, 'M')).toBe(1);
  });

  it('no descuenta stock de las líneas de servicio', async () => {
    const pedido = await crearPedido({ items: [lineaDeServicio()] });

    const respuesta = await entregarEvento(app, pagoCompletado(String(pedido._id)));

    expect(respuesta.status).toBe(200);
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.PAGADO);
  });

  it('cobra igualmente y deja anotada la incidencia cuando ya no queda stock', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 1 }] });
    const pedido = await crearPedido({ items: [lineaDeProducto({ quantity: 5, talla: 'M' })] });

    await entregarEvento(app, pagoCompletado(String(pedido._id)));

    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.PAGADO);
    expect(guardado.incidenciasStock).toHaveLength(1);
    expect(guardado.incidenciasStock?.[0]).toMatchObject({
      codigoArticulo: 1011,
      talla: 'M',
      solicitadas: 5,
    });
    // El stock no baja: la condición del descuento no casó.
    expect(await stockDeTalla(1011, 'M')).toBe(1);
  });

  it('no descuenta stock dos veces aunque Stripe reintente el mismo aviso', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 3 }] });
    const pedido = await crearPedido({ items: [lineaDeProducto({ quantity: 1, talla: 'M' })] });

    await entregarEvento(app, pagoCompletado(String(pedido._id)));
    const segunda = await entregarEvento(app, pagoCompletado(String(pedido._id)));

    expect(segunda.status).toBe(200);
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.PAGADO);
    expect(await stockDeTalla(1011, 'M')).toBe(2);
  });

  // Encontrado con eventos reales de Stripe: el estado del pedido sigue avanzando
  // después de cobrar, y un aviso que llega tarde no puede hacerlo retroceder.
  it.each([OrderStatus.PREPARANDO, OrderStatus.ENVIADO, OrderStatus.ENTREGADO])(
    'un aviso que llega tarde no devuelve a pagado un pedido ya %s',
    async (estado) => {
      await crearProducto({ tallas: [{ talla: 'M', stock: 3 }] });
      const pedido = await crearPedido({ items: [lineaDeProducto({ quantity: 1, talla: 'M' })] });

      await entregarEvento(app, pagoCompletado(String(pedido._id)));
      const cobrado = await releerPedido(pedido._id);
      cobrado.status = estado;
      await cobrado.save();

      await entregarEvento(app, pagoCompletado(String(pedido._id)));

      expect((await releerPedido(pedido._id)).status).toBe(estado);
      expect(await stockDeTalla(1011, 'M')).toBe(2);
    },
  );

  it('un aviso que llega después de reembolsar no vuelve a cobrar el pedido', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 3 }] });
    const pedido = await crearPedido({ items: [lineaDeProducto({ quantity: 1, talla: 'M' })] });

    await entregarEvento(app, pagoCompletado(String(pedido._id)));
    await entregarEvento(
      app,
      evento(
        'charge.refunded',
        cargo({ paymentIntentId: 'pi_completado', importe: 5000, reembolsado: 5000 }),
      ),
    );
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.CANCELADO);
    expect(await stockDeTalla(1011, 'M')).toBe(3);

    // Stripe reintenta durante días: el `succeeded` puede llegar otra vez.
    await entregarEvento(app, pagoCompletado(String(pedido._id)));

    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.CANCELADO);
    expect(await stockDeTalla(1011, 'M')).toBe(3);
  });

  it('conserva el método que eligió el cliente: un cobro de Bizum no pasa a decir tarjeta', async () => {
    const pedido = await crearPedido({
      pago: { proveedor: 'bizum', paymentIntentId: 'pi_bizum', estado: 'requires_action' },
    });

    await entregarEvento(app, pagoCompletado(String(pedido._id), 'pi_bizum'));

    expect((await releerPedido(pedido._id)).pago?.proveedor).toBe('bizum');
  });

  it('acepta el aviso de un pedido que ya no existe sin romperse', async () => {
    const respuesta = await entregarEvento(app, pagoCompletado(String(new Types.ObjectId())));

    expect(respuesta.status).toBe(200);
  });

  it('reconoce el pedido por el id del intento cuando el evento llega sin metadata', async () => {
    const pedido = await crearPedido({
      pago: { proveedor: 'stripe', paymentIntentId: 'pi_sin_metadata', estado: 'requires_payment_method' },
    });

    const respuesta = await entregarEvento(app, pagoCompletado(undefined, 'pi_sin_metadata'));

    expect(respuesta.status).toBe(200);
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.PAGADO);
  });
});
