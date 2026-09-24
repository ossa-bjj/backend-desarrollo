import type { HydratedDocument } from 'mongoose';
import type { IOrder } from '../orders/order.model';
import { OrderItemTipo, OrderStatus } from '../orders/order.model';
import { devolverStockDeTalla } from '../products/producto.service';
import { getStripe } from './stripe.utils';
import { reembolsarCapturaPayPal } from './paypal.utils';

/**
 * Devolucion del dinero de un pedido ya cobrado.
 *
 * Vive en una capa propia y no en el controlador porque son dos pasarelas con
 * dos formas distintas de devolver, y quien cancela un pedido no tiene por que
 * saber por cual entro el dinero. Ademas hay dos cosas que van juntas siempre:
 * devolver el importe y devolver el stock. Separarlas dejaria pedidos
 * reembolsados cuyas unidades no vuelven al catalogo.
 */

type Pedido = HydratedDocument<IOrder>;

export type ResultadoReembolso = { ok: true; reembolsoId: string } | { ok: false; motivo: string };

/** Un pedido solo se devuelve si se llego a cobrar y no se devolvio ya. */
export const sePuedeReembolsar = (order: Pedido): string | null => {
  if (order.status !== OrderStatus.PAGADO) return 'El pedido no esta pagado';
  if (order.pago?.reembolsoId) return 'El pedido ya se reembolso';
  if (!order.pago?.paymentIntentId) return 'El pedido no tiene ninguna referencia de cobro';
  return null;
};

/**
 * Devuelve al catalogo las unidades de un pedido que se cancela.
 *
 * Solo las lineas que de verdad se descontaron: una que quedo como incidencia
 * nunca llego a restar nada, y devolverla inventaria existencias que no hubo.
 */
const devolverStock = async (order: Pedido): Promise<void> => {
  const falladas = new Set((order.incidenciasStock ?? []).map((i) => `${i.codigoArticulo}#${i.talla ?? ''}`));

  await Promise.all(
    order.items
      .filter((item) => item.tipo === OrderItemTipo.PRODUCTO && item.talla)
      .filter((item) => !falladas.has(`${item.codigoArticulo}#${item.talla ?? ''}`))
      .map((item) => devolverStockDeTalla(item.codigoArticulo, item.talla!, item.quantity)),
  );
};

/**
 * Anota un reembolso que ya ha ocurrido fuera de aqui y repone el stock.
 *
 * Es el caso de una devolucion hecha desde el panel de Stripe: el dinero ya ha
 * salido, asi que no hay nada que pedirle a la pasarela; lo que falta es que el
 * pedido lo refleje y que las unidades vuelvan al catalogo. Sin esto, un
 * reembolso hecho fuera dejaba el pedido figurando como cobrado.
 *
 * Idempotente: Stripe reintenta, y el reembolso puede haber salido de nuestro
 * propio panel, que ya hizo el trabajo. Un pedido con `reembolsoId` no se toca.
 *
 * Solo la devolucion completa cancela el pedido y repone existencias. Una
 * parcial —un descuento, un porte— deja el pedido cobrado: lo comprado sigue
 * comprado, y devolver stock ahi seria inventar unidades.
 */
export const registrarReembolsoExterno = async (
  order: Pedido,
  reembolso: { reembolsoId: string; completo: boolean },
): Promise<void> => {
  if (order.pago?.reembolsoId) return;

  order.set('pago.reembolsoId', reembolso.reembolsoId);
  order.set('pago.reembolsadoEn', new Date());

  if (reembolso.completo) {
    await devolverStock(order);
    order.status = OrderStatus.CANCELADO;
  }

  await order.save();
};

/**
 * Devuelve el importe por donde entro y repone el stock.
 *
 * No cambia el estado del pedido: de eso se encarga quien lo cancela, para que
 * el cambio de estado y la devolucion queden en la misma decision y no en dos
 * sitios que puedan discrepar.
 */
export const reembolsarPedido = async (order: Pedido): Promise<ResultadoReembolso> => {
  const impedimento = sePuedeReembolsar(order);
  if (impedimento) return { ok: false, motivo: impedimento };

  const referencia = order.pago!.paymentIntentId;

  try {
    // Bizum entra por Stripe, asi que se devuelve por Stripe: lo que decide es
    // la pasarela por la que paso el dinero, no el boton que pulso el cliente.
    const reembolsoId =
      order.pago?.proveedor === 'paypal'
        ? await reembolsarCapturaPayPal(referencia)
        : (await getStripe().refunds.create({ payment_intent: referencia })).id;

    // Por ruta y no reconstruyendo `pago` entero: asi no se pierde nada de lo
    // que ya hubiera ahi —el cobro, una reclamacion abierta— al anotar esto.
    order.set('pago.reembolsoId', reembolsoId);
    order.set('pago.reembolsadoEn', new Date());
    await devolverStock(order);

    return { ok: true, reembolsoId };
  } catch (error) {
    // El importe no ha salido, asi que el stock tampoco se toca: dejarlo a
    // medias seria peor que no haber empezado.
    return { ok: false, motivo: (error as Error).message };
  }
};
