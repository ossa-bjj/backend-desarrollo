import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { Order, OrderStatus } from './order.model';
import { UserRole } from '../users/user.model';

const sendServerError = (res: Response, message: string, error: unknown): void => {
  res.status(500).json({ error: message, detail: (error as Error).message });
};

const isAdmin = (req: Request): boolean => req.user?.rol === UserRole.ADMIN;

const canAccessOrder = (req: Request, userId: unknown): boolean =>
  isAdmin(req) || String((userId as { _id?: unknown })?._id ?? userId) === req.user?.id;

// GET /api/pedidos
export const getOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const filter = isAdmin(req) ? {} : { user: req.user!.id };
    const orders = await Order.find(filter).sort({ createdAt: -1 }).populate('user', 'username email');

    res.status(200).json({ success: true, data: orders });
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

    if (!canAccessOrder(req, order.user)) {
      res.status(403).json({ error: 'No tenés permisos para ver este pedido' });
      return;
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    sendServerError(res, 'Error obteniendo pedido', error);
  }
};

// POST /api/pedidos
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { items, total, shippingAddress, user } = req.body;
    const userId = isAdmin(req) && user ? user : req.user!.id;

    const order = await new Order({
      user: userId,
      items,
      total,
      shippingAddress,
      status: OrderStatus.PENDIENTE,
    }).save();

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    sendServerError(res, 'Error creando pedido', error);
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

    res.status(200).json({ success: true, message: 'Pedido eliminado' });
  } catch (error) {
    sendServerError(res, 'Error eliminando pedido', error);
  }
};
