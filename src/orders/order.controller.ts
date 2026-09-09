import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Order, OrderStatus, OrderItemTipo, identidadLinea } from './order.model';
import { reembolsarPedido, type ResultadoReembolso } from '../payments/reembolso.service';
import {
  retenerSlots,
  liberarSlotsDePedido,
  liberarSlot,
  consolidarSlotsDePedido,
  reasignarSlot,
} from '../availability/disponibilidad.service';
import { leerCriteriosPedido, listarPedidos, prepararPedido } from './order.service';
import {
  sendServerError,
  esAdmin,
  esDuenoOAdmin,
  leerObjectId,
  noEncontrado,
  peticionInvalida,
  conflicto,
  sinPermiso,
} from '../shared/controller.utils';
import { redondearEuros } from '../shared/dinero';

// Ajuste que el admin aplica a una linea al confirmar el presupuesto.
interface AjusteLinea {
  codigoArticulo: unknown;
  /** Horario original de la linea: junto al codigo la identifica de forma unica. */
  slotOriginalId?: unknown;
  price?: unknown;
  quantity?: unknown;
  motivoAjuste?: unknown;
  slotId?: string;
  slotLabel?: unknown;
}

// GET /api/pedidos?status=&usuario=&desde=&hasta=&pagina=&limite=
// Quien no es admin queda acotado a sus propios pedidos: el filtro de usuario
// lo impone el servidor con la identidad del token, no la query.
export const getOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const lectura = leerCriteriosPedido(req.query, esAdmin(req), req.user!.id);
    if (!lectura.ok) {
      peticionInvalida(res, lectura.error);
      return;
    }

    const { pedidos, total, pagina, limite } = await listarPedidos(lectura.criterios);

    res.status(200).json({ success: true, data: pedidos, meta: { total, pagina, limite } });
  } catch (error) {
    sendServerError(res, 'Error obteniendo pedidos', error);
  }
};

// GET /api/pedidos/:id
export const getOrderById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!leerObjectId(res, id, 'pedido')) return;

    const order = await Order.findById(id).populate('user', 'username email');
    if (!order) {
      noEncontrado(res, 'Pedido');
      return;
    }

    if (!esDuenoOAdmin(req, order.user)) {
      sinPermiso(res, 'No tienes permisos para ver este pedido');
      return;
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    sendServerError(res, 'Error obteniendo pedido', error);
  }
};

// POST /api/pedidos
// El cliente manda unicamente { codigoArticulo, quantity, slotId? } por linea.
// Nombre, precio, imagen y total se resuelven aqui contra la base de datos:
// confiar en el precio que envia el navegador permitiria pagar 0,01 EUR por
// cualquier articulo en cuanto Stripe este conectado.
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { items, shippingAddress, user } = req.body;
    const userId = esAdmin(req) && user ? user : req.user!.id;

    const preparado = await prepararPedido(items);
    if (!preparado.ok) {
      res.status(preparado.estado).json({ error: preparado.error });
      return;
    }

    const order = await new Order({
      user: userId,
      items: preparado.items,
      total: preparado.total,
      shippingAddress,
      status: preparado.necesitaConfirmacion ? OrderStatus.PENDIENTE_CONFIRMACION : OrderStatus.PENDIENTE,
    }).save();

    // Los horarios se retienen contra el pedido ya creado. Si alguno se lo llevo
    // otro cliente mientras tanto, se anula el pedido en lugar de venderlo dos veces.
    const slotIds = preparado.items
      .map((item) => item.slotId)
      .filter((id): id is string => typeof id === 'string');

    if (slotIds.length > 0) {
      const { ocupados } = await retenerSlots(order._id, slotIds);
      if (ocupados.length > 0) {
        await liberarSlotsDePedido(order._id);
        await order.deleteOne();
        conflicto(res, 'Alguno de los horarios elegidos ya no está disponible. Vuelve a elegir hora.');
        return;
      }
    }

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    sendServerError(res, 'Error creando pedido', error);
  }
};

