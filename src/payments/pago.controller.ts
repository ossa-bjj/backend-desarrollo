/**
 * Manejadores HTTP del cobro. Las reglas viven en `pago.service.ts`: aqui solo
 * se lee la peticion, se llama y se traduce el resultado a una respuesta.
 */

import type { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import type Stripe from 'stripe';
import { Order } from '../orders/order.model';
import {
  sendServerError,
  esDuenoOAdmin,
  leerObjectId,
  noEncontrado,
  peticionInvalida,
  sinPermiso,
} from '../shared/controller.utils';
import { getStripe, getWebhookSecret } from './stripe.utils';
import { firmaDeWebhookEsValida } from './paypal.utils';
import {
  anotarEstadoDelIntento,
  cerrarPagoDePayPal,
  esMetodoValido,
  iniciarConPayPal,
  iniciarConStripe,
  marcarPagado,
  motivoParaNoCobrar,
  pedidoDelIntento,
  registrarDisputa,
  resolverUrlDeRetorno,
} from './pago.service';
import { registrarReembolsoExterno } from './reembolso.service';

// POST /api/pedidos/:id/pago/iniciar
// Arranca el cobro de un pedido ya confirmado con el metodo que pida el cliente.
export const iniciarPago = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = leerObjectId(res, req.params.id, 'pedido');
    if (!id) return;

    const order = await Order.findById(id);
    if (!order) {
      noEncontrado(res, 'Pedido');
      return;
    }

    // Nadie paga el pedido de otro.
    if (!esDuenoOAdmin(req, order.user)) {
      sinPermiso(res, 'No tienes permisos sobre este pedido');
      return;
    }

    const impedimento = motivoParaNoCobrar(order);
    if (impedimento) {
      res.status(impedimento.estado).json({ error: impedimento.error });
      return;
    }

    const metodo = req.body?.metodo ?? 'stripe';
    if (!esMetodoValido(metodo)) {
      peticionInvalida(res, `Método de pago no soportado: ${metodo}`);
      return;
    }

    if (metodo === 'paypal') {
      const returnUrl = resolverUrlDeRetorno(req.body?.returnUrl);
      if (!returnUrl) {
        peticionInvalida(res, 'Falta una URL de retorno válida para PayPal');
        return;
      }

      res.status(200).json({ success: true, data: await iniciarConPayPal(order, returnUrl) });
      return;
    }

    res.status(200).json({ success: true, data: await iniciarConStripe(order, metodo) });
  } catch (error) {
    sendServerError(res, 'Error iniciando el pago', error);
  }
};

// POST /api/pedidos/:id/pago/capturar
// Cierra un pago de PayPal cuando el cliente vuelve de aprobarlo.
export const capturarPago = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = leerObjectId(res, req.params.id, 'pedido');
    if (!id) return;

    const order = await Order.findById(id);
    if (!order) {
      noEncontrado(res, 'Pedido');
      return;
    }

    if (!esDuenoOAdmin(req, order.user)) {
      sinPermiso(res, 'No tienes permisos sobre este pedido');
      return;
    }

    const resultado = await cerrarPagoDePayPal(order);
    if (!resultado.ok) {
      res.status(resultado.estado).json({ error: resultado.error });
      return;
    }

    res.status(200).json({ success: true, data: await Order.findById(order._id) });
  } catch (error) {
    sendServerError(res, 'Error capturando el pago', error);
  }
};

// POST /api/pedidos/webhook/paypal
// Ruta publica: la autentica la firma de PayPal, no un token nuestro.
//
// Existe para el cliente que aprueba el pago y no vuelve al sitio —cierra la
// pestana, se queda sin bateria—. Sin esto su orden quedaba aprobada y sin
// capturar: nadie le cobraba, pero tampoco nadie se enteraba de que el pedido
// se habia quedado a medias.
export const paypalWebhook = async (req: Request, res: Response): Promise<void> => {
  const evento = req.body as {
    event_type?: string;
    resource?: { id?: string; custom_id?: string; purchase_units?: Array<{ custom_id?: string }> };
  };

  if (!(await firmaDeWebhookEsValida(req.headers, evento))) {
    // Puede ser un intento de dar por cobrado un pedido que nadie ha pagado.
    console.error('Webhook de PayPal con firma no valida');
    res.status(400).json({ error: 'Firma no válida' });
    return;
  }

  try {
    // El id de nuestro pedido viaja como `custom_id`: en la orden va dentro de
    // `purchase_units`, y en la captura, suelto en el propio recurso.
    const pedidoId = evento.resource?.purchase_units?.[0]?.custom_id ?? evento.resource?.custom_id;

    if (evento.event_type === 'CHECKOUT.ORDER.APPROVED' && pedidoId && isValidObjectId(pedidoId)) {
      const order = await Order.findById(pedidoId);

      if (!order) {
        console.warn(`Webhook de PayPal para un pedido inexistente: ${pedidoId}`);
      } else {
        const resultado = await cerrarPagoDePayPal(order);
        if (!resultado.ok) {
          // No se responde con error: PayPal reintentaria un aviso que no va a
          // mejorar por repetirse. Queda en el log para mirarlo a mano.
          console.error(`No se pudo cerrar por webhook el pedido ${pedidoId}: ${resultado.error}`);
        }
      }
    }

    // PayPal reintenta mientras no reciba un 2xx.
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error procesando el webhook de PayPal:', error);
    res.status(500).json({ error: 'Error procesando el evento' });
  }
};

