import { Types } from 'mongoose';
import { DisponibilidadModelo, EstadoSlot } from './disponibilidad.model';

/**
 * Horas que un pedido sin confirmar mantiene retenido su horario.
 * Pasado ese plazo el slot vuelve al catalogo aunque el pedido siga vivo:
 * evita que una cesta abandonada bloquee la agenda indefinidamente.
 */
const HORAS_RETENCION = 48;

/**
 * Horas para un pedido de invitado. Mucho menos que las 48 de un cliente con
 * cuenta, a proposito: la compra sin cuenta es una ruta publica, y con 48 horas
 * bastaria rotar correos inventados para tener la agenda entera bloqueada sin
 * pagar nada. Un invitado paga en el momento; si tarda mas, la retencion se
 * renueva al empezar a cobrar (`renovarRetencionParaCobrar`).
 */
export const HORAS_RETENCION_INVITADO = 1;

/**
 * Tope absoluto, contado desde que se creo el pedido, hasta el que se puede
 * renovar la retencion de un invitado. Sin tope, llamar a "iniciar pago" cada
 * cincuenta minutos —aunque nunca se pague— mantendria el hueco bloqueado para
 * siempre. Para un cliente con cuenta el tope son las mismas 48 horas: renovar
 * sirve para recuperar lo perdido dentro de ese plazo, no para alargarlo.
 */
const HORAS_MAXIMAS_RETENCION_INVITADO = 3;

/** Horas de retencion segun quien hace el pedido. */
export const horasDeRetencion = (esInvitado: boolean): number =>
  esInvitado ? HORAS_RETENCION_INVITADO : HORAS_RETENCION;

/** Hasta cuando, como mucho, puede un pedido retener sus horarios. */
export const limiteDeRetencion = (creadoEn: Date, esInvitado: boolean): Date =>
  new Date(
    creadoEn.getTime() + (esInvitado ? HORAS_MAXIMAS_RETENCION_INVITADO : HORAS_RETENCION) * 60 * 60 * 1000,
  );

const calcularCaducidad = (horas: number = HORAS_RETENCION): Date =>
  new Date(Date.now() + horas * 60 * 60 * 1000);

/**
 * Libera las retenciones provisionales ya caducadas.
 *
 * Se invoca de forma perezosa al consultar disponibilidad, asi el sistema se
 * autolimpia sin necesidad de un cron. Solo afecta a slots con `retenidoHasta`
 * en el pasado: una ocupacion firme (pedido ya confirmado) no lleva ese campo
 * y por tanto nunca entra en este filtro.
 */
export const liberarRetencionesCaducadas = async (servicio?: number): Promise<number> => {
  const filtro: Record<string, unknown> = {
    estado: EstadoSlot.OCUPADO,
    retenidoHasta: { $lt: new Date() },
  };
  if (servicio !== undefined) filtro.servicio = servicio;

  const resultado = await DisponibilidadModelo.updateMany(filtro, {
    $set: { estado: EstadoSlot.DISPONIBLE },
    $unset: { pedidoId: '', retenidoHasta: '' },
  });

  return resultado.modifiedCount ?? 0;
};

/**
 * Marca los slots indicados como ocupados de forma provisional, ligados al
 * pedido. Devuelve los ids que no se pudieron retener porque otro pedido se
 * adelanto: el llamante decide si eso invalida la operacion entera.
 */
export const retenerSlots = async (
  pedidoId: Types.ObjectId | string,
  slotIds: string[],
  horas: number = HORAS_RETENCION,
): Promise<{ retenidos: string[]; ocupados: string[] }> => {
  const retenidos: string[] = [];
  const ocupados: string[] = [];

  for (const slotId of slotIds) {
    if (!Types.ObjectId.isValid(slotId)) {
      ocupados.push(slotId);
      continue;
    }

    // Condicion sobre `estado` dentro del propio update: si dos pedidos compiten
    // por el mismo hueco, solo uno encuentra el slot disponible.
    const actualizado = await DisponibilidadModelo.findOneAndUpdate(
      { _id: slotId, estado: EstadoSlot.DISPONIBLE },
      {
        estado: EstadoSlot.OCUPADO,
        pedidoId,
        retenidoHasta: calcularCaducidad(horas),
      },
      { new: true },
    );

    if (actualizado) retenidos.push(slotId);
    else ocupados.push(slotId);
  }

  return { retenidos, ocupados };
};