// PATCH /api/pedidos/:id/confirmar  (admin)
// Cierra el presupuesto: el admin ajusta precio, cantidad, motivo y horario de
// cada linea, y el pedido pasa a ser pagable. A partir de aqui el total del
// pedido manda sobre el catalogo: Stripe cobrara exactamente esta cifra.
export const confirmOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!leerObjectId(res, id, 'pedido')) return;

    const order = await Order.findById(id);
    if (!order) {
      noEncontrado(res, 'Pedido');
      return;
    }

    if (order.status !== OrderStatus.PENDIENTE_CONFIRMACION) {
      conflicto(res, 'Este pedido no está pendiente de confirmación');
      return;
    }

    // Los ajustes se indexan por la identidad de la linea con su horario ORIGINAL:
    // es la unica forma de saber a que sesion se refiere cada ajuste.
    const ajustes = new Map<string, AjusteLinea>();
    if (Array.isArray(req.body?.ajustes)) {
      for (const ajuste of req.body.ajustes as AjusteLinea[]) {
        const codigo = Number(ajuste?.codigoArticulo);
        if (!Number.isInteger(codigo)) continue;
        const slotOriginal = typeof ajuste.slotOriginalId === 'string' ? ajuste.slotOriginalId : undefined;
        ajustes.set(identidadLinea(codigo, slotOriginal), ajuste);
      }
    }

    // --- 1. Emparejar cada linea con su ajuste y validarlo, sin tocar nada ---
    // El emparejamiento se hace aqui, mientras los horarios siguen siendo los
    // originales, que es por lo que estan indexados los ajustes. Y se valida
    // todo antes de escribir: un precio invalido en la ultima linea no puede
    // dejar movido el horario de la primera, con la agenda escrita y el pedido no.
    const ajustePorLinea = new Map<(typeof order.items)[number], AjusteLinea>();

    for (const item of order.items) {
      const ajuste = ajustes.get(identidadLinea(item.codigoArticulo, item.slotId));
      if (!ajuste) continue;
      ajustePorLinea.set(item, ajuste);

      if (ajuste.price !== undefined) {
        const precio = Number(ajuste.price);
        if (!Number.isFinite(precio) || precio < 0) {
          peticionInvalida(res, `Precio no válido para el artículo ${item.codigoArticulo}`);
          return;
        }
      }

      if (ajuste.quantity !== undefined) {
        const cantidad = Number(ajuste.quantity);
        if (!Number.isInteger(cantidad) || cantidad < 1) {
          peticionInvalida(res, `Cantidad no válida para el artículo ${item.codigoArticulo}`);
          return;
        }
      }
    }

    // --- 2. Mover los horarios, anotando lo hecho para poder deshacerlo ---
    // Es el unico paso que escribe fuera del pedido, y puede fallar a mitad:
    // que otro cliente se quede el hueco es una carrera normal, no un error.
    const movidos: Array<{ item: (typeof order.items)[number]; anterior?: string }> = [];

    const deshacerMovimientos = async (): Promise<void> => {
      for (const { item, anterior } of movidos.reverse()) {
        if (anterior) {
          const vuelto = await reasignarSlot(order._id, item.slotId, anterior);
          // Si otro cliente se ha quedado el hueco de origen en el intervalo, la
          // vuelta atras no es posible. No hay nada que hacer desde aqui, pero
          // no puede quedar invisible: es una reserva que hay que revisar a mano.
          if (!vuelto) {
            console.error(
              `No se pudo devolver el horario ${anterior} al pedido ${order._id}: ` +
                `la linea ${item.codigoArticulo} se queda sin su hueco original.`,
            );
          }
        } else if (item.slotId) {
          // La linea no tenia horario antes: el nuevo se suelta sin mas.
          await liberarSlot(order._id, item.slotId);
        }
        item.slotId = anterior;
      }
    };

    for (const [item, ajuste] of ajustePorLinea) {
      // Cambio de horario: solo tiene sentido en lineas de servicio.
      if (!ajuste.slotId || item.tipo !== OrderItemTipo.SERVICIO || ajuste.slotId === item.slotId) {
        continue;
      }

      const anterior = item.slotId;
      const reasignado = await reasignarSlot(order._id, anterior, ajuste.slotId);
      if (!reasignado) {
        await deshacerMovimientos();
        conflicto(res, `El horario elegido para "${item.name}" ya no está disponible`);
        return;
      }

      item.slotId = ajuste.slotId;
      item.slotLabel = typeof ajuste.slotLabel === 'string' ? ajuste.slotLabel : item.slotLabel;
      movidos.push({ item, anterior });
    }

    // --- 3. Aplicar precios y cantidades, ya sin nada que pueda fallar ---
    let total = 0;

    for (const item of order.items) {
      const ajuste = ajustePorLinea.get(item);

      if (ajuste) {
        if (ajuste.price !== undefined) item.price = redondearEuros(Number(ajuste.price));
        if (ajuste.quantity !== undefined) item.quantity = Number(ajuste.quantity);
        if (typeof ajuste.motivoAjuste === 'string') {
          item.motivoAjuste = ajuste.motivoAjuste.trim() || undefined;
        }
      }

      total += item.price * item.quantity;
    }

    order.total = redondearEuros(total);
    order.status = OrderStatus.PENDIENTE;
    order.confirmadoEn = new Date();
    order.confirmadoPor = req.user?.id ? new Types.ObjectId(req.user.id) : undefined;
    order.motivoRechazo = undefined;

    try {
      await order.save();
    } catch (error) {
      // Guardar es lo ultimo que puede fallar, y si falla los horarios ya estan
      // movidos: hay que devolverlos antes de propagar, o la agenda quedaria
      // reflejando una confirmacion que no llego a existir.
      await deshacerMovimientos();
      throw error;
    }

    // La reserva deja de ser provisional: ya no caduca sola.
    await consolidarSlotsDePedido(order._id);

    const confirmado = await Order.findById(order._id).populate('user', 'username email');
    res.status(200).json({ success: true, data: confirmado });
  } catch (error) {
    sendServerError(res, 'Error confirmando el pedido', error);
  }
};

