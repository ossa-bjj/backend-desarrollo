import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from './token.utils';
import { User, UserStatus } from '../users/user.model';

/**
 * Si la cuenta del token esta bloqueada.
 *
 * El token dura ocho horas y el login ya no deja entrar a una cuenta bloqueada,
 * pero quien ya tenia sesion seguia operando hasta que caducara: bloquear a
 * alguien por fraude no le cortaba nada. Se mira en cada peticion protegida;
 * es una consulta por clave primaria, de las mas baratas que hay.
 *
 * Una cuenta que ya no existe no se trata aqui: cada ruta decide que hacer con
 * un usuario que no encuentra.
 */
const cuentaBloqueada = (id: string): Promise<boolean> =>
  User.exists({ _id: id, status: UserStatus.BANNED }).then(Boolean);

// --- IS AUTH ---
export const isAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'Token requerido' });
    return;
  }

  try {
    req.user = verifyToken(token);
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
    return;
  }

  try {
    // 401 y no 403: la sesion deja de valer, y el frontend cierra la sesion
    // con cualquier 401. Al volver a entrar, el login dice que esta bloqueada.
    if (await cuentaBloqueada(req.user.id)) {
      res.status(401).json({ error: 'Esta cuenta está bloqueada' });
      return;
    }
  } catch (error) {
    next(error);
    return;
  }

  next();
};

// --- IS ADMIN ---
export const isAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user?.rol !== 'admin') {
    res.status(403).json({ error: 'Solo administradores' });
    return;
  }
  next();
};

// --- OPTIONAL AUTH ---
// Para rutas publicas que ademas ofrecen una vista ampliada al admin.
// Si llega un token valido rellena req.user; si no llega, o es invalido,
// o la cuenta esta bloqueada, deja pasar la peticion como anonima en lugar de
// responder 401.
export const optionalAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    next();
    return;
  }

  try {
    const usuario = verifyToken(token);
    if (!(await cuentaBloqueada(usuario.id))) req.user = usuario;
  } catch {
    /* token invalido o fallo al comprobarlo: se sigue tratando como anonimo */
  }
  next();
};
