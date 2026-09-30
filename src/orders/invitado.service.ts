import type { IDatosInvitado, IOrder } from './order.model';
import { generarSecreto, secretoCoincide } from '../shared/huella';

/**
 * Reglas de la compra sin cuenta.
 *
 * Un invitado no tiene token: lo que demuestra que un pedido es suyo es una
 * clave aleatoria que se le entrega una sola vez, al crearlo. Aqui se guarda
 * solo su huella, como una contrasena, de modo que ni leyendo la base de datos
 * se puede operar sobre el pedido de otro.
 */

/** Cabecera por la que viaja la clave. Declarada tambien en `shared/cors.ts`. */
export const CABECERA_CLAVE_INVITADO = 'x-clave-pedido';

/** El mismo patron que valida el correo en `User` y en el propio pedido. */
const CORREO_VALIDO = /^\S+@\S+\.\S+$/;

/**
 * Topes de longitud. Esto llega de una ruta publica y acaba en la ficha del
 * comprador: sin tope, una sola peticion podria meter cien kilobytes en un
 * nombre. Son holgados para cualquier dato real.
 */
const LARGO_MAXIMO = { corto: 100, correo: 254, telefono: 30, direccion: 200 } as const;

type Lectura<T> = { ok: true; valor: T } | { ok: false; error: string };

const texto = (valor: unknown): string => (typeof valor === 'string' ? valor.trim() : '');

const camposVacios = (datos: Record<string, string>): string[] =>
  Object.entries(datos)
    .filter(([, valor]) => !valor)
    .map(([campo]) => campo);

const camposLargos = (datos: Record<string, string>, maximo: (campo: string) => number): string[] =>
  Object.entries(datos)
    .filter(([campo, valor]) => valor.length > maximo(campo))
    .map(([campo]) => campo);

/**
 * Lee y valida los datos de contacto del invitado.
 *
 * Son obligatorios todos: sin cuenta no hay otro sitio del que sacar a quien
 * avisar si el pedido tiene una incidencia.
 */
export const leerDatosInvitado = (entrada: unknown): Lectura<IDatosInvitado> => {
  const datos = (entrada ?? {}) as Record<string, unknown>;

  const invitado: IDatosInvitado = {
    firstName: texto(datos.firstName),
    lastName: texto(datos.lastName),
    email: texto(datos.email).toLowerCase(),
    phone: texto(datos.phone),
  };

  const faltan = camposVacios({ ...invitado });
  if (faltan.length > 0) {
    return { ok: false, error: `Faltan datos del comprador: ${faltan.join(', ')}` };
  }

  const largos = camposLargos({ ...invitado }, (campo) =>
    campo === 'email' ? LARGO_MAXIMO.correo : campo === 'phone' ? LARGO_MAXIMO.telefono : LARGO_MAXIMO.corto,
  );
  if (largos.length > 0) {
    return { ok: false, error: `Datos del comprador demasiado largos: ${largos.join(', ')}` };
  }

  if (!CORREO_VALIDO.test(invitado.email)) {
    return { ok: false, error: 'El correo del comprador no es válido' };
  }

  return { ok: true, valor: invitado };
};

export type DireccionEnvio = NonNullable<IOrder['shippingAddress']>;

/**
 * Lee la direccion de envio. Devuelve `undefined` si no llega ninguna; si llega,
 * tiene que venir entera: media direccion no sirve para mandar un paquete.
 */
export const leerDireccionEnvio = (entrada: unknown): Lectura<DireccionEnvio | undefined> => {
  if (entrada === undefined || entrada === null) return { ok: true, valor: undefined };

  const datos = entrada as Record<string, unknown>;
  const direccion: DireccionEnvio = {
    calle: texto(datos.calle),
    ciudad: texto(datos.ciudad),
    provincia: texto(datos.provincia),
    codigoPostal: texto(datos.codigoPostal),
    pais: texto(datos.pais),
  };

  const faltan = camposVacios({ ...direccion });
  if (faltan.length > 0) {
    return { ok: false, error: `Faltan datos de la dirección de envío: ${faltan.join(', ')}` };
  }

  const largos = camposLargos({ ...direccion }, () => LARGO_MAXIMO.direccion);
  if (largos.length > 0) {
    return { ok: false, error: `Dirección de envío demasiado larga: ${largos.join(', ')}` };
  }

  return { ok: true, valor: direccion };
};

/** Clave nueva para un pedido de invitado: la clave va al cliente, la huella al pedido. */
export const generarClaveInvitado = (): { clave: string; huella: string } => {
  const { secreto, huella } = generarSecreto();
  return { clave: secreto, huella };
};

/** Compara la clave recibida con la huella guardada, en tiempo constante. */
export const claveInvitadoValida = (huellaGuardada: string | undefined, clave: unknown): boolean =>
  secretoCoincide(huellaGuardada, clave);
