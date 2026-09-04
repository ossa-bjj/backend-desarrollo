import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User, UserStatus } from './user.model';
import {
  bloqueadoHasta,
  claveIp,
  claveUsuario,
  limpiarIntentos,
  registrarFallo,
  segundosHasta,
} from './acceso.service';
import { generateToken } from '../shared/token.utils';
import { sendServerError } from '../shared/controller.utils';
import { esOrigenPermitido } from '../shared/cors';
import { enviarCorreoDeRecuperacion } from '../shared/correo';

/** El mismo minimo que declara el esquema de User. */
const LARGO_MINIMO_CONTRASENA = 6;

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

    res.status(201).json({ success: true, data: user });
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

    const claves = [claveUsuario(String(username)), claveIp(req.ip ?? 'desconocida')];

    const bloqueo = await bloqueadoHasta(claves);
    if (bloqueo) {
      res.set('Retry-After', String(segundosHasta(bloqueo)));
      res.status(429).json({ error: 'Demasiados intentos fallidos. Inténtalo de nuevo más tarde' });
      return;
    }

    const user = await User.findOne({ username: String(username).toLowerCase().trim() }).select('+password');
    if (!user) {
      await registrarFallo(claves);
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password!);
    if (!valid) {
      await registrarFallo(claves);
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    // Un usuario baneado no entra. Comprobarlo solo al usar cada ruta llegaba
    // tarde: el token ya estaba emitido y valia ocho horas.
    if (user.status === UserStatus.BANNED) {
      res.status(403).json({ error: 'Esta cuenta está bloqueada' });
      return;
    }

    await limpiarIntentos(claves);

    user.metadata.lastLogin = new Date();
    await user.save();

    const token = generateToken({
      id:       user._id.toString(),
      username: user.username,
      rol:      user.role,
    });

    res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id:       user._id,
          username: user.username,
          email:    user.email,
          role:     user.role,
          status:   user.status,
        },
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

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    sendServerError(res, 'Error obteniendo usuario', error);
  }
};

/**
 * Base del enlace de recuperacion.
 *
 * Sale del `Origin` de quien pide, validado contra la misma lista que gobierna
 * CORS: sin esa comprobacion, una peticion desde fuera podria hacer que el
 * correo llevase a un dominio ajeno con un token valido dentro.
 */
const baseDelFrontend = (req: Request): string | null => {
  const origen = req.headers.origin;
  return origen && esOrigenPermitido(origen) ? origen.replace(/\/+$/, '') : null;
};

// POST /api/users/forgot-password
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  // La respuesta es siempre la misma: decir si el correo existe convertiria
  // este endpoint en un censo de usuarios registrados.
  const respuestaNeutra = {
    success: true,
    message: 'Si el correo existe, recibirás un enlace de recuperación',
  };

  try {
    const { email } = req.body;

    const user = await User.findOne({ email }).select('+metadata.resetPasswordToken +metadata.resetPasswordExpires');
    if (!user) {
      res.status(200).json(respuestaNeutra);
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    user.metadata.resetPasswordToken   = token;
    user.metadata.resetPasswordExpires = new Date(Date.now() + 3_600_000);
    await user.save();

    const base = baseDelFrontend(req);
    if (!base) {
      console.error(`Recuperacion sin enlace para ${email}: origen no permitido o ausente.`);
      res.status(200).json(respuestaNeutra);
      return;
    }

    // Si el correo no sale queda registrado en el log del servidor, pero al
    // cliente se le responde igual: no puede saber si el fallo fue suyo.
    await enviarCorreoDeRecuperacion(user.email, `${base}/recuperar?token=${token}`);

    res.status(200).json(respuestaNeutra);
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

    // El modelo ya exige este minimo, pero su ValidationError sale por el
    // manejador generico como un 500: culpar al servidor de una contrasena
    // corta manda a buscar la averia donde no esta.
    if (typeof newPassword !== 'string' || newPassword.length < LARGO_MINIMO_CONTRASENA) {
      res.status(400).json({
        error: `La contraseña debe tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres`,
      });
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

    res.status(200).json({ success: true, message: 'Contraseña restablecida correctamente' });
  } catch (error) {
    sendServerError(res, 'Error restableciendo contraseña', error);
  }
};
