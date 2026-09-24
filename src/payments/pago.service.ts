/**
 * Reglas del cobro de un pedido.
 *
 * Todo lo que hay aqui son operaciones de dominio, no manejadores HTTP: quien
 * llame no necesita un `Response` ni sabe nada de codigos de estado. Estaban
 * dentro de `pago.controller.ts`, que asi pasaba de 521 lineas y guardaba en un
 * fichero de controladores la operacion mas importante del sistema —marcar un
 * pedido como pagado—.
 */

import type { HydratedDocument } from 'mongoose';
import { isValidObjectId } from 'mongoose';
import type Stripe from 'stripe';
import type { IOrder } from '../orders/order.model';
import { Order, OrderStatus, OrderItemTipo, ESTADOS_NO_PAGABLES } from '../orders/order.model';
import { descontarStockDeTalla } from '../products/producto.service';
import { consolidarSlotsDePedido } from '../availability/disponibilidad.service';
import { esOrigenPermitido } from '../shared/cors';
import { aCentimos } from '../shared/dinero';
import { getStripe, MONEDA, esReutilizable } from './stripe.utils';
import { crearOrdenPayPal, capturarOrdenPayPal } from './paypal.utils';

export type Pedido = HydratedDocument<IOrder>;

/**
 * Metodos que el cliente puede elegir.
 *
 * Bizum se cobra a traves de Stripe, no es una pasarela aparte, pero se guarda
 * como metodo propio: el pedido debe recordar por donde entro el dinero, y un
 * intento creado para Bizum no sirve para pagar con tarjeta.
 *
 * CONTRATO CON EL FRONTEND. La misma lista existe como `MetodoPago` en
 * `frontend/src/features/pago/model/pago.types.ts`, y el valor viaja tal cual en
 * el cuerpo de la peticion. Anadir un metodo en un solo lado no da error de
 * compilacion en ninguno: el cliente ofrece un boton que el servidor rechaza,
 * o el servidor admite algo que nadie pide. Si cambia, cambia en los dos.
 */
export const METODOS = ['stripe', 'bizum', 'paypal'] as const;
export type MetodoPago = (typeof METODOS)[number];

export const esMetodoValido = (valor: unknown): valor is MetodoPago =>
  typeof valor === 'string' && (METODOS as readonly string[]).includes(valor);

/** Metodos de Stripe segun el boton que haya pulsado el cliente. */
type TiposDeStripe = NonNullable<Stripe.PaymentIntentCreateParams['payment_method_types']>;

const TIPOS_DE_STRIPE: Record<'stripe' | 'bizum', TiposDeStripe> = {
  // El boton dice "tarjeta", asi que ofrece tarjeta y nada mas. Dejarlo en
  // automatico haria aparecer en esa pestana cualquier metodo activado en el
  // panel de Stripe, incluido Bizum, que aqui tiene su propio boton.
  stripe: ['card'],
  bizum: ['bizum'],
};

/**
 * Comprueba que el pedido se puede cobrar ahora mismo. Devuelve el motivo con
 * el codigo que le corresponde, o `null` si esta todo en orden.
 */
