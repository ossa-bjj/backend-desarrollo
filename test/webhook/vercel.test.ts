/**
 * El webhook tal y como lo recibe en producción, detrás de Vercel.
 *
 * Vercel lee el cuerpo antes que la app y deja la petición marcada como leída.
 * `express.raw` (body-parser 2) ve esa marca y no hace nada, así que a la
 * verificación de firma le llegaba un objeto en vez de los bytes que firmó
 * Stripe. Resultado: todas las firmas se rechazaban en producción, con el
 * secreto correcto, mientras en local todo pasaba.
 *
 * Ver `test/ayudas/vercel.ts` para lo que se reproduce exactamente.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type http from 'node:http';
import request from 'supertest';
import { OrderStatus } from '../../src/orders/order.model';
import { cargarApp, evento, firmar, paymentIntent, RUTA_WEBHOOK } from '../ayudas/webhook';
import { crearPedido, releerPedido } from '../ayudas/pedidos';
import { servidorComoVercel } from '../ayudas/vercel';

let servidor: http.Server;

beforeAll(async () => {
  servidor = servidorComoVercel(await cargarApp());
});

const entregarComoVercel = (cuerpo: string, firma: string) =>
  request(servidor)
    .post(RUTA_WEBHOOK)
    .set('stripe-signature', firma)
    .set('content-type', 'application/json')
    .send(cuerpo);

describe('webhook de Stripe · detrás de Vercel', () => {
  it('acepta un aviso bien firmado aunque Vercel haya leído ya el cuerpo', async () => {
    const pedido = await crearPedido();
    const cuerpo = JSON.stringify(
      evento('payment_intent.succeeded', paymentIntent({ estado: 'succeeded', orderId: String(pedido._id) })),
    );

    const respuesta = await entregarComoVercel(cuerpo, firmar(cuerpo));

    expect(respuesta.status).toBe(200);
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.PAGADO);
  });

  it('verifica los bytes exactos: el mismo evento con otro espaciado no vale', async () => {
    const pedido = await crearPedido();
    const objeto = evento(
      'payment_intent.succeeded',
      paymentIntent({ estado: 'succeeded', orderId: String(pedido._id) }),
    );
    // Stripe firma los bytes tal cual. Si el servidor re-serializara el objeto
    // para verificar, este caso pasaría, y no debe.
    const firmadoCompacto = JSON.stringify(objeto);
    const enviadoConEspacios = JSON.stringify(objeto, null, 2);

    const respuesta = await entregarComoVercel(enviadoConEspacios, firmar(firmadoCompacto));

    expect(respuesta.status).toBe(400);
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.PENDIENTE);
  });

  it('sigue rechazando una firma falsa', async () => {
    const pedido = await crearPedido();
    const cuerpo = JSON.stringify(
      evento('payment_intent.succeeded', paymentIntent({ estado: 'succeeded', orderId: String(pedido._id) })),
    );

    const respuesta = await entregarComoVercel(cuerpo, 't=1,v1=firmafalsa');

    expect(respuesta.status).toBe(400);
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.PENDIENTE);
  });

  it('el resto de la API sigue recibiendo el JSON parseado', async () => {
    const respuesta = await request(servidor)
      .post('/api/pedidos/000000000000000000000000/pago/iniciar')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ metodo: 'stripe' }));

    // Sin token: lo importante es que llega al controlador y no revienta al
    // leer el cuerpo.
    expect(respuesta.status).toBe(401);
  });
});