/**
 * Asegura los horarios de un pedido justo antes de cobrarlo.
 *
 * Una retencion provisional caduca aunque el pedido siga pagable. Sin esto, se
 * podia cobrar un pedido cuyo hueco ya se habia soltado —o se habia llevado
 * otro cliente— y quedaba pagado sin horario. Por cada hueco:
 *
 * - si es de este pedido y firme (ya confirmado), no se toca;
 * - si es de este pedido y provisional, se le renueva el plazo;
 * - si se solto y nadie lo ha cogido, se vuelve a retener;
 * - si lo tiene otro pedido, se ha perdido.
 *
 * Nunca por encima de `limite`: pasado ese momento no se renueva ni se
 * recupera nada, y un hueco que ya no tiene plazo vigente cuenta como perdido.
 * Es lo que impide mantener un hueco bloqueado llamando aqui una y otra vez.
 *
 * Devuelve los que se han perdido. Quien llama no debe cobrar si hay alguno.
 */
export const renovarRetencionParaCobrar = async (
  pedidoId: Types.ObjectId,
  slotIds: string[],
  horas: number,
  limite: Date,
): Promise<{ perdidos: string[]; plazoAgotado: boolean }> => {
  const perdidos: string[] = [];
  const ahora = new Date();
  const plazoAgotado = ahora >= limite;
  const hasta = new Date(Math.min(calcularCaducidad(horas).getTime(), limite.getTime()));

  for (const slotId of slotIds) {
    if (!Types.ObjectId.isValid(slotId)) {
      perdidos.push(slotId);
      continue;
    }

    // Suyo y firme: no lleva `retenidoHasta`, nada que hacer.
    if (
      await DisponibilidadModelo.exists({
        _id: slotId,
        pedidoId,
        estado: EstadoSlot.OCUPADO,
        retenidoHasta: { $exists: false },
      })
    ) {
      continue;
    }

    if (plazoAgotado) {
      // Sin renovar: solo vale si todavia le queda plazo propio.
      const vigente = await DisponibilidadModelo.exists({
        _id: slotId,
        pedidoId,
        estado: EstadoSlot.OCUPADO,
        retenidoHasta: { $gt: ahora },
      });
      if (!vigente) perdidos.push(slotId);
      continue;
    }

    // Suyo y provisional: se alarga, sin pasar del limite.
    const renovado = await DisponibilidadModelo.updateOne(
      { _id: slotId, pedidoId, estado: EstadoSlot.OCUPADO, retenidoHasta: { $exists: true } },
      { $set: { retenidoHasta: hasta } },
    );
    if (renovado.matchedCount > 0) continue;

    // Se solto: se recupera solo si sigue libre. La condicion va en la propia
    // escritura, igual que al retener, para no quitarselo a quien llegue a la vez.
    const recuperado = await DisponibilidadModelo.updateOne(
      { _id: slotId, estado: EstadoSlot.DISPONIBLE },
      { $set: { estado: EstadoSlot.OCUPADO, pedidoId, retenidoHasta: hasta } },
    );
    if (recuperado.matchedCount === 0) perdidos.push(slotId);
  }

  return { perdidos, plazoAgotado };
};

/**
 * Deja en firme los horarios de un pedido que se acaba de cobrar.
 *
 * El cobro puede confirmarse despues de caducar la retencion —un Bizum que
 * tarda, alguien que se queda en el formulario de la tarjeta—. Por cada hueco:
 * si sigue siendo del pedido se consolida; si se solto y sigue libre, se
 * recupera ya en firme; si lo tiene otro pedido, se devuelve como perdido para
 * que quede anotado en el pedido. El dinero ya esta cobrado: lo que no puede
 * pasar es que el pedido figure con un horario que no tiene sin que nadie lo vea.
 */
