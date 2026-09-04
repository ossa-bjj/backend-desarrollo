import { Request, Response } from 'express';
import { HydratedDocument, isValidObjectId } from 'mongoose';
import Stripe from 'stripe';
import { IOrder, Order, OrderStatus, OrderItemTipo, ESTADOS_NO_PAGABLES } from '../orders/order.model';
import { ProductoModelo } from '../products/producto.model';
import { consolidarSlotsDePedido } from '../availability/disponibilidad.service';
import { sendServerError, esDuenoOAdmin } from '../shared/controller.utils';
import { esOrigenPermitido } from '../shared/cors';
import { getStripe, getWebhookSecret, aCentimos, MONEDA, esReutilizable } from './stripe.utils';
import { crearOrdenPayPal, capturarOrdenPayPal } from './paypal.utils';

/**
 * Metodos que el cliente puede elegir.
 *
 * Bizum se cobra a traves de Stripe, no es una pasarela aparte, pero se guarda
 * como metodo propio: el pedido debe recordar por donde entro el dinero, y un
 * intento creado para Bizum no sirve para pagar con tarjeta.
 */
const METODOS = ['stripe', 'bizum', 'paypal'] as const;
type MetodoPago = (typeof METODOS)[number];

const esMetodoValido = (valor: unknown): valor is MetodoPago =>
  typeof valor === 'string' && (METODOS as readonly string[]).includes(valor);

/** Metodos de Stripe segun el boton que haya pulsado el cliente. */
type TiposDeStripe = NonNullable<Stripe.PaymentIntentCreateParams['payment_method_types']>;

const TIPOS_DE_STRIPE: Record<'stripe' | 'bizum', TiposDeStripe> = {
  // El boton dice "tarjeta", asi que ofrece tarjeta y nada mas. Dejarlo en
  // automatico haria aparecer en esa pestana cualquier metodo activado en el
  // panel de Stripe, incluido Bizum, que aqui tiene su propio boton.
  stripe: ['card'],
  bizum:  ['bizum'],
};

type Pedido = HydratedDocument<IOrder>;

/**
 * Comprueba que el pedido se puede cobrar ahora mismo. Devuelve el error listo
 * para responder, o `null` si esta todo en orden.
 */
const motivoParaNoCobrar = (order: Pedido): { estado: number; error: string } | null => {
  if (order.status === OrderStatus.PAGADO) {
    return { estado: 409, error: 'Este pedido ya esta pagado' };
  }

  // El gate de confirmacion se aplica aqui: un presupuesto sin tarificar no
  // se puede cobrar por mucho que el cliente fuerce la peticion.
  if (ESTADOS_NO_PAGABLES.includes(order.status)) {
    return {
      estado: 409,
      error: order.status === OrderStatus.PENDIENTE_CONFIRMACION
        ? 'El pedido todavia esta pendiente de confirmacion'
        : `No se puede pagar un pedido en estado "${order.status}"`,
    };
  }

  if (order.total <= 0) {
    return { estado: 400, error: 'El importe del pedido no es cobrable' };
  }

  return null;
};

/**
 * URL a la que PayPal devuelve al cliente cuando termina.
 *
 * La manda el navegador, asi que se valida contra la misma lista de origenes
 * que gobierna CORS: sin esa comprobacion, cualquiera podria usar el endpoint
 * para mandar a un cliente a un dominio ajeno con aspecto de vuelta del pago.
 */
const resolverUrlDeRetorno = (valor: unknown): string | null => {
  if (typeof valor !== 'string' || !valor) return null;

  try {
    const url = new URL(valor);
    return esOrigenPermitido(url.origin) ? url.toString() : null;
  } catch {
    return null;
  }
};

/** Crea o reutiliza el PaymentIntent de Stripe y responde con su clientSecret. */
const iniciarConStripe = async (
  order: Pedido,
  metodo: 'stripe' | 'bizum',
  res: Response,
): Promise<void> => {
  const stripe = getStripe();
  const importe = aCentimos(order.total);

  // Se reutiliza el intento vivo en lugar de generar otro: evita dejar
  // PaymentIntents huerfanos cada vez que el cliente recarga la pagina. Solo
  // vale si se creo para este mismo metodo; un intento de Bizum no admite
  // tarjeta, y al reves tampoco.
  if (order.pago?.paymentIntentId && order.pago.proveedor === metodo) {
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
            proveedor:    metodo,
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
    payment_method_types: TIPOS_DE_STRIPE[metodo],
  });

  order.pago = {
    proveedor:       metodo,
    paymentIntentId: intent.id,
    estado:          intent.status,
  };
  await order.save();

  res.status(200).json({
    success: true,
    data: {
      proveedor:    metodo,
      clientSecret: intent.client_secret,
      orderId:      String(order._id),
    },
  });
};

/**
 * Crea la orden de PayPal y responde con la URL de aprobacion.
 *
 * A diferencia de Stripe, aqui no hay formulario incrustado: el cliente sale a
 * PayPal, aprueba, y vuelve a `returnUrl`, donde el frontend pide la captura.
 */
