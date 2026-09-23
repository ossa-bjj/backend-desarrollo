/**
 * Pedidos y productos de prueba, con lo mínimo que exige cada esquema.
 *
 * Los modelos se importan de forma dinámica: al importarlos se registran en
 * mongoose, y eso debe pasar cuando el entorno de pruebas ya está montado.
 */

import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import type { IOrder, IOrderItem } from '../../src/orders/order.model';
import { OrderItemTipo, OrderStatus } from '../../src/orders/order.model';

export type PedidoDePrueba = HydratedDocument<IOrder>;

export const lineaDeProducto = (opciones: Partial<IOrderItem> = {}): IOrderItem => ({
  codigoArticulo: 1011,
  name: 'Rashguard de pruebas',
  quantity: 1,
  price: 50,
  tipo: OrderItemTipo.PRODUCTO,
  precioOriginal: 50,
  talla: 'M',
  ...opciones,
});

export const lineaDeServicio = (opciones: Partial<IOrderItem> = {}): IOrderItem => ({
  codigoArticulo: 6001,
  name: 'Clase privada de pruebas',
  quantity: 1,
  price: 60,
  tipo: OrderItemTipo.SERVICIO,
  precioOriginal: 60,
  ...opciones,
});

/** Pedido pendiente de pago, que es el estado en el que llega un webhook. */
export const crearPedido = async (
  opciones: {
    estado?: OrderStatus;
    items?: IOrderItem[];
    total?: number;
    pago?: IOrder['pago'];
    /** Dueño del pedido. Importa en todo lo que pasa por `isAuth`. */
    user?: Types.ObjectId;
  } = {},
): Promise<PedidoDePrueba> => {
  const { Order } = await import('../../src/orders/order.model');
  const items = opciones.items ?? [lineaDeProducto()];

  return Order.create({
    user: opciones.user ?? new Types.ObjectId(),
    items,
    total: opciones.total ?? items.reduce((suma, item) => suma + item.price * item.quantity, 0),
    status: opciones.estado ?? OrderStatus.PENDIENTE,
    pago: opciones.pago,
  });
};

/** Vuelve a leer el pedido de la base de datos, sin caché de mongoose. */
export const releerPedido = async (id: Types.ObjectId | string): Promise<PedidoDePrueba> => {
  const { Order } = await import('../../src/orders/order.model');
  const pedido = await Order.findById(id);
  if (!pedido) throw new Error(`El pedido ${String(id)} ya no existe`);
  return pedido;
};

/** Producto con existencias por talla, para comprobar el descuento de stock. */
export const crearProducto = async (
  opciones: { codigoArticulo?: number; tallas?: Array<{ talla: string; stock: number }> } = {},
) => {
  const { ProductoModelo, Categoria } = await import('../../src/products/producto.model');

  return ProductoModelo.create({
    codigoArticulo: opciones.codigoArticulo ?? 1011,
    name: 'Rashguard de pruebas',
    price: 50,
    description: 'Prenda de prueba para los tests del webhook',
    category: Categoria.ROPA_ENTRENAMIENTO,
    subcategoria: 'Rashguards',
    tallas: opciones.tallas ?? [{ talla: 'M', stock: 3 }],
  });
};

export const stockDeTalla = async (codigoArticulo: number, talla: string): Promise<number> => {
  const { ProductoModelo } = await import('../../src/products/producto.model');
  const producto = await ProductoModelo.findOne({ codigoArticulo });
  if (!producto) throw new Error(`No existe el producto ${codigoArticulo}`);
  return producto.tallas.find((entrada) => entrada.talla === talla)?.stock ?? 0;
};
