import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';
import type { IShippingAddress, IUser } from './user.model';
import { User, UserRole, UserStatus } from './user.model';
import { esDuplicado } from '../shared/controller.utils';

/**
 * Ficha de quien compra sin cuenta.
 *
 * Es un `User` con rol `invitado`: una ficha por persona, identificada por su
 * correo, que tambien hace de `username`. No tiene contrasena ni puede iniciar
 * sesion; existe para que los pedidos queden a nombre de alguien y sus datos
 * esten en el mismo sitio que los de los clientes con cuenta. Deja de ser ficha
 * cuando su dueño abre el enlace que le llega al correo (`auth.controller.ts`,
 * reset-password): hasta entonces nadie ha demostrado que ese correo sea suyo.
 *
 * REGLAS QUE NO SE PUEDEN TOCAR:
 *
 * 1. Una peticion anonima nunca sobrescribe los datos de una ficha que ya
 *    existe. Quien conoce un correo puede comprar con el, pero no cambiar el
 *    nombre ni el telefono de esa persona. Lo unico que se anade es una
 *    direccion nueva, con tope, y el pedido guarda su propia copia de contacto
 *    y envio, que es la que vale para ese pedido.
 * 2. Un correo que pertenece a una cuenta de verdad no se usa como invitado:
 *    ni se le cuelga el pedido —su dueño veria los datos de otra persona si
 *    alguien se equivoco al escribir— ni se crea una ficha paralela.
 * 3. La ficha se identifica SOLO por el correo. El `username` es el correo por
 *    comodidad, pero no decide nada: si otra cuenta tuviera ya ese nombre, la
 *    ficha toma otro y sigue siendo la misma persona.
 */

export interface DatosFicha {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

type DireccionFicha = Omit<IShippingAddress, 'esPredeterminada'>;

/**
 * Direcciones como maximo en una ficha. Llegan de peticiones anonimas: sin
 * tope, cualquiera que conozca un correo podria engordar esa ficha sin fin.
 */
export const MAXIMO_DIRECCIONES_FICHA = 5;

export type ResultadoFicha =
  | { ok: true; ficha: HydratedDocument<IUser>; nueva: boolean }
  | { ok: false; motivo: 'cuenta-existente' | 'bloqueada' };

const normalizar = (valor: string): string => valor.trim().toLowerCase();

/** Decide que hacer con lo que ya hay a nombre de ese correo. */
const resolverExistente = (existente: HydratedDocument<IUser>): ResultadoFicha => {
  if (existente.role !== UserRole.INVITADO) return { ok: false, motivo: 'cuenta-existente' };
  // El admin puede bloquear una ficha, por ejemplo por fraude. Tiene que servir
  // de algo: si no, ese correo seguiria comprando como si nada.
  if (existente.status === UserStatus.BANNED) return { ok: false, motivo: 'bloqueada' };
  return { ok: true, ficha: existente, nueva: false };
};

const crearFicha = (datos: DatosFicha, email: string, username: string) =>
  new User({
    username,
    email,
    role: UserRole.INVITADO,
    profile: {
      firstName: datos.firstName,
      lastName: datos.lastName,
      phone: datos.phone,
      addresses: [],
    },
  }).save();

/**
 * Devuelve la ficha del comprador: la que ya tiene o una nueva.
 *
 * No escribe direcciones: eso va despues, con `anadirDireccionAFicha`, cuando
 * el pedido ya se ha guardado. Asi un pedido que no llega a crearse no deja
 * rastro en la ficha de nadie.
 *
 * Idempotente frente a dos compras simultaneas con el mismo correo: si la
 * segunda choca con el indice unico, recupera la que acaba de crear la primera
 * en vez de fallar.
 */
export const obtenerFichaDeInvitado = async (datos: DatosFicha): Promise<ResultadoFicha> => {
  const email = normalizar(datos.email);

  const existente = await User.findOne({ email });
  if (existente) return resolverExistente(existente);

  try {
    return { ok: true, ficha: await crearFicha(datos, email, email), nueva: true };
  } catch (error) {
    if (!esDuplicado(error)) throw error;

    // O otra compra con el mismo correo la ha creado entre medias...
    const creadaEntreMedias = await User.findOne({ email });
    if (creadaEntreMedias) return resolverExistente(creadaEntreMedias);

    // ...o el choque es solo del `username`: una cuenta antigua se llama como
    // este correo. No es la misma persona (regla 3), asi que la ficha toma un
    // nombre que ninguna cuenta nueva puede tener, porque lleva `@`.
    const alternativo = `${email}#${new Types.ObjectId().toHexString()}`;
    return { ok: true, ficha: await crearFicha(datos, email, alternativo), nueva: true };
  }
};

/**
 * Anade la direccion a la ficha si todavia no la tiene y queda sitio.
 *
 * En una sola operacion condicional, no leyendo y escribiendo despues: dos
 * compras a la vez con la misma direccion la duplicarian, y dos primeras
 * direcciones a la vez dejarian dos predeterminadas. La condicion la evalua
 * Mongo sobre el documento en el momento de escribir.
 */
export const anadirDireccionAFicha = async (
  fichaId: Types.ObjectId,
  direccion: DireccionFicha | undefined,
): Promise<void> => {
  if (!direccion) return;

  const noLaTiene = { 'profile.addresses': { $not: { $elemMatch: direccion } } };
  const quedaSitio = { [`profile.addresses.${MAXIMO_DIRECCIONES_FICHA - 1}`]: { $exists: false } };

  // La primera es la predeterminada; solo puede serlo si no hay ninguna.
  const primera = await User.updateOne(
    { _id: fichaId, role: UserRole.INVITADO, 'profile.addresses.0': { $exists: false } },
    { $push: { 'profile.addresses': { ...direccion, esPredeterminada: true } } },
  );
  if (primera.modifiedCount > 0) return;

  await User.updateOne(
    { _id: fichaId, role: UserRole.INVITADO, ...noLaTiene, ...quedaSitio },
    { $push: { 'profile.addresses': { ...direccion, esPredeterminada: false } } },
  );
};

/**
 * Marca como cliente la ficha de quien ha pagado un pedido.
 *
 * La ficha se crea al hacer el pedido, antes de pagar; sin esto, en el panel no
 * habria forma de distinguir a quien compro de quien dejo el carrito a medias.
 * Solo toca fichas de invitado: en una cuenta, «cliente» lo decide el admin.
 */
export const marcarFichaComoCliente = async (fichaId: Types.ObjectId): Promise<void> => {
  await User.updateOne(
    { _id: fichaId, role: UserRole.INVITADO, 'customer.isCustomer': { $ne: true } },
    { $set: { 'customer.isCustomer': true, 'customer.since': new Date() } },
  );
};
