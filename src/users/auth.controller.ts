import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User } from './user.model';
import { generateToken } from '../shared/token.utils';

const sendServerError = (res: Response, message: string, error: unknown): void => {
  res.status(500).json({ error: message, detail: (error as Error).message });
};

// POST /api/users/register
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password, profile, customer, sportsProfile, membership, membershipPayments } = req.body;

    const existingUser = await User.exists({ $or: [{ username }, { email }] });
    if (existingUser) {
      res.status(400).json({ error: 'Usuario o email ya registrado' });
      return;
    }

    const user = await new User({
      username,
      email,
      password,
      profile,
      customer,
      sportsProfile,
      membership,
      membershipPayments,
    }).save();

    res.status(201).json(user);
  } catch (error) {
    sendServerError(res, 'Error en el registro', error);
  }
};

// POST /api/users/login
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Usuario y contraseña requeridos' });
      return;
    }

    const user = await User.findOne({ username: String(username).toLowerCase().trim() }).select('+password');
    if (!user) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password!);
    if (!valid) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    user.metadata.lastLogin = new Date();
    await user.save();

    const token = generateToken({
      id:       user._id.toString(),
      username: user.username,
      rol:      user.role,
    });

    res.status(200).json({
      token,
      user: {
        id:       user._id,
        username: user.username,
        email:    user.email,
        role:     user.role,
        status:   user.status,
      },
    });
  } catch (error) {
    sendServerError(res, 'Error en el login', error);
  }
};

// GET /api/users/me
export const me = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user!.id).select('-password');
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }

    res.status(200).json(user);
  } catch (error) {
    sendServerError(res, 'Error obteniendo usuario', error);
  }
};

// POST /api/users/forgot-password
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email }).select('+metadata.resetPasswordToken +metadata.resetPasswordExpires');
    if (!user) {
      res.status(200).json({ message: 'Si el correo existe, recibirás un enlace de recuperación' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    user.metadata.resetPasswordToken   = token;
    user.metadata.resetPasswordExpires = new Date(Date.now() + 3_600_000);
    await user.save();

    // TODO: enviar email real con el token.
    res.status(200).json({ message: 'Si el correo existe, recibirás un enlace de recuperación' });
  } catch (error) {
    sendServerError(res, 'Error procesando solicitud', error);
  }
};

// POST /api/users/reset-password
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      res.status(400).json({ error: 'Token y nueva contraseña requeridos' });
      return;
    }

    const user = await User.findOne({
      'metadata.resetPasswordToken':   token,
      'metadata.resetPasswordExpires': { $gt: new Date() },
    }).select('+metadata.resetPasswordToken +metadata.resetPasswordExpires +password');

    if (!user) {
      res.status(400).json({ error: 'Token inválido o expirado' });
      return;
    }

    user.password                      = newPassword;
    user.metadata.resetPasswordToken   = undefined;
    user.metadata.resetPasswordExpires = undefined;
    await user.save();

    res.status(200).json({ message: 'Contraseña restablecida correctamente' });
  } catch (error) {
    sendServerError(res, 'Error restableciendo contraseña', error);
  }
};
