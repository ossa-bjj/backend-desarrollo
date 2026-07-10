import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { CustomerOrigin, User, UserRole } from './user.model';

const sendServerError = (res: Response, message: string, error: unknown): void => {
  res.status(500).json({ error: message, detail: (error as Error).message });
};

const isOwnerOrAdmin = (req: Request, userId: string | string[]): boolean =>
  typeof userId === 'string' && (req.user?.id === userId || req.user?.rol === UserRole.ADMIN);

// PATCH /api/users/:id/customer
export const updateCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { isCustomer, origin, since } = req.body;

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de usuario no válido' });
      return;
    }

    if (origin && !Object.values(CustomerOrigin).includes(origin)) {
      res.status(400).json({ error: 'Origen no válido' });
      return;
    }

    const update: Record<string, unknown> = {};
    if (isCustomer !== undefined) update['customer.isCustomer'] = isCustomer;
    if (origin !== undefined) update['customer.origin'] = origin;
    if (since !== undefined) update['customer.since'] = since;

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
    sendServerError(res, 'Error actualizando datos de cliente', error);
  }
};

// PATCH /api/users/:id/sports-profile
export const updateSportsProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { isAthlete, isFederated, licenseNumber, federationName, clubName } = req.body;

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de usuario no válido' });
      return;
    }

    const update: Record<string, unknown> = {};
    if (isAthlete !== undefined) update['sportsProfile.isAthlete'] = isAthlete;
    if (isFederated !== undefined) update['sportsProfile.isFederated'] = isFederated;
    if (licenseNumber !== undefined) update['sportsProfile.licenseNumber'] = licenseNumber;
    if (federationName !== undefined) update['sportsProfile.federationName'] = federationName;
    if (clubName !== undefined) update['sportsProfile.clubName'] = clubName;

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
    sendServerError(res, 'Error actualizando perfil deportivo', error);
  }
};

// DELETE /api/users/:id/sports-profile
export const removeSportsProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de usuario no válido' });
      return;
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $unset: { sportsProfile: '' } },
      { new: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    sendServerError(res, 'Error eliminando perfil deportivo', error);
  }
};

// POST /api/users/:id/addresses
export const addAddress = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de usuario no válido' });
      return;
    }

    if (!isOwnerOrAdmin(req, id)) {
      res.status(403).json({ error: 'No tenés permisos para añadir direcciones a este usuario' });
      return;
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $push: { 'profile.addresses': req.body } },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(201).json(user);
  } catch (error) {
    sendServerError(res, 'Error añadiendo dirección', error);
  }
};

// PATCH /api/users/:id/addresses/:addressId
export const updateAddress = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, addressId } = req.params;
    const { calle, ciudad, provincia, codigoPostal, pais, esPredeterminada } = req.body;

    if (!isValidObjectId(id) || !isValidObjectId(addressId)) {
      res.status(400).json({ error: 'ID no válido' });
      return;
    }

    if (!isOwnerOrAdmin(req, id)) {
      res.status(403).json({ error: 'No tenés permisos para actualizar direcciones de este usuario' });
      return;
    }

    const update: Record<string, unknown> = {};
    if (calle !== undefined) update['profile.addresses.$.calle'] = calle;
    if (ciudad !== undefined) update['profile.addresses.$.ciudad'] = ciudad;
    if (provincia !== undefined) update['profile.addresses.$.provincia'] = provincia;
    if (codigoPostal !== undefined) update['profile.addresses.$.codigoPostal'] = codigoPostal;
    if (pais !== undefined) update['profile.addresses.$.pais'] = pais;
    if (esPredeterminada !== undefined) update['profile.addresses.$.esPredeterminada'] = esPredeterminada;

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'No hay campos para actualizar' });
      return;
    }

    const user = await User.findOneAndUpdate(
      { _id: id, 'profile.addresses._id': addressId },
      { $set: update },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({ error: 'Usuario o dirección no encontrada' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    sendServerError(res, 'Error actualizando dirección', error);
  }
};

// DELETE /api/users/:id/addresses/:addressId
export const removeAddress = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, addressId } = req.params;

    if (!isValidObjectId(id) || !isValidObjectId(addressId)) {
      res.status(400).json({ error: 'ID no válido' });
      return;
    }

    if (!isOwnerOrAdmin(req, id)) {
      res.status(403).json({ error: 'No tenés permisos para eliminar direcciones de este usuario' });
      return;
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $pull: { 'profile.addresses': { _id: addressId } } },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    sendServerError(res, 'Error eliminando dirección', error);
  }
};