// PATCH /api/pedidos/:id/rechazar  (admin)
export const rejectOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!leerObjectId(res, id, 'pedido')) return;

    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!motivo) {
      peticionInvalida(res, 'Indica el motivo del rechazo');
      return;
    }

    const order = await Order.findById(id);
    if (!order) {
      noEncontrado(res, 'Pedido');
      return;
    }

    if (order.status !== OrderStatus.PENDIENTE_CONFIRMACION) {
      conflicto(res, 'Solo se puede rechazar un pedido pendiente de confirmación');
      return;
    }

    order.status = OrderStatus.RECHAZADO;
    order.motivoRechazo = motivo;
    await order.save();

    // Los horarios vuelven al catalogo de inmediato.
    await liberarSlotsDePedido(order._id);

    const rechazado = await Order.findById(order._id).populate('user', 'username email');
    res.status(200).json({ success: true, data: rechazado });
  } catch (error) {
    sendServerError(res, 'Error rechazando el pedido', error);
  }
};

// PATCH /api/pedidos/:id/status

export const updateOrderStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!leerObjectId(res, id, 'pedido')) return;

    if (!Object.values(OrderStatus).includes(status)) {
      peticionInvalida(res, 'Estado de pedido no válido');
      return;
    }

    const order = await Order.findById(id).populate('user', 'username email');

    if (!order) {
      noEncontrado(res, 'Pedido');
      return;
    }

    // Cancelar un pedido YA COBRADO tiene que devolver el dinero, y hay que
    // hacerlo antes de cambiar el estado: si el reembolso falla, el pedido se
    // queda como estaba en vez de figurar cancelado con el importe retenido.
    const hayQueDevolver = status === OrderStatus.CANCELADO && order.status === OrderStatus.PAGADO;
    let reembolso: ResultadoReembolso | null = null;

    if (hayQueDevolver) {
      reembolso = await reembolsarPedido(order);
      if (!reembolso.ok) {
        conflicto(res, `No se pudo reembolsar el pedido: ${reembolso.motivo}`);
        return;
      }
    }

    order.status = status;
    await order.save();

    // Cancelar o rechazar devuelve los horarios al catalogo; cobrar los consolida.
    if (status === OrderStatus.CANCELADO || status === OrderStatus.RECHAZADO) {
      await liberarSlotsDePedido(order._id);
    } else if (status === OrderStatus.PAGADO) {
      await consolidarSlotsDePedido(order._id);
    }

    res.status(200).json({
      success: true,
      data: order,
      ...(reembolso?.ok ? { message: `Importe devuelto (${reembolso.reembolsoId})` } : {}),
    });
  } catch (error) {
    sendServerError(res, 'Error actualizando estado del pedido', error);
  }
};

// DELETE /api/pedidos/:id
export const deleteOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!leerObjectId(res, id, 'pedido')) return;

    const order = await Order.findByIdAndDelete(id);
    if (!order) {
      noEncontrado(res, 'Pedido');
      return;
    }

    // Sin esto los horarios quedarian ocupados por un pedido que ya no existe.
    await liberarSlotsDePedido(order._id);

    res.status(200).json({ success: true, message: 'Pedido eliminado' });
  } catch (error) {
    sendServerError(res, 'Error eliminando pedido', error);
  }
};
