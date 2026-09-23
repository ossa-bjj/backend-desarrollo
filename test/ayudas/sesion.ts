/**
 * Sesiones de prueba. El token se firma con el mismo `generateToken` que usa el
 * login, no a mano: si mañana cambia el contenido del token, estos tests se
 * enteran.
 */

import { Types } from 'mongoose';
import { generateToken } from '../../src/shared/token.utils';

export type Sesion = { id: Types.ObjectId; cabecera: string };

export const sesionDe = (
  opciones: { id?: Types.ObjectId; rol?: 'user' | 'admin'; username?: string } = {},
): Sesion => {
  const id = opciones.id ?? new Types.ObjectId();

  return {
    id,
    cabecera: `Bearer ${generateToken({
      id: String(id),
      username: opciones.username ?? 'cliente',
      rol: opciones.rol ?? 'user',
    })}`,
  };
};

export const sesionDeAdmin = (): Sesion => sesionDe({ rol: 'admin', username: 'admin' });
