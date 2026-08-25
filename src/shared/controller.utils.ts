import { Request, Response } from 'express';
import { UserRole } from '../users/user.model';

export const sendServerError = (res: Response, message: string, error: unknown): void => {
  res.status(500).json({ error: message, detail: (error as Error).message });
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
