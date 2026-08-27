import { Schema, model, Types } from 'mongoose';

export enum EstadoSlot {
  DISPONIBLE = 'disponible',
  OCUPADO    = 'ocupado',
  BLOQUEADO  = 'bloqueado',
}

export interface IDisponibilidad {
  /** codigoArticulo del servicio (rango 60XX). */
  servicio: number;
  /** Dia del slot, normalizado a medianoche UTC. */
  fecha: Date;
  /** Hora local del centro en formato HH:MM. */
  horaInicio: string;
  horaFin: string;
  /** Minutos. Debe cuadrar con la duracion del servicio. */
  duracion: number;
  estado: EstadoSlot;
  /** Pedido que reservo el slot, solo cuando estado === OCUPADO. */
  pedidoId?: Types.ObjectId;
  /**
   * Caducidad de una retencion provisional. Mientras el pedido espera
   * confirmacion el slot esta ocupado pero con fecha de caducidad: si nadie lo
   * confirma antes, vuelve a estar disponible. Al confirmar el pedido este
   * campo se limpia y la ocupacion pasa a ser firme.
   */
  retenidoHasta?: Date;
  nota?: string;
}

export const PATRON_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DisponibilidadSchema = new Schema<IDisponibilidad>(
  {
    servicio: {
      type:     Number,
      required: [true, 'El servicio es obligatorio'],
      index:    true,
    },
    fecha: {
      type:     Date,
      required: [true, 'La fecha es obligatoria'],
      index:    true,
    },
    horaInicio: {
      type:     String,
      required: [true, 'La hora de inicio es obligatoria'],
      match:    [PATRON_HORA, 'La hora de inicio debe tener formato HH:MM'],
    },
    horaFin: {
      type:     String,
      required: [true, 'La hora de fin es obligatoria'],
      match:    [PATRON_HORA, 'La hora de fin debe tener formato HH:MM'],
    },
    duracion: {
      type:     Number,
      required: [true, 'La duracion es obligatoria'],
      min:      [1, 'La duracion debe ser de al menos 1 minuto'],
    },
    estado: {
      type:    String,
      enum:    Object.values(EstadoSlot),
      default: EstadoSlot.DISPONIBLE,
      index:   true,
    },
    pedidoId: {
      type: Schema.Types.ObjectId,
      ref:  'Order',
    },
    retenidoHasta: {
      type:  Date,
      index: true,
    },
    nota: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Un servicio no puede tener dos slots que arranquen a la misma hora el mismo dia.
// Es lo que hace idempotente la generacion por lotes.
DisponibilidadSchema.index(
  { servicio: 1, fecha: 1, horaInicio: 1 },
  { unique: true },
);

export const DisponibilidadModelo = model<IDisponibilidad>('Disponibilidad', DisponibilidadSchema);
