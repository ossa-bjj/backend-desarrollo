import { Request, Response } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { Order, OrderStatus, OrderItemTipo, identidadLinea } from './order.model';
import { ProductoModelo } from '../products/producto.model';
import { ServicioModelo, CODIGO_SERVICIO_MIN, CODIGO_SERVICIO_MAX } from '../services/servicio.model';
import { normalizarUrlMedia } from '../shared/r2.utils';
import {
  retenerSlots,
  liberarSlotsDePedido,
  consolidarSlotsDePedido,
  reasignarSlot,
} from '../availability/disponibilidad.service';
import { leerCriteriosPedido, listarPedidos } from './order.service';
import { sendServerError, esAdmin, esDuenoOAdmin } from '../shared/controller.utils';

// Linea de pedido tal y como la envia el cliente: solo dice QUE quiere y CUANTO.
// El precio nunca viaja en la peticion, se resuelve contra el catalogo.
interface LineaPedidoInput {
  codigoArticulo: unknown;
  quantity:       unknown;
  slotId?:        unknown;
  slotLabel?:     unknown;
}

// Entrada del catalogo ya normalizada, sea producto o servicio.
interface EntradaCatalogo {
  name:      string;
  price:     number;
  image?:    string;
  tipo:      OrderItemTipo;
  // Tope de unidades vendibles: stock en productos, plazas en servicios.
  maximo:    number;
  etiqueta:  string;
  // Si alguna linea lo pide, el pedido entero pasa por confirmacion previa.
  requiereConfirmacion: boolean;
}

// Ajuste que el admin aplica a una linea al confirmar el presupuesto.
interface AjusteLinea {
  codigoArticulo: unknown;
  /** Horario original de la linea: junto al codigo la identifica de forma unica. */
  slotOriginalId?: unknown;
  price?:         unknown;
  quantity?:      unknown;
  motivoAjuste?:  unknown;
  slotId?:        string;
  slotLabel?:     unknown;
}

const esCodigoDeServicio = (codigo: number): boolean =>
  codigo >= CODIGO_SERVICIO_MIN && codigo <= CODIGO_SERVICIO_MAX;

const redondearEuros = (valor: number): number => Math.round(valor * 100) / 100;

