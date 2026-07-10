import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { MembershipPaymentStatus, MembershipStatus, User } from './user.model';

const sendServerError = (res: Response, message: string, error: unknown): void => {
  res.status(500).json({ error: message, detail: (error as Error).message });
};

// PATCH /api/users/:id/membership
export const updateMembership = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, monthlyFee, currency, startDate, nextDueDate } = req.body;

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de usuario no válido' });
      return;
    }

    if (status && !Object.values(MembershipStatus).includes(status)) {
      res.status(400).json({ error: 'Estado de cuota no válido' });
      return;
    }

    const update: Record<string, unknown> = {};
    if (status !== undefined) update['membership.status'] = status;
    if (monthlyFee !== undefined) update['membership.monthlyFee'] = monthlyFee;
    if (currency !== undefined) update['membership.currency'] = currency;
    if (startDate !== undefined) update['membership.startDate'] = startDate;
    if (nextDueDate !== undefined) update['membership.nextDueDate'] = nextDueDate;

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'No hay campos para actualizar' });
      return;
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    sendServerError(res, 'Error actualizando cuota', error);
  }
};

// GET /api/users/:id/membership-payments
export const getMembershipPayments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de usuario no válido' });
      return;
    }

    const user = await User.findById(id).select('membershipPayments');
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(200).json(user.membershipPayments);
  } catch (error) {
    sendServerError(res, 'Error obteniendo pagos de cuota', error);
  }
};

// POST /api/users/:id/membership-payments
export const addMembershipPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de usuario no válido' });
      return;
    }

    if (status && !Object.values(MembershipPaymentStatus).includes(status)) {
      res.status(400).json({ error: 'Estado de pago no válido' });
      return;
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $push: { membershipPayments: req.body } },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(201).json(user);
  } catch (error) {
    sendServerError(res, 'Error añadiendo pago de cuota', error);
  }
};

// PATCH /api/users/:id/membership-payments/:paymentId
export const updateMembershipPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, paymentId } = req.params;
    const { period, amount, currency, status, dueDate, paidAt, paymentMethod, notes } = req.body;

    if (!isValidObjectId(id) || !isValidObjectId(paymentId)) {
      res.status(400).json({ error: 'ID no válido' });
      return;
    }

    if (status && !Object.values(MembershipPaymentStatus).includes(status)) {
      res.status(400).json({ error: 'Estado de pago no válido' });
      return;
    }

    const update: Record<string, unknown> = {};
    if (period !== undefined) update['membershipPayments.$.period'] = period;
    if (amount !== undefined) update['membershipPayments.$.amount'] = amount;
    if (currency !== undefined) update['membershipPayments.$.currency'] = currency;
    if (status !== undefined) update['membershipPayments.$.status'] = status;
    if (dueDate !== undefined) update['membershipPayments.$.dueDate'] = dueDate;
    if (paidAt !== undefined) update['membershipPayments.$.paidAt'] = paidAt;
    if (paymentMethod !== undefined) update['membershipPayments.$.paymentMethod'] = paymentMethod;
    if (notes !== undefined) update['membershipPayments.$.notes'] = notes;

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'No hay campos para actualizar' });
      return;
    }

    const user = await User.findOneAndUpdate(
      { _id: id, 'membershipPayments._id': paymentId },
      { $set: update },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({ error: 'Usuario o pago no encontrado' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    sendServerError(res, 'Error actualizando pago de cuota', error);
  }
};

// DELETE /api/users/:id/membership-payments/:paymentId
export const removeMembershipPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, paymentId } = req.params;

    if (!isValidObjectId(id) || !isValidObjectId(paymentId)) {
      res.status(400).json({ error: 'ID no válido' });
      return;
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $pull: { membershipPayments: { _id: paymentId } } },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    sendServerError(res, 'Error eliminando pago de cuota', error);
  }
};
