import { Schema, model, Types } from 'mongoose';

export enum CategoriaNoticia {
  EVENTO    = 'EVENTO',
  RESULTADO = 'RESULTADO',
  CLUB      = 'CLUB',
  PROMOCION = 'PROMOCION',
  GENERAL   = 'GENERAL',
}

export enum AccionHistorial {
  CREADA        = 'creada',
  EDITADA       = 'editada',
  PUBLICADA     = 'publicada',
  DESPUBLICADA  = 'despublicada',
}

/**
 * Cada entrada guarda una foto del titulo, el contenido y el estado en el
 * momento del cambio. Es un registro de auditoria: se anade, nunca se edita.
 */
export interface IEntradaHistorial {
  fecha: Date;
  autor: Types.ObjectId | null;
  accion: AccionHistorial;
  snapshot: {
    titulo: string;
    contenido: string;
    publicada: boolean;
  };
}

export interface INoticia {
  titulo: string;
  extracto: string;
  contenido: string;
  imagenPortada?: string;
  categoria: CategoriaNoticia;
  fechaEvento?: Date;
  horaInicio?: string;
  horaFin?: string;
  lugar?: string;
  publicada: boolean;
  autor: Types.ObjectId | null;
  tags: string[];
  historial: IEntradaHistorial[];
}

const EntradaHistorialSchema = new Schema<IEntradaHistorial>(
  {
    fecha: {
      type:    Date,
      default: Date.now,
    },
    autor: {
      type:    Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },
    accion: {
      type:     String,
      enum:     Object.values(AccionHistorial),
      required: [true, 'La accion del historial es obligatoria'],
    },
    snapshot: {
      titulo:    { type: String, default: '' },
      contenido: { type: String, default: '' },
      publicada: { type: Boolean, default: false },
    },
  },
  { _id: true },
);

// HH:MM en 24h. Misma convencion que disponibilidad: hora local de la academia,
// nunca un instante absoluto.
const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;

const NoticiaSchema = new Schema<INoticia>(
  {
    titulo: {
      type:      String,
      required:  [true, 'El titulo es obligatorio'],
      trim:      true,
      maxlength: [160, 'El titulo no puede superar los 160 caracteres'],
    },
    extracto: {
      type:      String,
      required:  [true, 'El extracto es obligatorio'],
      trim:      true,
      maxlength: [280, 'El extracto no puede superar los 280 caracteres'],
    },
    contenido: {
      type:     String,
      required: [true, 'El contenido es obligatorio'],
      trim:     true,
    },
    imagenPortada: {
      type: String,
      trim: true,
    },
    categoria: {
      type:     String,
      enum:     Object.values(CategoriaNoticia),
      default:  CategoriaNoticia.GENERAL,
      required: [true, 'La categoria es obligatoria'],
    },
    fechaEvento: {
      type: Date,
    },
    horaInicio: {
      type:     String,
      trim:     true,
      validate: {
        validator: (valor: string) => !valor || HORA_VALIDA.test(valor),
        message:   'La hora de inicio debe tener el formato HH:MM',
      },
    },
    horaFin: {
      type:     String,
      trim:     true,
      validate: {
        validator: (valor: string) => !valor || HORA_VALIDA.test(valor),
        message:   'La hora de fin debe tener el formato HH:MM',
      },
    },
    lugar: {
      type: String,
      trim: true,
    },
    publicada: {
      type:    Boolean,
      default: false,
    },
    autor: {
      type:    Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },
    tags: {
      type:    [String],
      default: [],
    },
    historial: {
      type:    [EntradaHistorialSchema],
      default: [],
    },
  },
  { timestamps: true },
);

// La portada publica ordena por fecha de creacion descendente y filtra por
// publicada; este indice cubre las dos cosas.
NoticiaSchema.index({ publicada: 1, createdAt: -1 });
NoticiaSchema.index({ titulo: 'text', extracto: 'text', contenido: 'text', tags: 'text' });

export const NoticiaModelo = model<INoticia>('Noticia', NoticiaSchema);
