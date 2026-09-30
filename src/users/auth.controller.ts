import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { User, UserRole, UserStatus } from './user.model';
import {
  bloqueadoHasta,
  claveIp,
  claveUsuario,
  limpiarIntentos,
  registrarFallo,
  segundosHasta,
} from './acceso.service';
import { motivoParaRechazarUsername } from './user.service';
import { generateToken } from '../shared/token.utils';
import { esDuplicado, sendServerError } from '../shared/controller.utils';
import { esOrigenPermitido } from '../shared/cors';
import { enviarCorreoDeActivacion, enviarCorreoDeRecuperacion } from '../shared/correo';
import { generarSecreto, huellaDe } from '../shared/huella';

/** El mismo minimo que declara el esquema de User. */
const LARGO_MINIMO_CONTRASENA = 6;

/** Una hora: lo que dura el enlace del correo. */
const VIGENCIA_ENLACE_MS = 3_600_000;

/**
 * Todo lo que llega del cuerpo y acaba en un filtro de Mongo tiene que ser
 * texto. Un objeto como `{ "$ne": null }` en lugar de un token convertiria
 * "busca este token" en "busca cualquier token", y eso es entrar en la cuenta
 * de otro. Se comprueba campo a campo en cada ruta publica de este fichero.
 */
const esTexto = (valor: unknown): valor is string => typeof valor === 'string' && valor.length > 0;

/**
 * El perfil que se admite en el registro, campo a campo. Copiar el objeto tal
 * cual dejaria colar cualquier otra cosa que el esquema acepte dentro de el.
 */
const perfilDeRegistro = (entrada: unknown) => {
  const perfil = (entrada ?? {}) as Record<string, unknown>;
  return {
    firstName: perfil.firstName,
    lastName: perfil.lastName,
    phone: perfil.phone,
    addresses: perfil.addresses,
  };
};

// POST /api/users/register
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    // Solo lo que una persona puede decir de si misma al registrarse. Cliente,
    // perfil deportivo, cuota y pagos de cuota los fija el admin: antes se
    // copiaban del cuerpo, y cualquiera podia darse de alta con la cuota activa.
    const { username, email, password, profile } = req.body;

    if (!esTexto(username) || !esTexto(email) || !esTexto(password)) {
      res.status(400).json({ error: 'Usuario, email y contraseña son obligatorios' });
      return;
    }

    const motivo = motivoParaRechazarUsername(username);
    if (motivo) {
      res.status(400).json({ error: motivo });
      return;
    }

    const existingUser = await User.exists({ $or: [{ username }, { email }] });
    if (existingUser) {
      res.status(400).json({ error: 'Usuario o email ya registrado' });
      return;
    }

    const user = await new User({ username, email, password, profile: perfilDeRegistro(profile) }).save();

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    // Otro alta con el mismo correo —una compra de invitado, sin ir mas lejos—
    // puede colarse entre la comprobacion y el guardado. Es el mismo caso que la
    // comprobacion de arriba, no un fallo del servidor.
    if (esDuplicado(error)) {
      res.status(400).json({ error: 'Usuario o email ya registrado' });
      return;
    }
    sendServerError(res, 'Error en el registro', error);
  }
};

