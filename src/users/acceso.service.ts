import { IntentoAcceso } from './intento-acceso.model';

/**
 * Freno a la fuerza bruta contra el login.
 *
 * Se cuentan dos claves a la vez y basta con que una este bloqueada:
 *
 *   usuario:<nombre>  frena reventar la contrasena de una cuenta concreta
 *   ip:<direccion>    frena probar una contrasena comun contra muchas cuentas
 *
 * Con solo la primera, quien rocia usuarios distintos no llega nunca al tope;
 * con solo la segunda, una oficina entera comparte castigo por un despistado.
 */

const MAX_INTENTOS = 5;
const VENTANA_MINUTOS = 15;
const BLOQUEO_MINUTOS = 15;

const MINUTO_MS = 60 * 1000;

export const claveUsuario = (username: string): string => `usuario:${username.toLowerCase().trim()}`;
export const claveIp = (ip: string): string => `ip:${ip}`;

/**
 * Devuelve hasta cuando esta bloqueado el acceso, o null si puede intentarlo.
 * Una sola consulta para ambas claves: son dos formas de mirar el mismo intento.
 */
export const bloqueadoHasta = async (claves: string[]): Promise<Date | null> => {
  const ahora = new Date();

  const bloqueo = await IntentoAcceso
    .findOne({ clave: { $in: claves }, bloqueadoHasta: { $gt: ahora } })
    .sort({ bloqueadoHasta: -1 })
    .select('bloqueadoHasta');

  return bloqueo?.bloqueadoHasta ?? null;
};

/**
 * Suma un fallo a cada clave y bloquea la que llegue al tope.
 *
 * El incremento y la lectura van en la misma operacion (`findOneAndUpdate` con
 * `$inc`) para que dos intentos simultaneos no se pisen el contador y acaben
 * sumando uno solo.
 */
export const registrarFallo = async (claves: string[]): Promise<void> => {
  const ahora = Date.now();

  await Promise.all(
    claves.map(async (clave) => {
      const registro = await IntentoAcceso.findOneAndUpdate(
        { clave },
        {
          $inc: { intentos: 1 },
          $set: { expiraEn: new Date(ahora + VENTANA_MINUTOS * MINUTO_MS) },
        },
        { new: true, upsert: true },
      );

      if (registro.intentos < MAX_INTENTOS) return;

      // Al alcanzar el tope se bloquea y el contador vuelve a cero: el siguiente
      // bloqueo exige otra tanda completa de fallos, no un unico intento mas.
      await IntentoAcceso.updateOne(
        { clave },
        {
          $set: {
            intentos: 0,
            bloqueadoHasta: new Date(ahora + BLOQUEO_MINUTOS * MINUTO_MS),
            expiraEn: new Date(ahora + (BLOQUEO_MINUTOS + VENTANA_MINUTOS) * MINUTO_MS),
          },
        },
      );
    }),
  );
};

/** Un acceso correcto borra el rastro: los fallos previos ya no cuentan. */
export const limpiarIntentos = async (claves: string[]): Promise<void> => {
  await IntentoAcceso.deleteMany({ clave: { $in: claves } });
};

/** Segundos que faltan para poder reintentar, para la cabecera `Retry-After`. */
export const segundosHasta = (momento: Date): number =>
  Math.max(1, Math.ceil((momento.getTime() - Date.now()) / 1000));
