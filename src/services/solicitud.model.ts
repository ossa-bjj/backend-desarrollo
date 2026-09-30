import { Schema, model } from 'mongoose';

/**
 * Solicitud de propuesta: una academia pide un seminario u otro servicio a
 * medida desde su pagina, y la administracion le responde con una propuesta.
 *
 * No es un pedido: no tiene precio ni se cobra. Es el primer contacto, y se
 * guarda para que ninguna se pierda aunque el aviso por correo no llegue.
 */

export enum EstadoSolicitud {
  NUEVA = 'nueva',
  RESPONDIDA = 'respondida',
  DESCARTADA = 'descartada',
}

export interface ISolicitud {
  /** codigoArticulo del servicio por el que se pregunta. */
  servicio: number;
  /** Nombre del servicio cuando se pidio: el servicio puede cambiar o borrarse. */
  servicioNombre: string;
  academia: string;
  ciudad: string;
  alumnos: string;
  fechas: string;
  /** Correo o telefono, tal cual lo escribio: el formulario admite los dos. */
  contacto: string;
  mensaje?: string;
  estado: EstadoSolicitud;
  createdAt?: Date;
  updatedAt?: Date;
}

const SolicitudSchema = new Schema<ISolicitud>(
  {
    servicio: { type: Number, required: true, index: true },
    servicioNombre: { type: String, required: true, trim: true },
    academia: { type: String, required: true, trim: true, maxlength: 150 },
    ciudad: { type: String, required: true, trim: true, maxlength: 100 },
    alumnos: { type: String, required: true, trim: true, maxlength: 50 },
    fechas: { type: String, required: true, trim: true, maxlength: 200 },
    contacto: { type: String, required: true, trim: true, maxlength: 200 },
    mensaje: { type: String, trim: true, maxlength: 2000 },
    estado: {
      type: String,
      enum: Object.values(EstadoSolicitud),
      default: EstadoSolicitud.NUEVA,
      index: true,
    },
  },
  { timestamps: true, versionKey: false },
);

export const SolicitudModelo = model<ISolicitud>('Solicitud', SolicitudSchema);