// POST /api/users/login
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    if (!esTexto(username) || !esTexto(password)) {
      res.status(400).json({ error: 'Usuario y contraseña requeridos' });
      return;
    }

    const claves = [claveUsuario(username), claveIp(req.ip ?? 'desconocida')];

    const bloqueo = await bloqueadoHasta(claves);
    if (bloqueo) {
      res.set('Retry-After', String(segundosHasta(bloqueo)));
      res.status(429).json({ error: 'Demasiados intentos fallidos. Inténtalo de nuevo más tarde' });
      return;
    }

    const user = await User.findOne({ username: username.toLowerCase().trim() }).select('+password');

    // Una ficha de invitado no tiene contrasena y no puede entrar. Se responde
    // igual que a un usuario inexistente: distinguirlo diria que ese correo ha
    // comprado en la tienda. Y hay que cortar antes de bcrypt, que con un hash
    // ausente lanza en vez de devolver false.
    if (!user || user.role === UserRole.INVITADO || !user.password) {
      await registrarFallo(claves);
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password);
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
      id: user._id.toString(),
      username: user.username,
      rol: user.role,
    });

    res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          status: user.status,
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
// Sirve tambien para convertir en cuenta la ficha de quien compro sin ella: es
// el mismo tramite —demostrar que el correo es tuyo y elegir contrasena—, solo
// cambia el texto del correo.
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  // La respuesta es siempre la misma: decir si el correo existe convertiria
  // este endpoint en un censo de usuarios registrados.
  const respuestaNeutra = {
    success: true,
    message: 'Si el correo existe, recibirás un enlace de recuperación',
  };

  try {
    const { email } = req.body;

    if (!esTexto(email)) {
      res.status(200).json(respuestaNeutra);
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      res.status(200).json(respuestaNeutra);
      return;
    }

    const base = baseDelFrontend(req);
    if (!base) {
      console.error(`Recuperacion sin enlace para ${email}: origen no permitido o ausente.`);
      res.status(200).json(respuestaNeutra);
      return;
    }

    // Se guarda la huella del token, no el token: quien lea la base de datos no
    // puede usarlo. Y con `updateOne`, no con `save`: guardar el documento
    // entero lo validaria entero, y una ficha de invitado —o una cuenta que el
    // admin creo sin contrasena— lo suspenderia por algo que no tiene nada que
    // ver con pedir un enlace.
    const { secreto, huella } = generarSecreto();
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          'metadata.resetPasswordToken': huella,
          'metadata.resetPasswordExpires': new Date(Date.now() + VIGENCIA_ENLACE_MS),
        },
      },
    );

    // Si el correo no sale queda registrado en el log del servidor, pero al
    // cliente se le responde igual: no puede saber si el fallo fue suyo.
    const enlace = `${base}/recuperar?token=${secreto}`;
    if (user.role === UserRole.INVITADO) {
      await enviarCorreoDeActivacion(user.email, enlace);
    } else {
      await enviarCorreoDeRecuperacion(user.email, enlace);
    }

    res.status(200).json(respuestaNeutra);
  } catch (error) {
    sendServerError(res, 'Error procesando solicitud', error);
  }
};

// POST /api/users/reset-password
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = req.body;

    if (!esTexto(token) || !newPassword) {
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
      'metadata.resetPasswordToken': huellaDe(token),
      'metadata.resetPasswordExpires': { $gt: new Date() },
    }).select('+metadata.resetPasswordToken +metadata.resetPasswordExpires +password');

    if (!user) {
      res.status(400).json({ error: 'Token inválido o expirado' });
      return;
    }

    // Abrir el enlace es lo primero que demuestra que el correo de una ficha de
    // invitado es de quien lo usa. Hasta ahora cualquiera pudo comprar
    // escribiendolo, asi que la cuenta que nace aqui no hereda las direcciones
    // que se acumularon en la ficha: podrian ser de otra persona. Sus pedidos
    // tampoco pasan a verse con la sesion; esos siguen abriendose con su clave.
    const eraInvitado = user.role === UserRole.INVITADO;
    if (eraInvitado) {
      user.role = UserRole.USER;
      // Un bloqueo del admin sobrevive a la conversion: si no, bastaria con
      // controlar el correo de una ficha bloqueada para salir del bloqueo.
      if (user.status !== UserStatus.BANNED) user.status = UserStatus.ACTIVE;
      user.profile.addresses = [];
      user.metadata.emailVerified = true;

      // Se entra con el usuario, y el correo le dice que su usuario es el
      // correo. Casi siempre ya lo es; si la ficha tuvo que tomar otro porque
      // una cuenta antigua se llamaba asi, se intenta ahora, y si sigue ocupado
      // se le dice cual es en la respuesta.
      if (user.username !== user.email && !(await User.exists({ username: user.email }))) {
        user.username = user.email;
      }
    }

    user.password = newPassword;
    user.metadata.resetPasswordToken = undefined;
    user.metadata.resetPasswordExpires = undefined;
    await user.save();

    const mensajeCuenta =
      user.username === user.email
        ? 'Cuenta creada. Ya puedes entrar con tu correo y la contraseña que has elegido'
        : `Cuenta creada. Tu usuario para entrar es «${user.username}»`;

    res.status(200).json({
      success: true,
      message: eraInvitado ? mensajeCuenta : 'Contraseña restablecida correctamente',
    });
  } catch (error) {
    sendServerError(res, 'Error restableciendo contraseña', error);
  }
};
