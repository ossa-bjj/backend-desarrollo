import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import Stripe from 'stripe';
import { Order, OrderStatus, OrderItemTipo, ESTADOS_NO_PAGABLES } from '../orders/order.model';
import { ProductoModelo } from '../products/producto.model';
import { UserRole } from '../users/user.model';
import { consolidarSlotsDePedido } from '../availability/disponibilidad.service';
import { sendServerError } from '../shared/controller.utils';
import { getStripe, getWebhookSecret, aCentimos, MONEDA, esReutilizable } from './stripe.utils';

const esAdmin = (req: Request): boolean => req.user?.rol === UserRole.ADMIN;

// POST /api/pedidos/:id/pago/iniciar
// Crea (o reutiliza) el PaymentIntent de un pedido ya confirmado y devuelve el
// clientSecret que Stripe Elements necesita en el navegador.
export const iniciarPago = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de pedido no valido' });
      return;
    }

    const order = await Order.findById(id);
    if (!order) {
      res.status(404).json({ error: 'Pedido no encontrado' });
      return;
    }

    // Nadie paga el pedido de otro.
    if (!esAdmin(req) && String(order.user) !== req.user?.id) {
      res.status(403).json({ error: 'No tienes permisos sobre este pedido' });
      return;
    }

    if (order.status === OrderStatus.PAGADO) {
      res.status(409).json({ error: 'Este pedido ya esta pagado' });
      return;
    }

    // El gate de confirmacion se aplica aqui: un presupuesto sin tarificar no
    // se puede cobrar por mucho que el cliente fuerce la peticion.
    if (ESTADOS_NO_PAGABLES.includes(order.status)) {
      res.status(409).json({
        error: order.status === OrderStatus.PENDIENTE_CONFIRMACION
          ? 'El pedido todavia esta pendiente de confirmacion'
          : `No se puede pagar un pedido en estado "${order.status}"`,
      });
      return;
    }

    const metodo = typeof req.body?.metodo === 'string' ? req.body.metodo : 'stripe';
    if (metodo !== 'stripe') {
      res.status(400).json({ error: `Proveedor de pago no soportado: ${metodo}` });
      return;
    }

    if (order.total <= 0) {
      res.status(400).json({ error: 'El importe del pedido no es cobrable' });
      return;
    }

    const stripe = getStripe();
    const importe = aCentimos(order.total);

    // Si ya habia un intento vivo se reutiliza en lugar de generar otro: evita
    // dejar PaymentIntents huerfanos cada vez que el cliente recarga la pagina.
    if (order.pago?.paymentIntentId) {
      try {
        const existente = await stripe.paymentIntents.retrieve(order.pago.paymentIntentId);

        if (esReutilizable(existente)) {
          // El admin puede haber retarificado el pedido despues de crearlo.
          const actualizado = existente.amount === importe
            ? existente
            : await stripe.paymentIntents.update(existente.id, { amount: importe });

          res.status(200).json({
            success: true,
            data: {
              proveedor:    'stripe',
              clientSecret: actualizado.client_secret,
              orderId:      String(order._id),
            },
          });
          return;
        }
      } catch {
        /* el intento ya no existe en Stripe: se crea uno nuevo */
      }
    }

    const intent = await stripe.paymentIntents.create({
      amount:   importe,
      currency: MONEDA,
      // Ata el cobro al pedido: es lo que lee el webhook para saber que marcar.
      metadata: {
        orderId: String(order._id),
        usuario: String(order.user),
      },
      automatic_payment_methods: { enabled: true },
    });

    order.pago = {
      proveedor:       'stripe',
      paymentIntentId: intent.id,
      estado:          intent.status,
    };
    await order.save();

    res.status(200).json({
      success: true,
      data: {
        proveedor:    'stripe',
        clientSecret: intent.client_secret,
        orderId:      String(order._id),
      },
    });
  } catch (error) {
    sendServerError(res, 'Error iniciando el pago', error);
  }
};

/**
 * Descuenta del stock las lineas de producto de un pedido cobrado.
 * Los servicios no descuentan stock: su capacidad la controla el slot reservado.
 */
const descontarStock = async (items: Array<{ codigoArticulo: number; quantity: number; tipo: string }>): Promise<void> => {
  await Promise.all(
    items
      .filter((item) => item.tipo === OrderItemTipo.PRODUCTO)
      .map((item) => ProductoModelo.updateOne(
        { codigoArticulo: item.codigoArticulo },
        { $inc: { stock: -item.quantity } },
      )),
  );
};

/** Marca el pedido como pagado y consolida lo que dependia del cobro. */
const marcarPagado = async (orderId: string, paymentIntent: Stripe.PaymentIntent): Promise<void> => {
  const order = await Order.findById(orderId);
  if (!order) {
    console.warn(`Webhook de Stripe para un pedido inexistente: ${orderId}`);
    return;
  }

  // El webhook puede llegar repetido: Stripe reintenta si no respondemos 2xx.
  if (order.status === OrderStatus.PAGADO) return;

  order.status = OrderStatus.PAGADO;
  order.pago = {
    proveedor:       'stripe',
    paymentIntentId: paymentIntent.id,
    estado:          paymentIntent.status,
    pagadoEn:        new Date(),
  };
  await order.save();

  // La reserva deja de caducar y el stock baja solo cuando hay dinero de verdad.
  await consolidarSlotsDePedido(order._id);
  await descontarStock(order.items);
};

// POST /api/pedidos/webhook
// Ruta publica: la autentica la firma de Stripe, no un token nuestro.
// Necesita el cuerpo en crudo, montado en index.ts antes de express.json().
export const stripeWebhook = async (req: Request, res: Response): Promise<void> => {
  const firma = req.headers['stripe-signature'];
  if (typeof firma !== 'string') {
    res.status(400).json({ error: 'Falta la cabecera stripe-signature' });
    return;
  }

  let evento: Stripe.Event;
  try {
    evento = getStripe().webhooks.constructEvent(req.body as Buffer, firma, getWebhookSecret());
  } catch (error) {
    // Firma invalida: puede ser un intento de falsificar un pago.
    console.error('Firma de webhook de Stripe no valida:', (error as Error).message);
    res.status(400).json({ error: 'Firma no valida' });
    return;
  }

  try {
    switch (evento.type) {
      case 'payment_intent.succeeded': {
        const intent = evento.data.object;
        const orderId = intent.metadata?.orderId;
        if (orderId) await marcarPagado(orderId, intent);
        break;
      }

      case 'payment_intent.payment_failed': {
        const intent = evento.data.object;
        const orderId = intent.metadata?.orderId;
        if (orderId) {
          // El pedido sigue pagable: el cliente puede reintentar.
          await Order.findByIdAndUpdate(orderId, {
            'pago.estado': intent.status,
          });
        }
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
