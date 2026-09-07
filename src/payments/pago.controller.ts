import { Request, Response } from 'express';
import { HydratedDocument, isValidObjectId } from 'mongoose';
import Stripe from 'stripe';
import { IOrder, Order, OrderStatus, OrderItemTipo, ESTADOS_NO_PAGABLES } from '../orders/order.model';
import { descontarStockDeTalla } from '../products/producto.service';
import { consolidarSlotsDePedido } from '../availability/disponibilidad.service';
import { sendServerError, esDuenoOAdmin } from '../shared/controller.utils';
import { esOrigenPermitido } from '../shared/cors';
import { getStripe, getWebhookSecret, aCentimos, MONEDA, esReutilizable } from './stripe.utils';
import { crearOrdenPayPal, capturarOrdenPayPal, firmaDeWebhookEsValida } from './paypal.utils';

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

/** Linea que se cobro sin que quedaran existencias de su talla. */
type IncidenciaStock = { codigoArticulo: number; talla?: string; solicitadas: number; detectadaEn: Date };

/**
 * Descuenta del stock las lineas de producto de un pedido cobrado y devuelve
 * las que no se pudieron servir.
 * Los servicios no descuentan stock: su capacidad la controla el slot reservado.
 *
 * Se descuenta de LA TALLA que se compro, no de un contador general: es la
 * misma regla que aplico el alta del pedido al decidir si habia existencias, y
 * vive en la capa de servicio de productos para que las dos no puedan divergir.
 *
 * Lo que no cuadra se devuelve para anotarlo en el pedido, no solo en el log:
 * el dinero ya esta cobrado y el articulo no existe, asi que alguien tiene que
 * verlo en el panel y decidir si repone o devuelve el importe.
 */
const descontarStock = async (
  items: Array<{ codigoArticulo: number; quantity: number; tipo: string; talla?: string }>,
): Promise<IncidenciaStock[]> => {
  const productos = items.filter((item) => item.tipo === OrderItemTipo.PRODUCTO);

  const resultados = await Promise.all(
    productos.map(async (item): Promise<IncidenciaStock | null> => {
      const incidencia = {
        codigoArticulo: item.codigoArticulo,
        talla:          item.talla,
        solicitadas:    item.quantity,
        detectadaEn:    new Date(),
      };

      // Sin talla no hay de donde descontar. Es un pedido que no deberia haber
      // pasado la validacion del alta, y restar a ciegas de una talla
      // cualquiera solo taparia el fallo.
      if (!item.talla) {
        console.warn(`Linea del articulo ${item.codigoArticulo} sin talla: no se descuenta stock`);
        return incidencia;
      }

      const producto = await descontarStockDeTalla(item.codigoArticulo, item.talla, item.quantity);

      // No casar el filtro significa que ya no quedaban unidades de esa talla:
      // otro cobro se llevo las ultimas entre medias.
      if (!producto) {
        console.error(
          `Stock insuficiente al cobrar: articulo ${item.codigoArticulo} talla ${item.talla} x${item.quantity}`,
        );
        return incidencia;
      }

      return null;
    }),
  );

  return resultados.filter((r): r is IncidenciaStock => r !== null);
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

  // Lo que no se pudo servir queda anotado en el pedido, para que el panel lo
  // enseñe. Se guarda despues de marcar PAGADO a proposito: el cobro es un
  // hecho aunque el stock no cuadre, y ocultarlo no lo desharia.
  const incidencias = await descontarStock(order.items);
  if (incidencias.length > 0) {
    order.incidenciasStock = incidencias;
    await order.save();
  }
};

/**
 * Cobra la orden de PayPal de un pedido y lo consolida.
 *
 * La comparten los dos caminos por los que puede cerrarse un pago de PayPal: la
 * vuelta del cliente al sitio y el webhook que avisa de que aprobo. Los dos
 * pueden llegar, y en cualquier orden, asi que esto tiene que poder ejecutarse
 * dos veces sin cobrar dos veces: corta en seco si el pedido ya esta pagado, y
 * la captura viaja con un `PayPal-Request-Id` fijo que hace que PayPal devuelva
 * la que ya hizo en lugar de repetirla.
 */
const cerrarPagoDePayPal = async (
  order: Pedido,
): Promise<{ ok: true } | { ok: false; estado: number; error: string }> => {
  if (order.status === OrderStatus.PAGADO) return { ok: true };

  if (order.pago?.proveedor !== 'paypal' || !order.pago.paymentIntentId) {
    return { ok: false, estado: 409, error: 'Este pedido no tiene un pago de PayPal que capturar' };
  }

  const captura = await capturarOrdenPayPal(order.pago.paymentIntentId);

  if (!captura.completada) {
    order.pago.estado = captura.estado;
    await order.save();
    return { ok: false, estado: 409, error: `PayPal no completo el cobro (estado: ${captura.estado})` };
  }

  // La orden que PayPal acaba de cobrar tiene que ser la de este pedido: sin
  // esta comprobacion, una orden ajena aprobada por el mismo cliente daria
  // por pagado un pedido que nadie ha cobrado.
  if (captura.pedidoId && captura.pedidoId !== String(order._id)) {
    console.error(`Captura de PayPal cruzada: orden de ${captura.pedidoId} sobre el pedido ${order._id}`);
    return { ok: false, estado: 409, error: 'El cobro no corresponde a este pedido' };
  }

  // Se guarda el id de la CAPTURA y no el de la orden: es el unico con el que
  // PayPal admite un reembolso, y solo viene en esta respuesta. Sin el, un
  // pedido de PayPal no se podria devolver mas tarde.
  await marcarPagado(String(order._id), {
    referencia: captura.capturaId ?? order.pago.paymentIntentId,
    estado:     captura.estado,
    proveedor:  'paypal',
  });

  return { ok: true };
};

// POST /api/pedidos/:id/pago/capturar
// Cierra un pago de PayPal cuando el cliente vuelve de aprobarlo.
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
    res.status(400).json({ error: 'Firma no valida' });
    return;
  }

  try {
    // El id de nuestro pedido viaja como `custom_id`: en la orden va dentro de
    // `purchase_units`, y en la captura, suelto en el propio recurso.
    const pedidoId =
      evento.resource?.purchase_units?.[0]?.custom_id ?? evento.resource?.custom_id;

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
