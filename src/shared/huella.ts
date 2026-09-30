import crypto from 'crypto';

/**
 * Secretos de un solo uso que se entregan al cliente y se comprueban despues:
 * la clave de un pedido de invitado y el token del enlace de recuperacion.
 *
 * Los dos se guardan igual que una contrasena: solo su huella. Quien lea la
 * base de datos —una copia de seguridad, un volcado— no puede usarlos.
 * SHA-256 sin sal basta aqui, a diferencia de una contrasena: el secreto son
 * 32 bytes aleatorios, no algo que una persona haya elegido y se pueda adivinar.
 */

/** Secreto nuevo: el `secreto` va al cliente, la `huella` a la base de datos. */
export const generarSecreto = (): { secreto: string; huella: string } => {
  const secreto = crypto.randomBytes(32).toString('hex');
  return { secreto, huella: huellaDe(secreto) };
};

export const huellaDe = (secreto: string): string =>
  crypto.createHash('sha256').update(secreto).digest('hex');

/**
 * Compara un secreto recibido con la huella guardada.
 *
 * En tiempo constante: una comparacion normal corta en el primer caracter
 * distinto, y cuanto tarda en responder dice cuantos acerto. Cualquier cosa
 * que no sea texto se rechaza sin llegar a compararla.
 */
export const secretoCoincide = (huellaGuardada: string | undefined, secreto: unknown): boolean => {
  if (!huellaGuardada || typeof secreto !== 'string' || !secreto) return false;

  const recibida = Buffer.from(huellaDe(secreto), 'hex');
  const guardada = Buffer.from(huellaGuardada, 'hex');

  return recibida.length === guardada.length && crypto.timingSafeEqual(recibida, guardada);
};