export const motivoParaNoCobrar = (order: Pedido): { estado: number; error: string } | null => {
  if (order.status === OrderStatus.PAGADO) {
    return { estado: 409, error: 'Este pedido ya está pagado' };
  }

  // El gate de confirmacion se aplica aqui: un presupuesto sin tarificar no
  // se puede cobrar por mucho que el cliente fuerce la peticion.
  if (ESTADOS_NO_PAGABLES.includes(order.status)) {
    return {
      estado: 409,
      error:
        order.status === OrderStatus.PENDIENTE_CONFIRMACION
          ? 'El pedido todavía está pendiente de confirmación'
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
export const resolverUrlDeRetorno = (valor: unknown): string | null => {
  if (typeof valor !== 'string' || !valor) return null;

  try {
    const url = new URL(valor);
    return esOrigenPermitido(url.origin) ? url.toString() : null;
  } catch {
    return null;
  }
};

/** Lo que necesita el cliente para seguir con el cobro, segun la pasarela. */
export type InicioDePago =
  | { proveedor: MetodoPago; clientSecret: string | null; orderId: string }
  | { proveedor: 'paypal'; approveUrl: string; orderId: string };

/** Crea o reutiliza el PaymentIntent de Stripe y devuelve su clientSecret. */
export const iniciarConStripe = async (order: Pedido, metodo: 'stripe' | 'bizum'): Promise<InicioDePago> => {
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
        const actualizado =
          existente.amount === importe
            ? existente
            : await stripe.paymentIntents.update(existente.id, { amount: importe });

        return { proveedor: metodo, clientSecret: actualizado.client_secret, orderId: String(order._id) };
      }
    } catch {
      /* el intento ya no existe en Stripe: se crea uno nuevo */
    }
  }

  const intent = await stripe.paymentIntents.create({
    amount: importe,
    currency: MONEDA,
    // Ata el cobro al pedido: es lo que lee el webhook para saber que marcar.
    metadata: {
      orderId: String(order._id),
      usuario: String(order.user),
    },
    payment_method_types: TIPOS_DE_STRIPE[metodo],
  });

  order.pago = {
    proveedor: metodo,
    paymentIntentId: intent.id,
    estado: intent.status,
  };
  await order.save();

  return { proveedor: metodo, clientSecret: intent.client_secret, orderId: String(order._id) };
};

/**
 * Crea la orden de PayPal y devuelve la URL de aprobacion.
 *
 * A diferencia de Stripe, aqui no hay formulario incrustado: el cliente sale a
 * PayPal, aprueba, y vuelve a `returnUrl`, donde el frontend pide la captura.
 */
export const iniciarConPayPal = async (order: Pedido, returnUrl: string): Promise<InicioDePago> => {
  const cancelUrl = new URL(returnUrl);
  cancelUrl.searchParams.set('pago', 'cancelado');

  const orden = await crearOrdenPayPal(String(order._id), order.total, returnUrl, cancelUrl.toString());

  order.pago = {
    proveedor: 'paypal',
    paymentIntentId: orden.id,
    estado: 'creada',
  };
  await order.save();

  return { proveedor: 'paypal', approveUrl: orden.approveUrl, orderId: String(order._id) };
};

/**
 * Encuentra el pedido al que se refiere un aviso de Stripe.
 *
 * El camino principal es `metadata.orderId`, que se graba al crear el intento.
 * El respaldo es el id del intento, que el pedido guarda y esta indexado: hace
 * falta porque no todos los eventos traen la metadata del PaymentIntent —un
 * cobro creado desde el panel de Stripe, por ejemplo—, y porque perder un aviso
 * de cobro significa dejar sin consolidar un pedido que si esta pagado.
 */
export const pedidoDelIntento = async (intent: {
  id: string;
  metadata?: Stripe.Metadata | null;
}): Promise<Pedido | null> => {
  const orderId = intent.metadata?.orderId;
  if (orderId && isValidObjectId(orderId)) {
    const porMetadata = await Order.findById(orderId);
    if (porMetadata) return porMetadata;
  }

  return Order.findOne({ 'pago.paymentIntentId': intent.id });
};

/**
 * Guarda en que punto va el intento, sin cambiar el estado del pedido.
 *
 * Sirve para los avisos que no son el cobro: rechazo, pago asincrono en curso e
 * intento caducado. Ninguno cierra el pedido —el cliente puede reintentar—,
 * pero todos cambian lo que hay que ensenar en el panel.
 *
 * Un pedido ya pagado no se toca: Stripe no garantiza el orden de entrega ni
 * deja de reintentar un aviso viejo, y un `payment_failed` que llega tarde no
 * puede pisar el estado de un cobro que si entro.
 */
