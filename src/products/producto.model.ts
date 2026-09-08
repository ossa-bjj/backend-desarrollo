import { Schema, model } from 'mongoose';
import { normalizarUrlMedia } from '../shared/r2.utils';

export enum Categoria {
  PROTECCIONES = 'PROTECCIONES', // Guantes, guantillas, bucales, espinilleras
  ROPA_ENTRENAMIENTO = 'ROPA_ENTRENAMIENTO', // Rashguards, mallas, shorts
  ROPA_CALLE = 'ROPA_CALLE', // Sudaderas, camisetas, chándal
  CALZADO = 'CALZADO', // Botas de boxeo, zapatillas de lucha, sandalias
  ACCESORIOS = 'ACCESORIOS', // Mochilas, cinturones, gorras, complementos
}

/**
 * Dos primeros dígitos del `codigoArticulo` de cada categoría. No es una
 * convención de presentación: reparte el espacio de códigos entre categorías
 * (y deja el rango 60XX a los servicios), así que la regla vive junto al modelo
 * que la sufre. El formulario del panel replica el mapa solo para poder avisar
 * antes de enviar; quien la hace cumplir es el servidor.
 */
export const PREFIJO_CATEGORIA: Record<Categoria, string> = {
  [Categoria.ROPA_ENTRENAMIENTO]: '10',
  [Categoria.PROTECCIONES]: '20',
  [Categoria.ROPA_CALLE]: '30',
  [Categoria.ACCESORIOS]: '40',
  [Categoria.CALZADO]: '50',
};

export const esCategoria = (valor: unknown): valor is Categoria =>
  typeof valor === 'string' && Object.values(Categoria).includes(valor as Categoria);

/**
 * Tallas en las que se vende un producto.
 *
 * ⚠️ CONTRATO CON EL FRONTEND: su gemela es `TALLAS` en
 * `frontend/src/types/producto.types.ts`. El servidor rechaza cualquier valor
 * que no este aqui, asi que si alli aparece una talla que aqui no existe, el
 * panel deja elegirla y el guardado falla sin que nada lo advierta antes.
 */
export const TALLAS = ['S', 'M', 'L', 'XL', 'XXL'] as const;

export type Talla = (typeof TALLAS)[number];

export const esTalla = (valor: unknown): valor is Talla =>
  typeof valor === 'string' && (TALLAS as readonly string[]).includes(valor);

/** Existencias de una talla concreta. */
export interface ITallaStock {
  talla: Talla;
  stock: number;
}

// 2. Interfaz para el producto
export interface IProduct {
  codigoArticulo: number;
  name: string;
  price: number;
  description: string;
  /**
   * El stock vive por talla y no en un solo numero.
   *
   * Con un contador unico, un producto con existencias de S pero agotado en L
   * seguia anunciandose disponible para todo el mundo: quien queria una L la
   * anadia al carrito y solo se enteraba al final, o ni eso.
   */
  tallas: ITallaStock[];
  /** Suma de todas las tallas. Calculado, no almacenado: ver el virtual. */
  stockTotal?: number;
  category: Categoria;
  subcategoria: string; // Ej: "Rashguards" o "Guantillas" para afinar el filtro
  marca?: string; // Para futuras funcionalidades de marca
  imagenes: string[];
  tags?: string[]; // Para búsquedas cruzadas (ej: ["BJJ", "MMA", "Venum"])
}

/**
 * Una entrada por talla. Es un array y no un objeto con cinco claves fijas
 * porque el calzado usa numeros y no letras: asi cabe otra escala sin volver a
 * migrar el modelo.
 */
const TallaStockSchema = new Schema<ITallaStock>(
  {
    talla: { type: String, required: true, enum: TALLAS },
    stock: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

// 3. Esquema de Mongoose
const ProductoSchema = new Schema<IProduct>(
  {
    codigoArticulo: {
      type: Number,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    tallas: {
      type: [TallaStockSchema],
      required: true,
      // Un producto nuevo nace con las cinco tallas a cero: asi el panel las
      // encuentra siempre y no hay que distinguir «sin talla» de «agotada».
      default: () => TALLAS.map((talla) => ({ talla, stock: 0 })),
      validate: {
        validator: (tallas: ITallaStock[]) => new Set(tallas.map((t) => t.talla)).size === tallas.length,
        message: 'Hay tallas repetidas',
      },
    },
    category: {
      type: String,
      required: true,
      enum: Object.values(Categoria),
      index: true,
    },
    subcategoria: {
      type: String,
      required: true,
      trim: true,
    },
    marca: {
      type: String,
      trim: true,
    },
    imagenes: {
      type: [String],
      default: [],
      required: true,
    },
    tags: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
    // Las imagenes se guardan como key del bucket. La URL publica depende del
    // entorno, asi que se resuelve aqui, en el borde de salida, en vez de
    // congelarse dentro del dato al subir el fichero.
    toJSON: {
      // `stockTotal` es un virtual y sin esto no saldria en la respuesta.
      virtuals: true,
      transform: (_doc: unknown, ret: Record<string, unknown>) => {
        const imagenes = ret['imagenes'];
        if (Array.isArray(imagenes)) {
          ret['imagenes'] = imagenes.map((img) => normalizarUrlMedia(String(img)));
        }
        // `virtuals: true` arrastra tambien el `id` que Mongoose deriva de
        // `_id`, y el cliente ya usa `_id`: dos nombres para lo mismo.
        delete ret['id'];
        return ret;
      },
    },
  },
);

/**
 * Cuantas unidades quedan sumando todas las tallas.
 *
 * Calculado y no almacenado: un contador aparte habria que mantenerlo a mano
 * en cada venta y en cada edicion del panel, y basta olvidarlo una vez para
 * que empiece a mentir. Sirve para lo que no depende de la talla —decir si un
 * producto esta agotado del todo, ordenar el catalogo— sin que nadie tenga que
 * sumar por su cuenta.
 */
ProductoSchema.virtual('stockTotal').get(function (this: IProduct): number {
  return (this.tallas ?? []).reduce((total, t) => total + t.stock, 0);
});

// Índice de texto compuesto para el buscador global de la tienda
ProductoSchema.index({ name: 'text', description: 'text', subcategoria: 'text', tags: 'text' });

export const ProductoModelo = model<IProduct>('Producto', ProductoSchema);
