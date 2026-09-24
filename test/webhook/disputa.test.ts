/**
 * `charge.dispute.created` y `charge.dispute.closed`: el cliente reclama el
 * cobro a su banco.
 *
 * Es el aviso más urgente que puede llegar: Stripe retiene el importe y abre un
 * plazo para responder con pruebas; si nadie responde, el dinero se pierde. Sin
 * esto, la reclamación solo existía en el panel de Stripe, que no es donde se
 * miran los pedidos.
 *
 * Lo que NO debe pasar: que el webhook cancele el pedido o devuelva el stock por
 * su cuenta. Una reclamación se puede ganar y la mercancía puede estar enviada.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { OrderStatus } from '../../src/orders/order.model';
import { cargarApp, entregarEvento, evento } from '../ayudas/webhook';
import { crearPedido, crearProducto, lineaDeProducto, releerPedido, stockDeTalla } from '../ayudas/pedidos';

let app: Express;

const ID_INTENTO = 'pi_reclamado';

const disputa = (opciones: { estado: string; cerrada: boolean; id?: string; importe?: number }) =>
  evento(opciones.cerrada ? 'charge.dispute.closed' : 'charge.dispute.created', {
    id: opciones.id ?? 'dp_de_pruebas',
    object: 'dispute',
    amount: opciones.importe ?? 5000,
    currency: 'eur',
    charge: 'ch_de_pruebas',
    payment_intent: ID_INTENTO,
    reason: 'fraudulent',
    status: opciones.estado,
  });

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

describe('webhook de Stripe · reclamación al banco', () => {
  it('anota la reclamación en el pedido', async () => {
    const pedido = await pedidoCobrado();

    const respuesta = await entregarEvento(app, disputa({ estado: 'needs_response', cerrada: false }));

    expect(respuesta.status).toBe(200);
    const guardado = await releerPedido(pedido._id);
    expect(guardado.pago?.disputa).toMatchObject({
      id: 'dp_de_pruebas',
      estado: 'needs_response',
      motivo: 'fraudulent',
      importe: 50,
    });
    expect(guardado.pago?.disputa?.abiertaEn).toBeInstanceOf(Date);
    expect(guardado.pago?.disputa?.cerradaEn).toBeUndefined();
  });

  it('no cancela el pedido ni devuelve el stock: eso lo decide una persona', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 2 }] });
    const pedido = await pedidoCobrado();

    await entregarEvento(app, disputa({ estado: 'needs_response', cerrada: false }));

    const guardado = await releerPedido(pedido._id);
    expect(guardado.status).toBe(OrderStatus.PAGADO);
    expect(guardado.pago?.reembolsoId).toBeUndefined();
    expect(await stockDeTalla(1011, 'M')).toBe(2);
  });

  it('guarda el importe reclamado, que puede ser menor que el del pedido', async () => {
    const pedido = await pedidoCobrado();

    await entregarEvento(app, disputa({ estado: 'needs_response', cerrada: false, importe: 2000 }));

    expect((await releerPedido(pedido._id)).pago?.disputa?.importe).toBe(20);
  });

  it('actualiza el estado cuando la reclamación pasa a revisión', async () => {
    const pedido = await pedidoCobrado();

    await entregarEvento(app, disputa({ estado: 'needs_response', cerrada: false }));
    await entregarEvento(app, disputa({ estado: 'under_review', cerrada: false }));

    const guardado = await releerPedido(pedido._id);
    expect(guardado.pago?.disputa?.estado).toBe('under_review');
    expect(guardado.pago?.disputa?.cerradaEn).toBeUndefined();
  });

  it('cierra la reclamación cuando se gana, y conserva cuándo se abrió', async () => {
    const pedido = await pedidoCobrado();

    await entregarEvento(app, disputa({ estado: 'needs_response', cerrada: false }));
    const abiertaEn = (await releerPedido(pedido._id)).pago?.disputa?.abiertaEn;
    await entregarEvento(app, disputa({ estado: 'won', cerrada: true }));

    const guardado = await releerPedido(pedido._id);
    expect(guardado.pago?.disputa?.estado).toBe('won');
    expect(guardado.pago?.disputa?.cerradaEn).toBeInstanceOf(Date);
    expect(guardado.pago?.disputa?.abiertaEn).toEqual(abiertaEn);
    // Ganarla no cambia nada del pedido: el dinero vuelve y ya estaba pagado.
    expect(guardado.status).toBe(OrderStatus.PAGADO);
  });

  it('cierra la reclamación cuando se pierde, sin tocar el pedido por su cuenta', async () => {
    await crearProducto({ tallas: [{ talla: 'M', stock: 2 }] });
    const pedido = await pedidoCobrado();

    await entregarEvento(app, disputa({ estado: 'needs_response', cerrada: false }));
    await entregarEvento(app, disputa({ estado: 'lost', cerrada: true }));

    const guardado = await releerPedido(pedido._id);
    expect(guardado.pago?.disputa?.estado).toBe('lost');
    expect(guardado.pago?.disputa?.cerradaEn).toBeInstanceOf(Date);
    // El dinero se ha perdido, pero cancelar y reponer stock es decisión de una
    // persona: la mercancía puede estar enviada.
    expect(guardado.status).toBe(OrderStatus.PAGADO);
    expect(await stockDeTalla(1011, 'M')).toBe(2);
  });

  it('un reintento del mismo aviso no cambia nada', async () => {
    const pedido = await pedidoCobrado();

    await entregarEvento(app, disputa({ estado: 'needs_response', cerrada: false }));
    const primera = await releerPedido(pedido._id);
    await entregarEvento(app, disputa({ estado: 'needs_response', cerrada: false }));

    const segunda = await releerPedido(pedido._id);
    expect(segunda.pago?.disputa?.abiertaEn).toEqual(primera.pago?.disputa?.abiertaEn);
    expect(segunda.pago?.disputa?.estado).toBe('needs_response');
  });

  it('no pierde el rastro de un reembolso anterior', async () => {
    const pedido = await crearPedido({
      estado: OrderStatus.PAGADO,
      items: [lineaDeProducto({ quantity: 1, talla: 'M' })],
      pago: {
        proveedor: 'stripe',
        paymentIntentId: ID_INTENTO,
        estado: 'succeeded',
        pagadoEn: new Date(),
        reembolsoId: 're_anterior',
        reembolsadoEn: new Date(),
      },
    });

    await entregarEvento(app, disputa({ estado: 'needs_response', cerrada: false }));

    const guardado = await releerPedido(pedido._id);
    expect(guardado.pago?.reembolsoId).toBe('re_anterior');
    expect(guardado.pago?.disputa?.id).toBe('dp_de_pruebas');
  });

  it('acepta una reclamación de un cobro que no es de ningún pedido nuestro', async () => {
    const respuesta = await entregarEvento(
      app,
      evento('charge.dispute.created', {
        id: 'dp_ajena',
        object: 'dispute',
        amount: 5000,
        currency: 'eur',
        charge: 'ch_ajena',
        payment_intent: 'pi_de_otro_sitio',
        reason: 'fraudulent',
        status: 'needs_response',
      }),
    );

    expect(respuesta.status).toBe(200);
  });
});
