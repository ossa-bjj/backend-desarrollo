import { Request, Response } from 'express';
import { UserRole } from '../users/user.model';
// Carga la declaracion global de Express.Request.user (definida en token.utils).
// Sin ella, quien compile este fichero por separado —ts-node-dev lo hace en cada
// recarga— no conoce `req.user` y el arranque falla aunque `tsc` pase.
import './token.utils';

/**
 * Respuesta unica para un fallo no previsto.
 *
 * El detalle se registra en el servidor y no viaja al cliente: los mensajes de
 * Mongoose y de los drivers nombran colecciones, campos, indices y rutas de
 * fichero, y eso es un mapa gratis de la aplicacion para quien la esta
 * sondeando. Quien llama recibe que fallo, no por que.
 */
export const sendServerError = (res: Response, message: string, error: unknown): void => {
  console.error(`${message}:`, error);
  res.status(500).json({ error: message });
};

/**
 * Normaliza la referencia a un usuario, venga como viene en cada controlador:
 * un id suelto, un ObjectId, o un documento ya populado (`{ _id, username... }`).
 * Devuelve undefined si no hay forma de sacar un id comparable.
 */
const idDeUsuario = (usuario: unknown): string | undefined => {
  if (usuario === null || usuario === undefined) return undefined;
  if (typeof usuario === 'string') return usuario;
  if (Array.isArray(usuario)) return undefined;

  if (typeof usuario === 'object') {
    const propio = (usuario as { _id?: unknown })._id;
    if (propio !== undefined && propio !== null) return String(propio);
  }

  return String(usuario);
};

export const esAdmin = (req: Request): boolean => req.user?.rol === UserRole.ADMIN;

/**
 * Unica implementacion de la regla de acceso del proyecto: pasa el admin, y
 * pasa el dueno del recurso. `usuario` admite id, ObjectId o documento populado.
 */
export const esDuenoOAdmin = (req: Request, usuario: unknown): boolean => {
  if (esAdmin(req)) return true;

  const id = idDeUsuario(usuario);
  return id !== undefined && id === req.user?.id;
};