export const anotarEstadoDelIntento = async (intent: {
  id: string;
  status: string;
  metadata?: Stripe.Metadata | null;
}): Promise<void> => {
  const order = await pedidoDelIntento(intent);
  if (!order) {
    console.warn(`Aviso de Stripe para un pedido inexistente: intento ${intent.id}`);
    return;
  }

  if (order.status === OrderStatus.PAGADO) return;

  order.pago = {
    proveedor: order.pago?.proveedor ?? 'stripe',
    paymentIntentId: order.pago?.paymentIntentId ?? intent.id,
    estado: intent.status,
  };
  await order.save();
};

/**
 * Anota en el pedido una reclamacion del cliente a su banco.
 *
 * Stripe retiene el importe en cuanto se abre y da un plazo para responder con
 * pruebas; si nadie responde, se pierde. Es lo mas urgente que puede llegar por
 * el webhook, y hasta ahora no llegaba a ninguna parte: quedaba solo en el panel
 * de Stripe, que no es donde se miran los pedidos.
 *
 * Deliberadamente NO cambia el estado del pedido ni devuelve stock. Una
 * reclamacion se puede ganar, y la mercancia puede estar ya enviada: eso lo
 * decide una persona, no un webhook. Aqui solo se deja constancia.
 *
 * Idempotente por el mismo motivo de siempre: Stripe reintenta. El cierre pisa
 * al alta porque llega despues y trae el desenlace.
 */
export const registrarDisputa = async (
  order: Pedido,
  disputa: { id: string; estado: string; motivo?: string; importeEnCentimos: number; cerrada: boolean },
): Promise<void> => {
  const anterior = order.pago?.disputa;
  if (anterior?.id === disputa.id && anterior.estado === disputa.estado) return;

  // Por ruta y no reconstruyendo `pago` entero: lo que ya hay ahi —el cobro, un
  // reembolso anterior— tiene que seguir estando.
  order.set('pago.disputa', {
    id: disputa.id,
    estado: disputa.estado,
    motivo: disputa.motivo,
    importe: disputa.importeEnCentimos / 100,
    abiertaEn: anterior?.abiertaEn ?? new Date(),
    cerradaEn: disputa.cerrada ? new Date() : anterior?.cerradaEn,
  });

  await order.save();

  // El log es la unica alarma que hay hoy. Mientras no haya aviso por correo,
  // esto es lo que queda si nadie entra al panel.
  if (!disputa.cerrada) {
    console.error(
      `RECLAMACION abierta sobre el pedido ${String(order._id)} (${disputa.id}, ${disputa.estado}): hay un plazo para responder con pruebas`,
    );
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
        talla: item.talla,
        solicitadas: item.quantity,
        detectadaEn: new Date(),
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
export const marcarPagado = async (
  orderId: string,
  cobro: { referencia: string; estado: string; proveedor: string },
): Promise<void> => {
  const order = await Order.findById(orderId);
  if (!order) {
    console.warn(`Aviso de cobro para un pedido inexistente: ${orderId}`);
    return;
  }

  // Se mira si el cobro YA SE REGISTRO, no el estado actual: el estado sigue
  // avanzando despues de cobrar —preparando, enviado, o cancelado si se
  // reembolsa—, y Stripe reintenta el aviso durante dias. Mirando solo `status`,
  // un `succeeded` que llegaba tarde devolvia a "pagado" un pedido ya enviado o
  // reembolsado y descontaba el stock otra vez. `pagadoEn` se escribe una sola
  // vez y no cambia.
  if (order.status === OrderStatus.PAGADO || order.pago?.pagadoEn) return;

  order.status = OrderStatus.PAGADO;
  order.pago = {
    // El metodo que eligio el cliente manda sobre el proveedor tecnico: un
    // cobro por Bizum llega por Stripe, y el pedido debe seguir diciendo Bizum.
    proveedor: order.pago?.proveedor ?? cobro.proveedor,
    paymentIntentId: cobro.referencia,
    estado: cobro.estado,
    pagadoEn: new Date(),
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
export const cerrarPagoDePayPal = async (
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
    return { ok: false, estado: 409, error: `PayPal no completó el cobro (estado: ${captura.estado})` };
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
    estado: captura.estado,
    proveedor: 'paypal',
  });

  return { ok: true };
};
