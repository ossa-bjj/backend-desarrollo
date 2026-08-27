import { Schema, model } from 'mongoose';

// Los servicios comparten el espacio de codigoArticulo con los productos.
// Convencion de codigos: 60XX -> SERVICIOS (el resto de prefijos vive en producto.model.ts)
export const CODIGO_SERVICIO_MIN = 6000;
export const CODIGO_SERVICIO_MAX = 6999;

export enum ModalidadServicio {
  PRESENCIAL = 'presencial',
  ONLINE     = 'online',
  MIXTA      = 'mixta',
}

export interface IServicio {
  codigoArticulo: number;
  nombre: string;
  precio: number;
  subcategoria: string;
  descripcionCorta: string;
  descripcionCompleta: string;
  modalidad: ModalidadServicio;
  duracion: number;
  plazas: number;
  requiereReserva: boolean;
  requiereConfirmacion: boolean;
  activo: boolean;
  imagenes: string[];
  tags: string[];
  orden: number;
}

const ServicioSchema = new Schema<IServicio>(
  {
    codigoArticulo: {
      type:     Number,
      required: [true, 'El codigo de articulo es obligatorio'],
      unique:   true,
      min:      [CODIGO_SERVICIO_MIN, `Los servicios usan codigos entre ${CODIGO_SERVICIO_MIN} y ${CODIGO_SERVICIO_MAX}`],
      max:      [CODIGO_SERVICIO_MAX, `Los servicios usan codigos entre ${CODIGO_SERVICIO_MIN} y ${CODIGO_SERVICIO_MAX}`],
    },
    nombre: {
      type:     String,
      required: [true, 'El nombre es obligatorio'],
      trim:     true,
    },
    precio: {
      type:     Number,
      required: [true, 'El precio es obligatorio'],
      min:      [0, 'El precio no puede ser negativo'],
    },
    subcategoria: {
      type:     String,
      required: [true, 'La subcategoria es obligatoria'],
      trim:     true,
    },
    descripcionCorta: {
      type:      String,
      required:  [true, 'La descripcion corta es obligatoria'],
      trim:      true,
      maxlength: [180, 'La descripcion corta no puede superar los 180 caracteres'],
    },
    descripcionCompleta: {
      type:     String,
      required: [true, 'La descripcion completa es obligatoria'],
      trim:     true,
    },
    modalidad: {
      type:     String,
      enum:     Object.values(ModalidadServicio),
      default:  ModalidadServicio.PRESENCIAL,
      index:    true,
    },
    // Duracion de una sesion, en minutos. Debe cuadrar con la duracion de los
    // slots de disponibilidad que se generen para este servicio.
    duracion: {
      type:     Number,
      required: [true, 'La duracion es obligatoria'],
      min:      [1, 'La duracion debe ser de al menos 1 minuto'],
    },
    // Plazas por sesion: 1 en clases privadas, N en seminarios.
    plazas: {
      type:    Number,
      default: 1,
      min:     [1, 'Un servicio debe ofrecer al menos una plaza'],
    },
    // Si es false el servicio se compra sin elegir horario (bonos, packs).
    requiereReserva: {
      type:    Boolean,
      default: true,
    },
    // Si es true el pedido queda en espera de que un admin revise y ajuste el
    // precio antes de que el cliente pueda pagar. Los servicios se venden como
    // presupuesto por defecto: la clase privada puede llevar recargo, el
    // seminario descuento de grupo.
    requiereConfirmacion: {
      type:    Boolean,
      default: true,
    },
    // Un servicio inactivo deja de mostrarse en la web pero conserva su historial de pedidos.
    activo: {
      type:    Boolean,
      default: true,
      index:   true,
    },
    imagenes: {
      type:    [String],
      default: [],
    },
    tags: {
      type:    [String],
      default: [],
    },
    orden: {
      type:    Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

ServicioSchema.index({
  nombre:              'text',
  descripcionCorta:    'text',
  descripcionCompleta: 'text',
  subcategoria:        'text',
  tags:                'text',
});

export const ServicioModelo = model<IServicio>('Servicio', ServicioSchema);
