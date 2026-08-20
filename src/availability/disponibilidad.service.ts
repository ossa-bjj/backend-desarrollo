import { Types } from 'mongoose';
import { DisponibilidadModelo, EstadoSlot } from './disponibilidad.model';

/**
 * Horas que un pedido sin confirmar mantiene retenido su horario.
 * Pasado ese plazo el slot vuelve al catalogo aunque el pedido siga vivo:
 * evita que una cesta abandonada bloquee la agenda indefinidamente.
 */
export const HORAS_RETENCION = 48;

export const calcularCaducidad = (): Date =>
  new Date(Date.now() + HORAS_RETENCION * 60 * 60 * 1000);

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
    estado:        EstadoSlot.OCUPADO,
    retenidoHasta: { $lt: new Date() },
  };
  if (servicio !== undefined) filtro.servicio = servicio;

  const resultado = await DisponibilidadModelo.updateMany(filtro, {
    $set:   { estado: EstadoSlot.DISPONIBLE },
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
        estado:        EstadoSlot.OCUPADO,
        pedidoId,
        retenidoHasta: calcularCaducidad(),
      },
      { new: true },
    );

    if (actualizado) retenidos.push(slotId);
    else ocupados.push(slotId);
  }

  return { retenidos, ocupados };
};

/** Devuelve al catalogo todos los slots ligados a un pedido. */
export const liberarSlotsDePedido = async (pedidoId: Types.ObjectId | string): Promise<void> => {
  await DisponibilidadModelo.updateMany(
    { pedidoId },
    {
      $set:   { estado: EstadoSlot.DISPONIBLE },
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
      estado:        EstadoSlot.OCUPADO,
      pedidoId,
      retenidoHasta: calcularCaducidad(),
    },
    { new: true },
  );

  if (!nuevo) return null;

  // Solo se suelta el anterior una vez asegurado el nuevo.
  if (slotAnteriorId && Types.ObjectId.isValid(slotAnteriorId) && slotAnteriorId !== slotNuevoId) {
    await DisponibilidadModelo.updateOne(
      { _id: slotAnteriorId, pedidoId },
      {
        $set:   { estado: EstadoSlot.DISPONIBLE },
        $unset: { pedidoId: '', retenidoHasta: '' },
      },
    );
  }

  return { horaInicio: nuevo.horaInicio, horaFin: nuevo.horaFin, fecha: nuevo.fecha };
};
