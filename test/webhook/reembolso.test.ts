/**
 * `charge.refunded`: se ha devuelto dinero.
 *
 * El caso que importa es la devolución hecha desde el panel de Stripe, sin
 * pasar por nuestro panel: ahí nadie ejecuta `reembolsarPedido`, así que sin
 * webhook el pedido seguiría figurando como cobrado y las unidades no volverían
 * al catálogo.
 *
 * Cuando la devolución sí sale de nuestro panel, el pedido ya lleva anotado el
 * reembolso y este aviso no debe volver a tocar el stock.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { OrderStatus } from '../../src/orders/order.model';
import { cargarApp, cargo, entregarEvento, evento } from '../ayudas/webhook';
import { crearPedido, crearProducto, lineaDeProducto, releerPedido, stockDeTalla } from '../ayudas/pedidos';

let app: Express;

const ID_INTENTO = 'pi_reembolsado';

const reembolsado = (opciones: { importe?: number; devuelto?: number; reembolsoId?: string } = {}) =>
  evento(
    'charge.refunded',
    cargo({
      paymentIntentId: ID_INTENTO,
      importe: opciones.importe ?? 5000,
      reembolsado: opciones.devuelto ?? opciones.importe ?? 5000,
      reembolsoId: opciones.reembolsoId ?? 're_de_pruebas',
    }),
  );

/** Pedido ya cobrado, que es el único al que se le puede devolver dinero. */
const pedidoCobrado = () =>
  crearPedido({
    estado: OrderStatus.PAGADO,
    total: 50,
    items: [lineaDeProducto({ quantity: 1, talla: 'M' })],
    pago: {
      proveedor: 'stripe',
      paymentIntentId: ID_INTENTO,
      estado: 'succeeded',
      pagadoEn: new Date(),
    },
  });

beforeAll(async () => {
  app = await cargarApp();
});

describe('webhook de Stripe · reembolso', () => {
  it('anota el reembolso en el pedido', async () => {
    const pedido = await pedidoCobrado();

    const respuesta = await entregarEvento(app, reembolsado());

    expect(respuesta.status).toBe(200);
    const guardado = await releerPedido(pedido._id);
    expect(guardado.pago?.reembolsoId).toBe('re_de_pruebas');
    expect(guardado.pago?.reembolsadoEn).toBeInstanceOf(Date);
  });

  it('cancela el pedido cuando se devuelve el importe completo', async () => {
    const pedido = await pedidoCobrado();

    await entregarEvento(app, reembolsado());

    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.CANCELADO);
  });

  it('devuelve las unidades al catálogo', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 2 }] });
    const pedido = await pedidoCobrado();

    await entregarEvento(app, reembolsado());

    expect(await stockDeTalla(1011, 'M')).toBe(3);
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.CANCELADO);
  });

  it('no devuelve stock de una línea que nunca llegó a descontarse', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 0 }] });
    const pedido = await crearPedido({
      estado: OrderStatus.PAGADO,
      items: [lineaDeProducto({ quantity: 1, talla: 'M' })],
      pago: {
        proveedor: 'stripe',
        paymentIntentId: ID_INTENTO,
        estado: 'succeeded',
        pagadoEn: new Date(),
      },
    });
    // El cobro se registró con una incidencia: no había existencias, así que no
    // se descontó nada y devolver inventaría unidades que nunca hubo.
    pedido.incidenciasStock = [{ codigoArticulo: 1011, talla: 'M', solicitadas: 1, detectadaEn: new Date() }];
    await pedido.save();

    await entregarEvento(app, reembolsado());

    expect(await stockDeTalla(1011, 'M')).toBe(0);
  });

  it('no devuelve el stock dos veces aunque Stripe reintente el aviso', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 2 }] });
    await pedidoCobrado();

    await entregarEvento(app, reembolsado());
    const segunda = await entregarEvento(app, reembolsado());

    expect(segunda.status).toBe(200);
    expect(await stockDeTalla(1011, 'M')).toBe(3);
  });

  it('no repite el trabajo si el reembolso salió de nuestro panel', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 3 }] });
    const pedido = await crearPedido({
      estado: OrderStatus.CANCELADO,
      items: [lineaDeProducto({ quantity: 1, talla: 'M' })],
      pago: {
        proveedor: 'stripe',
        paymentIntentId: ID_INTENTO,
        estado: 'succeeded',
        pagadoEn: new Date(),
        reembolsoId: 're_de_pruebas',
        reembolsadoEn: new Date(),
      },
    });

    await entregarEvento(app, reembolsado());

    expect(await stockDeTalla(1011, 'M')).toBe(3);
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.CANCELADO);
  });

  it('en una devolución parcial deja el pedido cobrado y no toca el stock', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 2 }] });
    const pedido = await pedidoCobrado();

    await entregarEvento(app, reembolsado({ importe: 5000, devuelto: 2000 }));

    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.PAGADO);
    expect(guardado.pago?.reembolsoId).toBe('re_de_pruebas');
    expect(await stockDeTalla(1011, 'M')).toBe(2);
  });

  it('acepta el aviso de un cobro que no es de ningún pedido nuestro', async () => {
    const respuesta = await entregarEvento(
      app,
      evento('charge.refunded', cargo({ paymentIntentId: 'pi_de_otro_sitio' })),
    );

    expect(respuesta.status).toBe(200);
  });
});
