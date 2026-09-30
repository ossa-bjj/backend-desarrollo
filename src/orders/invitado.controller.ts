import type { Request, Response } from 'express';
import { Order, OrderItemTipo, OrderStatus } from './order.model';
import { HORARIO_OCUPADO, prepararPedido, retenerHorariosDelPedido } from './order.service';
import {
  CABECERA_CLAVE_INVITADO,
  claveInvitadoValida,
  generarClaveInvitado,
  leerDatosInvitado,
  leerDireccionEnvio,
} from './invitado.service';
import { anularCobroEnCurso, type Pedido } from '../payments/pago.service';
import { liberarSlotsDePedido } from '../availability/disponibilidad.service';
import { anadirDireccionAFicha, obtenerFichaDeInvitado } from '../users/ficha-invitado.service';
import { claveIp, segundosHasta, superaLimiteDeUso } from '../users/acceso.service';
import {
  conflicto,
  leerObjectId,
  noEncontrado,
  peticionInvalida,
  sendServerError,
  sinPermiso,
} from '../shared/controller.utils';

/**
 * Compra sin cuenta: rutas publicas bajo `/api/pedidos/invitado`.
 *
 * No cuelgan de `isAuth` porque no hay token que comprobar. Lo que protege el
 * pedido es la clave de `invitado.service.ts`, que viaja en la cabecera
 * `X-Clave-Pedido`. Ninguna de estas rutas responde 401: el frontend reserva ese
 * codigo para cerrar una sesion caducada, y aqui no hay sesion.
 */

/**
 * Pedidos de invitado por IP y hora. Holgado para una familia que compra desde
 * la misma red; corto para quien quiera llenar la agenda de pedidos sin pagar o
 * la coleccion de usuarios de fichas inventadas.
 */
const MAXIMO_PEDIDOS_POR_IP = 10;
const VENTANA_LIMITE_MINUTOS = 60;

/**
 * Respuesta cuando el correo es de una cuenta de verdad. No es una fuga nueva:
 * `POST /api/users/register` ya dice si un correo esta registrado.
 */
const CORREO_CON_CUENTA = 'Este correo ya tiene una cuenta. Inicia sesión para comprar con ella.';

/** Ficha bloqueada por el admin. No se dice por que: no hay que darle pistas a nadie. */
const COMPRA_NO_ADMITIDA = 'No podemos tramitar este pedido. Ponte en contacto con la tienda.';

