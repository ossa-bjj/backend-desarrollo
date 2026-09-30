import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import type { IUser } from './user.model';
import { User, UserRole, UserStatus } from './user.model';
import { leerCriteriosUsuario, listarUsuarios, motivoParaRechazarUsername } from './user.service';
import {
  sendServerError,
  esAdmin,
  esDuenoOAdmin,
  esDuplicado,
  leerObjectId,
} from '../shared/controller.utils';

/**
 * Las fichas de invitado solo nacen de una compra sin cuenta y solo dejan de
 * serlo cuando su dueño demuestra que el correo es suyo. Cambiar el rol a mano
 * saltaria esa prueba en las dos direcciones: convertiria en cuenta la ficha de
 * cualquiera, o dejaria sin acceso a una cuenta de verdad.
 */
const RECHAZO_ROL_INVITADO =
  'El rol de invitado no se asigna ni se quita a mano: la persona crea su cuenta con «¿Olvidaste tu contraseña?» y su correo.';

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

    // Texto, y no otra cosa: acaban en un filtro de Mongo.
    if (typeof username !== 'string' || typeof email !== 'string') {
      res.status(400).json({ error: 'Usuario y email son obligatorios' });
      return;
    }

    const motivo = motivoParaRechazarUsername(username);
    if (motivo) {
      res.status(400).json({ error: motivo });
      return;
    }

    if (role && !Object.values(UserRole).includes(role)) {
      res.status(400).json({ error: 'Rol no válido' });
      return;
    }

    // Una ficha de invitado nace de una compra sin cuenta, con su correo como
    // usuario y sin contrasena. Hecha a mano no cumpliria ninguna de las dos.
    if (role === UserRole.INVITADO) {
      res.status(400).json({ error: RECHAZO_ROL_INVITADO });
      return;
    }

    if (status && !Object.values(UserStatus).includes(status)) {
      res.status(400).json({ error: 'Estado no válido' });
      return;
    }

    const existingUser = await User.exists({ $or: [{ username }, { email }] });
    if (existingUser) {
      res.status(400).json({ error: 'Usuario o email ya registrado' });
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
    if (esDuplicado(error)) {
      res.status(400).json({ error: 'Usuario o email ya registrado' });
      return;
    }
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

    if (!leerObjectId(res, id, 'usuario')) return;

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

    if (!leerObjectId(res, id, 'usuario')) return;

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

    // Texto, y no otra cosa: acaban en un filtro de Mongo.
    if (
      (username !== undefined && typeof username !== 'string') ||
      (email !== undefined && typeof email !== 'string')
    ) {
      res.status(400).json({ error: 'Usuario y email deben ser texto' });
      return;
    }

    const actual = await User.findById(id).select('role username email');
    if (!actual) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    const esFicha = actual.role === UserRole.INVITADO;

    if (role !== undefined && role !== actual.role && (esFicha || role === UserRole.INVITADO)) {
      res.status(400).json({ error: RECHAZO_ROL_INVITADO });
      return;
    }

    // En una ficha el usuario ES el correo: se mueven juntos. Si se separaran,
    // comprar con el correo viejo chocaria con la ficha por el usuario y diria
    // que ese correo "ya tiene cuenta" sin tenerla.
    const emailNuevo = email?.toLowerCase().trim();
    let usernameNuevo = username?.toLowerCase().trim();
    if (esFicha) {
      const correoFinal = emailNuevo ?? actual.email;
      if (usernameNuevo !== undefined && usernameNuevo !== actual.username && usernameNuevo !== correoFinal) {
        res.status(400).json({ error: 'En una ficha de invitado el usuario es su correo' });
        return;
      }
      // El usuario solo se toca si cambia el correo, y entonces lo sigue.
      usernameNuevo = correoFinal !== actual.email ? correoFinal : undefined;
    } else if (usernameNuevo !== undefined) {
      const motivo = motivoParaRechazarUsername(usernameNuevo, actual.username);
      if (motivo) {
        res.status(400).json({ error: motivo });
        return;
      }
    }

    const update: Partial<IUser> = {};
    if (usernameNuevo !== undefined) update.username = usernameNuevo;
    if (emailNuevo !== undefined) update.email = emailNuevo;
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

    if (update.username || update.email) {
      const existingUser = await User.exists({
        _id: { $ne: id },
        $or: [
          ...(update.username ? [{ username: update.username }] : []),
          ...(update.email ? [{ email: update.email }] : []),
        ],
      });

      if (existingUser) {
        res.status(400).json({ error: 'Usuario o email ya registrado por otro usuario' });
        return;
      }
    }

    const user = await User.findByIdAndUpdate(id, update, { new: true, runValidators: true }).select(
      '-password',
    );

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    if (esDuplicado(error)) {
      res.status(400).json({ error: 'Usuario o email ya registrado por otro usuario' });
      return;
    }
    sendServerError(res, 'Error actualizando usuario', error);
  }
};

// DELETE /api/users/:id
export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!leerObjectId(res, id, 'usuario')) return;

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

    if (!leerObjectId(res, id, 'usuario')) return;

    if (!esDuenoOAdmin(req, id)) {
      res.status(403).json({ error: 'No tienes permisos para cambiar esta contraseña' });
      return;
    }

    if (!newPassword) {
      res.status(400).json({ error: 'La nueva contraseña es requerida' });
      return;
    }

    // Las dos, texto: bcrypt lanza con cualquier otra cosa y saldria un 500.
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      return;
    }
    if (currentPassword !== undefined && typeof currentPassword !== 'string') {
      res.status(400).json({ error: 'La contraseña actual debe ser texto' });
      return;
    }

    const user = await User.findById(id).select('+password');
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    // Ni un admin pone contrasena a una ficha de invitado: seria crear la cuenta
    // de alguien sin que haya demostrado que el correo es suyo.
    if (user.role === UserRole.INVITADO) {
      res.status(400).json({ error: RECHAZO_ROL_INVITADO });
      return;
    }

    if (!esAdmin(req)) {
      if (!currentPassword) {
        res.status(400).json({ error: 'La contraseña actual es requerida' });
        return;
      }

      // Sin hash guardado —una ficha de invitado— bcrypt lanzaria y saldria un
      // 500. No hay contrasena actual que pueda coincidir.
      const valid = user.password ? await bcrypt.compare(currentPassword, user.password) : false;
      // 400 y no 401: la sesion es buena, lo que falla es un dato del
      // formulario. Con un 401 el frontend cerraba la sesion de quien solo se
      // habia equivocado al escribir su contrasena actual.
      if (!valid) {
        res.status(400).json({ error: 'Contraseña actual incorrecta' });
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

    if (!leerObjectId(res, id, 'usuario')) return;

    if (!Object.values(UserStatus).includes(status)) {
      res.status(400).json({ error: 'Estado no válido' });
      return;
    }

    const user = await User.findByIdAndUpdate(id, { status }, { new: true, runValidators: true }).select(
      '-password',
    );

    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    sendServerError(res, 'Error actualizando estado', error);
  }
};