// POST /api/pedidos/webhook
// Ruta publica: la autentica la firma de Stripe, no un token nuestro.
// Necesita el cuerpo en crudo, montado en index.ts antes de express.json().
export const stripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const firma = req.headers['stripe-signature'];
  if (typeof firma !== 'string') {
    peticionInvalida(res, 'Falta la cabecera stripe-signature');
    return;
  }

  let evento: Stripe.Event;
  try {
    evento = getStripe().webhooks.constructEvent(req.body as Buffer, firma, getWebhookSecret());
  } catch (error) {
    // Firma invalida: puede ser un intento de falsificar un pago.
    console.error('Firma de webhook de Stripe no valida:', (error as Error).message);
    res.status(400).json({ error: 'Firma no válida' });
    return;
  }

  try {
    switch (evento.type) {
      case 'payment_intent.succeeded': {
        const intent = evento.data.object;
        const order = await pedidoDelIntento(intent);
        if (order) {
          await marcarPagado(String(order._id), {
            referencia: intent.id,
            estado: intent.status,
            proveedor: 'stripe',
          });
        }
        break;
      }

      // Ninguno de los tres cierra el pedido: sigue siendo pagable y el cliente
      // puede reintentar. Solo cambia en que punto esta el intento.
      //
      // `processing` es el pago asincrono de Bizum: el cliente ya ha confirmado
      // en su banco, pero el dinero no esta. Hasta que llegue el `succeeded` no
      // se reserva el horario en firme ni baja el stock.
      //
      // `canceled` es el intento caducado o cancelado desde el panel. Anotarlo
      // importa porque al volver a pagar se reutiliza el intento guardado, y uno
      // cancelado ya no admite pago.
      case 'payment_intent.processing':
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled': {
        await anotarEstadoDelIntento(evento.data.object);
        break;
      }

      // El cliente ha reclamado el cobro a su banco. Stripe retiene el dinero y
      // abre un plazo para responder con pruebas; pasado ese plazo se pierde.
      // El cierre llega por el mismo camino y trae el desenlace.
      case 'charge.dispute.created':
      case 'charge.dispute.closed': {
        const disputa = evento.data.object;
        const intentId = typeof disputa.payment_intent === 'string' ? disputa.payment_intent : null;
        if (!intentId) break;

        const order = await Order.findOne({ 'pago.paymentIntentId': intentId });
        if (!order) {
          console.warn(`Reclamacion sobre un cobro que no es de ningun pedido: ${intentId}`);
          break;
        }

        await registrarDisputa(order, {
          id: disputa.id,
          estado: disputa.status,
          motivo: disputa.reason,
          importeEnCentimos: disputa.amount,
          cerrada: evento.type === 'charge.dispute.closed',
        });
        break;
      }

      // Devolucion hecha desde el panel de Stripe, sin pasar por el nuestro.
      // Sin esto el pedido seguiria figurando como cobrado y las unidades no
      // volverian al catalogo.
      case 'charge.refunded': {
        const cargo = evento.data.object;
        const intentId = typeof cargo.payment_intent === 'string' ? cargo.payment_intent : null;
        if (!intentId) break;

        const order = await Order.findOne({ 'pago.paymentIntentId': intentId });
        if (!order) {
          console.warn(`Reembolso de un cobro que no es de ningun pedido: ${intentId}`);
          break;
        }

        await registrarReembolsoExterno(order, {
          reembolsoId: cargo.refunds?.data?.[0]?.id ?? cargo.id,
          completo: cargo.amount_refunded >= cargo.amount,
        });
        break;
      }

      default:
        break;
    }

    // Stripe reintenta mientras no reciba un 2xx.
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error procesando el webhook de Stripe:', error);
    res.status(500).json({ error: 'Error procesando el evento' });
  }
};