const iniciarConPayPal = async (order: Pedido, req: Request, res: Response): Promise<void> => {
  const returnUrl = resolverUrlDeRetorno(req.body?.returnUrl);
  if (!returnUrl) {
    res.status(400).json({ error: 'Falta una URL de retorno valida para PayPal' });
    return;
  }

  const cancelUrl = new URL(returnUrl);
  cancelUrl.searchParams.set('pago', 'cancelado');

  const orden = await crearOrdenPayPal(
    String(order._id),
    order.total,
    returnUrl,
    cancelUrl.toString(),
  );

  order.pago = {
    proveedor:       'paypal',
    paymentIntentId: orden.id,
    estado:          'creada',
  };
  await order.save();

  res.status(200).json({
    success: true,
    data: {
      proveedor:  'paypal',
      approveUrl: orden.approveUrl,
      orderId:    String(order._id),
    },
  });
};

// POST /api/pedidos/:id/pago/iniciar
// Arranca el cobro de un pedido ya confirmado con el metodo que pida el cliente.
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
    if (!esDuenoOAdmin(req, order.user)) {
      res.status(403).json({ error: 'No tienes permisos sobre este pedido' });
      return;
    }

    const impedimento = motivoParaNoCobrar(order);
    if (impedimento) {
      res.status(impedimento.estado).json({ error: impedimento.error });
      return;
    }

    const metodo = req.body?.metodo ?? 'stripe';
    if (!esMetodoValido(metodo)) {
      res.status(400).json({ error: `Metodo de pago no soportado: ${metodo}` });
      return;
    }

    if (metodo === 'paypal') {
      await iniciarConPayPal(order, req, res);
      return;
    }

    await iniciarConStripe(order, metodo, res);
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

/**
 * Marca el pedido como pagado y consolida lo que dependia del cobro.
 *
 * Es el unico sitio donde un pedido pasa a PAGADO, venga el aviso del webhook
 * de Stripe o de la captura de PayPal: si cada proveedor consolidara por su
 * cuenta, la reserva del horario y el descuento de stock acabarian divergiendo.
 * Idempotente a proposito — Stripe reintenta el webhook y el cliente puede
 * recargar la pagina de retorno de PayPal.
 */
const marcarPagado = async (
  orderId: string,
  cobro: { referencia: string; estado: string; proveedor: string },
): Promise<void> => {
  const order = await Order.findById(orderId);
  if (!order) {
    console.warn(`Aviso de cobro para un pedido inexistente: ${orderId}`);
    return;
  }

  if (order.status === OrderStatus.PAGADO) return;

  order.status = OrderStatus.PAGADO;
  order.pago = {
    // El metodo que eligio el cliente manda sobre el proveedor tecnico: un
    // cobro por Bizum llega por Stripe, y el pedido debe seguir diciendo Bizum.
    proveedor:       order.pago?.proveedor ?? cobro.proveedor,
    paymentIntentId: cobro.referencia,
    estado:          cobro.estado,
    pagadoEn:        new Date(),
  };
  await order.save();

  // La reserva deja de caducar y el stock baja solo cuando hay dinero de verdad.
  await consolidarSlotsDePedido(order._id);
  await descontarStock(order.items);
};

// POST /api/pedidos/:id/pago/capturar
// Cierra un pago de PayPal cuando el cliente vuelve de aprobarlo.
//
// PayPal no manda webhook en este flujo: el dinero se mueve en esta llamada, y
// por eso la captura es idempotente en los dos lados (PayPal-Request-Id alli,
// el corte por estado PAGADO aqui).
export const capturarPago = async (req: Request, res: Response): Promise<void> => {
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

    if (!esDuenoOAdmin(req, order.user)) {
      res.status(403).json({ error: 'No tienes permisos sobre este pedido' });
      return;
    }

    // Recargar la pagina de retorno no es un error: el pedido ya esta cobrado.
    if (order.status === OrderStatus.PAGADO) {
      res.status(200).json({ success: true, data: order });
      return;
    }

    if (order.pago?.proveedor !== 'paypal' || !order.pago.paymentIntentId) {
      res.status(409).json({ error: 'Este pedido no tiene un pago de PayPal que capturar' });
      return;
    }

    const captura = await capturarOrdenPayPal(order.pago.paymentIntentId);

    if (!captura.completada) {
      order.pago.estado = captura.estado;
      await order.save();
      res.status(409).json({ error: `PayPal no completo el cobro (estado: ${captura.estado})` });
      return;
    }

    // La orden que PayPal acaba de cobrar tiene que ser la de este pedido: sin
    // esta comprobacion, una orden ajena aprobada por el mismo cliente daria
    // por pagado un pedido que nadie ha cobrado.
    if (captura.pedidoId && captura.pedidoId !== String(order._id)) {
      console.error(`Captura de PayPal cruzada: orden de ${captura.pedidoId} sobre el pedido ${order._id}`);
      res.status(409).json({ error: 'El cobro no corresponde a este pedido' });
      return;
    }

    await marcarPagado(String(order._id), {
      referencia: order.pago.paymentIntentId,
      estado:     captura.estado,
      proveedor:  'paypal',
    });

    res.status(200).json({ success: true, data: await Order.findById(order._id) });
  } catch (error) {
    sendServerError(res, 'Error capturando el pago', error);
  }
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
        if (orderId) {
          await marcarPagado(orderId, {
            referencia: intent.id,
            estado:     intent.status,
            proveedor:  'stripe',
          });
        }
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