// GET /api/pedidos?status=&usuario=&desde=&hasta=&pagina=&limite=
// Quien no es admin queda acotado a sus propios pedidos: el filtro de usuario
// lo impone el servidor con la identidad del token, no la query.
export const getOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const lectura = leerCriteriosPedido(req.query, esAdmin(req), req.user!.id);
    if (!lectura.ok) {
      res.status(400).json({ error: lectura.error });
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

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de pedido no válido' });
      return;
    }

    const order = await Order.findById(id).populate('user', 'username email');
    if (!order) {
      res.status(404).json({ error: 'Pedido no encontrado' });
      return;
    }

    if (!esDuenoOAdmin(req, order.user)) {
      res.status(403).json({ error: 'No tienes permisos para ver este pedido' });
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

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'El pedido debe incluir al menos una linea' });
      return;
    }

    const lineas = items as LineaPedidoInput[];

    // --- Validacion de forma antes de tocar la base de datos ---
    const codigos: number[] = [];
    for (const linea of lineas) {
      const codigo = Number(linea.codigoArticulo);
      if (!Number.isInteger(codigo)) {
        res.status(400).json({ error: `Codigo de articulo no valido: ${String(linea.codigoArticulo)}` });
        return;
      }
      codigos.push(codigo);
    }

    // Dos sesiones del mismo servicio a distinta hora son dos lineas legitimas.
    // Lo que no se admite es repetir exactamente la misma combinacion.
    const claves = lineas.map((linea, i) =>
      identidadLinea(codigos[i], typeof linea.slotId === 'string' ? linea.slotId : undefined));

    if (new Set(claves).size !== claves.length) {
      res.status(400).json({ error: 'El pedido repite el mismo articulo y horario dos veces' });
      return;
    }

    // --- Resolucion del catalogo: los servicios viven en su propia coleccion ---
    const codigosServicio = codigos.filter(esCodigoDeServicio);
    const codigosProducto = codigos.filter((codigo) => !esCodigoDeServicio(codigo));

    const [productos, servicios] = await Promise.all([
      codigosProducto.length
        ? ProductoModelo.find({ codigoArticulo: { $in: codigosProducto } })
        : Promise.resolve([]),
      codigosServicio.length
        ? ServicioModelo.find({ codigoArticulo: { $in: codigosServicio } })
        : Promise.resolve([]),
    ]);

    const catalogo = new Map<number, EntradaCatalogo>();

    for (const producto of productos) {
      catalogo.set(producto.codigoArticulo, {
        name:     producto.name,
        price:    producto.price,
        image:    normalizarUrlMedia(producto.imagenes?.[0] ?? ''),
        tipo:     OrderItemTipo.PRODUCTO,
        maximo:   producto.stock,
        etiqueta: 'unidades en stock',
        requiereConfirmacion: false,
      });
    }

    for (const servicio of servicios) {
      // Un servicio desactivado deja de venderse, aunque siga en carritos antiguos.
      if (!servicio.activo) continue;
      catalogo.set(servicio.codigoArticulo, {
        name:     servicio.nombre,
        price:    servicio.precio,
        image:    normalizarUrlMedia(servicio.imagenes?.[0] ?? ''),
        tipo:     OrderItemTipo.SERVICIO,
        maximo:   servicio.plazas,
        etiqueta: 'plazas disponibles',
        requiereConfirmacion: servicio.requiereConfirmacion,
      });
    }

    // --- Construccion de las lineas definitivas ---
    const itemsResueltos = [];
    const unidadesPorArticulo = new Map<number, number>();
    let total = 0;

    for (let i = 0; i < lineas.length; i += 1) {
      const linea = lineas[i];
      const codigo = codigos[i];
      const entrada = catalogo.get(codigo);

      if (!entrada) {
        res.status(400).json({ error: `El articulo ${codigo} no esta disponible` });
        return;
      }

      const quantity = Number(linea.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        res.status(400).json({ error: `Cantidad no valida para el articulo ${codigo}` });
        return;
      }

      // Con varias lineas del mismo articulo hay que sumar: tres reservas de una
      // plaza agotan un servicio de tres plazas igual que una reserva de tres.
      const acumulado = (unidadesPorArticulo.get(codigo) ?? 0) + quantity;
      if (acumulado > entrada.maximo) {
        res.status(409).json({
          error: `Solo quedan ${entrada.maximo} ${entrada.etiqueta} de "${entrada.name}"`,
        });
        return;
      }
      unidadesPorArticulo.set(codigo, acumulado);

      const esServicio = entrada.tipo === OrderItemTipo.SERVICIO;

      itemsResueltos.push({
        codigoArticulo: codigo,
        name:           entrada.name,
        quantity,
        price:          entrada.price,
        precioOriginal: entrada.price,
        image:          entrada.image,
        tipo:           entrada.tipo,
        slotId:         esServicio && typeof linea.slotId === 'string' ? linea.slotId : undefined,
        slotLabel:      esServicio && typeof linea.slotLabel === 'string' ? linea.slotLabel : undefined,
      });

      total += entrada.price * quantity;
    }

    // Un solo servicio marcado como presupuesto obliga a revisar el pedido entero:
    // no tiene sentido cobrar la mitad y dejar la otra a la espera.
    const necesitaConfirmacion = lineas.some((_, i) => catalogo.get(codigos[i])?.requiereConfirmacion);

    const order = await new Order({
      user: userId,
      items: itemsResueltos,
      total: redondearEuros(total),
      shippingAddress,
      status: necesitaConfirmacion ? OrderStatus.PENDIENTE_CONFIRMACION : OrderStatus.PENDIENTE,
    }).save();

    // Los horarios se retienen contra el pedido ya creado. Si alguno se lo llevo
    // otro cliente mientras tanto, se anula el pedido en lugar de venderlo dos veces.
    const slotIds = itemsResueltos
      .map((item) => item.slotId)
      .filter((id): id is string => typeof id === 'string');

    if (slotIds.length > 0) {
      const { ocupados } = await retenerSlots(order._id, slotIds);
      if (ocupados.length > 0) {
        await liberarSlotsDePedido(order._id);
        await order.deleteOne();
        res.status(409).json({
          error: 'Alguno de los horarios elegidos ya no esta disponible. Vuelve a elegir hora.',
        });
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
    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de pedido no valido' });
      return;
    }

    const order = await Order.findById(id);
    if (!order) {
      res.status(404).json({ error: 'Pedido no encontrado' });
      return;
    }

    if (order.status !== OrderStatus.PENDIENTE_CONFIRMACION) {
      res.status(409).json({ error: 'Este pedido no esta pendiente de confirmacion' });
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

    let total = 0;

    for (const item of order.items) {
      const ajuste = ajustes.get(identidadLinea(item.codigoArticulo, item.slotId));

      if (ajuste) {
        if (ajuste.price !== undefined) {
          const precio = Number(ajuste.price);
          if (!Number.isFinite(precio) || precio < 0) {
            res.status(400).json({ error: `Precio no valido para el articulo ${item.codigoArticulo}` });
            return;
          }
          item.price = redondearEuros(precio);
        }

        if (ajuste.quantity !== undefined) {
          const cantidad = Number(ajuste.quantity);
          if (!Number.isInteger(cantidad) || cantidad < 1) {
            res.status(400).json({ error: `Cantidad no valida para el articulo ${item.codigoArticulo}` });
            return;
          }
          item.quantity = cantidad;
        }

        if (typeof ajuste.motivoAjuste === 'string') {
          item.motivoAjuste = ajuste.motivoAjuste.trim() || undefined;
        }

        // Cambio de horario: solo tiene sentido en lineas de servicio.
        if (ajuste.slotId && item.tipo === OrderItemTipo.SERVICIO && ajuste.slotId !== item.slotId) {
          const reasignado = await reasignarSlot(order._id, item.slotId, ajuste.slotId);
          if (!reasignado) {
            res.status(409).json({
              error: `El horario elegido para "${item.name}" ya no esta disponible`,
            });
            return;
          }
          item.slotId    = ajuste.slotId;
          item.slotLabel = typeof ajuste.slotLabel === 'string' ? ajuste.slotLabel : item.slotLabel;
        }
      }

      total += item.price * item.quantity;
    }

    order.total         = redondearEuros(total);
    order.status        = OrderStatus.PENDIENTE;
    order.confirmadoEn  = new Date();
    order.confirmadoPor = req.user?.id ? new Types.ObjectId(req.user.id) : undefined;
    order.motivoRechazo = undefined;
    await order.save();

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
    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de pedido no valido' });
      return;
    }

    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!motivo) {
      res.status(400).json({ error: 'Indica el motivo del rechazo' });
      return;
    }

    const order = await Order.findById(id);
    if (!order) {
      res.status(404).json({ error: 'Pedido no encontrado' });
      return;
    }

    if (order.status !== OrderStatus.PENDIENTE_CONFIRMACION) {
      res.status(409).json({ error: 'Solo se puede rechazar un pedido pendiente de confirmacion' });
      return;
    }

    order.status        = OrderStatus.RECHAZADO;
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

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de pedido no válido' });
      return;
    }

    if (!Object.values(OrderStatus).includes(status)) {
      res.status(400).json({ error: 'Estado de pedido no válido' });
      return;
    }

    const order = await Order.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true },
    ).populate('user', 'username email');

    if (!order) {
      res.status(404).json({ error: 'Pedido no encontrado' });
      return;
    }

    // Cancelar o rechazar devuelve los horarios al catalogo; cobrar los consolida.
    if (status === OrderStatus.CANCELADO || status === OrderStatus.RECHAZADO) {
      await liberarSlotsDePedido(order._id);
    } else if (status === OrderStatus.PAGADO) {
      await consolidarSlotsDePedido(order._id);
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    sendServerError(res, 'Error actualizando estado del pedido', error);
  }
};

// DELETE /api/pedidos/:id
export const deleteOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de pedido no válido' });
      return;
    }

    const order = await Order.findByIdAndDelete(id);
    if (!order) {
      res.status(404).json({ error: 'Pedido no encontrado' });
      return;
    }

    // Sin esto los horarios quedarian ocupados por un pedido que ya no existe.
    await liberarSlotsDePedido(order._id);

    res.status(200).json({ success: true, message: 'Pedido eliminado' });
  } catch (error) {
    sendServerError(res, 'Error eliminando pedido', error);
  }
};