export const consolidarHorariosAlCobrar = async (
  pedidoId: Types.ObjectId,
  slotIds: string[],
): Promise<{ perdidos: string[] }> => {
  const perdidos: string[] = [];

  for (const slotId of slotIds) {
    if (!Types.ObjectId.isValid(slotId)) {
      perdidos.push(slotId);
      continue;
    }

    const suyo = await DisponibilidadModelo.updateOne(
      { _id: slotId, pedidoId, estado: EstadoSlot.OCUPADO },
      { $unset: { retenidoHasta: '' } },
    );
    if (suyo.matchedCount > 0) continue;

    const recuperado = await DisponibilidadModelo.updateOne(
      { _id: slotId, estado: EstadoSlot.DISPONIBLE },
      { $set: { estado: EstadoSlot.OCUPADO, pedidoId }, $unset: { retenidoHasta: '' } },
    );
    if (recuperado.matchedCount === 0) perdidos.push(slotId);
  }

  return { perdidos };
};

/** Devuelve al catalogo todos los slots ligados a un pedido. */
export const liberarSlotsDePedido = async (pedidoId: Types.ObjectId | string): Promise<void> => {
  await DisponibilidadModelo.updateMany(
    { pedidoId },
    {
      $set: { estado: EstadoSlot.DISPONIBLE },
      $unset: { pedidoId: '', retenidoHasta: '' },
    },
  );
};

/**
 * Devuelve al catalogo un unico hueco de un pedido.
 *
 * Existe para poder deshacer una reasignacion a medias: si al confirmar un
 * presupuesto se mueven varios horarios y uno falla, los ya movidos hay que
 * devolverlos donde estaban, y los que no tenian horario previo, soltarlos.
 * Filtra por `pedidoId` ademas de por `_id` para no liberar la reserva de otro.
 */
export const liberarSlot = async (pedidoId: Types.ObjectId | string, slotId: string): Promise<void> => {
  if (!Types.ObjectId.isValid(slotId)) return;

  await DisponibilidadModelo.updateOne(
    { _id: slotId, pedidoId },
    {
      $set: { estado: EstadoSlot.DISPONIBLE },
      $unset: { pedidoId: '', retenidoHasta: '' },
    },
  );
};

/**
 * Convierte las retenciones de un pedido en ocupacion firme quitando la
 * caducidad. A partir de aqui el horario solo se libera cancelando el pedido.
 */
export const consolidarSlotsDePedido = async (pedidoId: Types.ObjectId | string): Promise<void> => {
  await DisponibilidadModelo.updateMany(
    { pedidoId, estado: EstadoSlot.OCUPADO },
    { $unset: { retenidoHasta: '' } },
  );
};

/**
 * Reasigna la reserva de un pedido a otro hueco del mismo servicio.
 * Libera el anterior y retiene el nuevo; si el nuevo ya no esta libre no toca
 * nada y devuelve null.
 */
export const reasignarSlot = async (
  pedidoId: Types.ObjectId | string,
  slotAnteriorId: string | undefined,
  slotNuevoId: string,
): Promise<{ horaInicio: string; horaFin: string; fecha: Date } | null> => {
  if (!Types.ObjectId.isValid(slotNuevoId)) return null;

  const nuevo = await DisponibilidadModelo.findOneAndUpdate(
    { _id: slotNuevoId, estado: EstadoSlot.DISPONIBLE },
    {
      estado: EstadoSlot.OCUPADO,
      pedidoId,
      retenidoHasta: calcularCaducidad(HORAS_RETENCION),
    },
    { new: true },
  );

  if (!nuevo) return null;

  // Solo se suelta el anterior una vez asegurado el nuevo.
  if (slotAnteriorId && Types.ObjectId.isValid(slotAnteriorId) && slotAnteriorId !== slotNuevoId) {
    await DisponibilidadModelo.updateOne(
      { _id: slotAnteriorId, pedidoId },
      {
        $set: { estado: EstadoSlot.DISPONIBLE },
        $unset: { pedidoId: '', retenidoHasta: '' },
      },
    );
  }

  return { horaInicio: nuevo.horaInicio, horaFin: nuevo.horaFin, fecha: nuevo.fecha };
};
