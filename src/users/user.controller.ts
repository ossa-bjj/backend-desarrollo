import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import bcrypt from 'bcryptjs';
import { IUser, User, UserRole, UserStatus } from './user.model';
import { leerCriteriosUsuario, listarUsuarios } from './user.service';
import { sendServerError, esAdmin, esDuenoOAdmin } from '../shared/controller.utils';

// POST /api/users
export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      username,
      email,
      password,
      role,
      status,
      profile,
      customer,
      sportsProfile,
      membership,
      membershipPayments,
      metadata,
    } = req.body;

    const existingUser = await User.exists({ $or: [{ username }, { email }] });
    if (existingUser) {
      res.status(400).json({ error: 'Usuario o email ya registrado' });
      return;
    }

    if (role && !Object.values(UserRole).includes(role)) {
      res.status(400).json({ error: 'Rol no válido' });
      return;
    }

    if (status && !Object.values(UserStatus).includes(status)) {
      res.status(400).json({ error: 'Estado no válido' });
      return;
    }

    const user = await new User({
      username,
      email,
      password,
      role,
      status,
      profile,
      customer,
      sportsProfile,
      membership,
      membershipPayments,
      metadata,
    }).save();

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    sendServerError(res, 'Error creando usuario', error);
  }
};

// GET /api/users?q=&username=&email=&role=&status=&customer=&license=&pagina=&limite=
export const buscarUsuarios = async (req: Request, res: Response): Promise<void> => {
  try {
    const lectura = leerCriteriosUsuario(req.query);
    if (!lectura.ok) {
      res.status(400).json({ error: lectura.error });
      return;
    }

    const { usuarios, total, pagina, limite } = await listarUsuarios(lectura.criterios);

    res.status(200).json({ success: true, data: usuarios, meta: { total, pagina, limite } });
  } catch (error) {
    sendServerError(res, 'Error obteniendo usuarios', error);
  }
};

// GET /api/users/:id
export const getUserById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de usuario no válido' });
      return;
    }

    const user = await User.findById(id).select('-password');
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    sendServerError(res, 'Error obteniendo usuario', error);
  }
};

// PUT /api/users/:id
export const updateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const {
      username,
      email,
      role,
      status,
      profile,
      customer,
      sportsProfile,
      membership,
      membershipPayments,
      metadata,
    } = req.body;

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de usuario no válido' });
      return;
    }

    if (!esDuenoOAdmin(req, id)) {
      res.status(403).json({ error: 'No tienes permisos para actualizar este usuario' });
      return;
    }

    const isAdminRequest = esAdmin(req);
    const hasAdminFields =
      role !== undefined ||
      status !== undefined ||
      membership !== undefined ||
      membershipPayments !== undefined ||
      metadata !== undefined;

    if (!isAdminRequest && hasAdminFields) {
      res.status(403).json({ error: 'No tienes permisos para actualizar campos administrativos' });
      return;
    }

    if (role && !Object.values(UserRole).includes(role)) {
      res.status(400).json({ error: 'Rol no válido' });
      return;
    }

    if (status && !Object.values(UserStatus).includes(status)) {
      res.status(400).json({ error: 'Estado no válido' });
      return;
    }

    const update: Partial<IUser> = {};
    if (username !== undefined) update.username = username;
    if (email !== undefined) update.email = email;
    if (role !== undefined) update.role = role;
    if (status !== undefined) update.status = status;
    if (profile !== undefined) update.profile = profile;
    if (customer !== undefined) update.customer = customer;
    if (sportsProfile !== undefined) update.sportsProfile = sportsProfile;
    if (membership !== undefined) update.membership = membership;
    if (membershipPayments !== undefined) update.membershipPayments = membershipPayments;
    if (metadata !== undefined) update.metadata = metadata;

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'No hay campos para actualizar' });
      return;
    }

    if (username || email) {
      const existingUser = await User.exists({
        _id: { $ne: id },
        $or: [
          ...(username ? [{ username }] : []),
          ...(email ? [{ email }] : []),
        ],
      });

      if (existingUser) {
        res.status(400).json({ error: 'Usuario o email ya registrado por otro usuario' });
        return;
      }
    }

    const user = await User.findByIdAndUpdate(
      id,
      update,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    sendServerError(res, 'Error actualizando usuario', error);
  }
};

// DELETE /api/users/:id
export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de usuario no válido' });
      return;
    }

    const user = await User.findByIdAndDelete(id);
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(200).json({ success: true, message: 'Usuario eliminado' });
  } catch (error) {
    sendServerError(res, 'Error eliminando usuario', error);
  }
};

// PATCH /api/users/:id/password
export const updatePassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { currentPassword, newPassword } = req.body;

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de usuario no válido' });
      return;
    }

    if (!esDuenoOAdmin(req, id)) {
      res.status(403).json({ error: 'No tienes permisos para cambiar esta contraseña' });
      return;
    }

    if (!newPassword) {
      res.status(400).json({ error: 'La nueva contraseña es requerida' });
      return;
    }

    const user = await User.findById(id).select('+password');
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    if (!esAdmin(req)) {
      if (!currentPassword) {
        res.status(400).json({ error: 'La contraseña actual es requerida' });
        return;
      }

      const valid = await bcrypt.compare(currentPassword, user.password!);
      if (!valid) {
        res.status(401).json({ error: 'Contraseña actual incorrecta' });
        return;
      }
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    sendServerError(res, 'Error actualizando contraseña', error);
  }
};

// PATCH /api/users/:id/status
export const updateStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de usuario no válido' });
      return;
    }

    if (!Object.values(UserStatus).includes(status)) {
      res.status(400).json({ error: 'Estado no válido' });
      return;
    }

    const user = await User.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    sendServerError(res, 'Error actualizando estado', error);
  }
};