// POST /api/pedidos/invitado
// Mismo alta que la de un cliente con cuenta —precios, stock y horarios se
// resuelven igual, contra el catalogo—, mas los datos de contacto del comprador.
// El pedido queda a nombre de su ficha de invitado: un `User` sin contrasena que
// no puede iniciar sesion (`users/ficha-invitado.service.ts`).
export const createGuestOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const invitado = leerDatosInvitado(req.body?.invitado);
    if (!invitado.ok) {
      peticionInvalida(res, invitado.error);
      return;
    }

    const direccion = leerDireccionEnvio(req.body?.shippingAddress);
    if (!direccion.ok) {
      peticionInvalida(res, direccion.error);
      return;
    }

    const preparado = await prepararPedido(req.body?.items);
    if (!preparado.ok) {
      res.status(preparado.estado).json({ error: preparado.error });
      return;
    }

    // Un presupuesto se paga dias despues, cuando el admin lo tarifica, y sin
    // cuenta no hay donde volver a encontrarlo.
    if (preparado.necesitaConfirmacion) {
      peticionInvalida(
        res,
        'El pedido incluye un servicio que se presupuesta antes de cobrar: para contratarlo necesitas una cuenta',
      );
      return;
    }

    // Un producto hay que mandarlo a algun sitio. Un servicio no.
    const llevaProductos = preparado.items.some((item) => item.tipo === OrderItemTipo.PRODUCTO);
    if (llevaProductos && !direccion.valor) {
      peticionInvalida(res, 'Falta la dirección de envío');
      return;
    }

    // Se cuenta aqui, con el pedido ya validado y justo antes de escribir nada:
    // es escribir —fichas, pedidos, horarios retenidos— lo que hay que frenar.
    const bloqueo = await superaLimiteDeUso(
      `pedido-invitado:${claveIp(req.ip ?? 'desconocida')}`,
      MAXIMO_PEDIDOS_POR_IP,
      VENTANA_LIMITE_MINUTOS,
    );
    if (bloqueo) {
      res.set('Retry-After', String(segundosHasta(bloqueo)));
      res.status(429).json({ error: 'Demasiados pedidos seguidos. Inténtalo de nuevo más tarde' });
      return;
    }

    const resultado = await obtenerFichaDeInvitado(invitado.valor);
    if (!resultado.ok) {
      if (resultado.motivo === 'bloqueada') sinPermiso(res, COMPRA_NO_ADMITIDA);
      else conflicto(res, CORREO_CON_CUENTA);
      return;
    }
    const { ficha } = resultado;

    const { clave, huella } = generarClaveInvitado();

    const order = await new Order({
      user: ficha._id,
      invitado: invitado.valor,
      accesoInvitado: huella,
      items: preparado.items,
      total: preparado.total,
      shippingAddress: direccion.valor,
      status: OrderStatus.PENDIENTE,
    }).save();

    // Si el horario se lo lleva otro, el pedido se borra pero la ficha se
    // queda aunque sea nueva. Borrarla aqui chocaba con otra compra del mismo
    // correo que la estuviera usando en ese instante: su pedido quedaba
    // apuntando a una ficha inexistente. Una ficha sin pedidos no hace dano, y
    // son los datos de alguien que intento comprar.
    if (!(await retenerHorariosDelPedido(order))) {
      conflicto(res, HORARIO_OCUPADO);
      return;
    }

    // Solo con el pedido ya en pie. Y si falla, el pedido sigue siendo valido:
    // su direccion viaja en el propio pedido, la de la ficha es un extra.
    try {
      await anadirDireccionAFicha(ficha._id, direccion.valor);
    } catch (error) {
      console.error(`No se pudo guardar la direccion en la ficha ${String(ficha._id)}:`, error);
    }

    // La clave en claro sale aqui y en ningun otro sitio: el pedido solo guarda
    // su huella, asi que si el cliente la pierde no hay forma de recuperarla.
    res.status(201).json({ success: true, data: { pedido: order, claveAcceso: clave } });
  } catch (error) {
    sendServerError(res, 'Error creando pedido', error);
  }
};

/**
 * Carga el pedido de invitado de la ruta y comprueba su clave.
 *
 * Devuelve `null` cuando ya ha respondido. Un pedido con cuenta, uno que no
 * existe y una clave equivocada responden lo mismo, 404: esta puerta no le
 * confirma a nadie sin clave que ids de pedido existen.
 */
export const cargarPedidoDeInvitado = async (req: Request, res: Response): Promise<Pedido | null> => {
  const id = leerObjectId(res, req.params.id, 'pedido');
  if (!id) return null;

  const order = await Order.findById(id).select('+accesoInvitado');

  if (
    !order ||
    !order.invitado ||
    !claveInvitadoValida(order.accesoInvitado, req.get(CABECERA_CLAVE_INVITADO))
  ) {
    noEncontrado(res, 'Pedido');
    return null;
  }

  return order;
};

// GET /api/pedidos/invitado/:id
// Lo que lee la pantalla de confirmacion al volver de la pasarela.
export const getGuestOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const order = await cargarPedidoDeInvitado(req, res);
    if (!order) return;

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    sendServerError(res, 'Error obteniendo pedido', error);
  }
};

// POST /api/pedidos/invitado/:id/cancelar
// El invitado abandona su pedido sin pagar: cambia el carrito, corrige sus
// datos o entra con su cuenta a mitad. Sin esto, el pedido abandonado seguia
// reteniendo su horario, y el siguiente intento de ese mismo cliente chocaba
// con su propia retencion.
export const cancelGuestOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const order = await cargarPedidoDeInvitado(req, res);
    if (!order) return;

    // Idempotente: el frontend puede repetirlo al recargar.
    if (order.status === OrderStatus.CANCELADO) {
      res.status(200).json({ success: true, data: order });
      return;
    }

    // Solo lo que esta por pagar. Lo pagado se cancela desde el panel, que es
    // quien devuelve el dinero.
    if (order.status !== OrderStatus.PENDIENTE || order.pago?.pagadoEn) {
      conflicto(res, 'Este pedido ya no se puede cancelar');
      return;
    }

    const anulado = await anularCobroEnCurso(order);
    if (!anulado.ok) {
      conflicto(res, anulado.error);
      return;
    }

    order.status = OrderStatus.CANCELADO;
    await order.save();
    await liberarSlotsDePedido(order._id);

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    sendServerError(res, 'Error cancelando el pedido', error);
  }
};
