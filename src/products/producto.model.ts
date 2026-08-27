import { Schema, model } from "mongoose";
import { normalizarUrlMedia } from '../shared/r2.utils';

export enum Categoria {
  PROTECCIONES = "PROTECCIONES", // Guantes, guantillas, bucales, espinilleras
  ROPA_ENTRENAMIENTO = "ROPA_ENTRENAMIENTO", // Rashguards, mallas, shorts
  ROPA_CALLE = "ROPA_CALLE", // Sudaderas, camisetas, chándal
  CALZADO = "CALZADO", // Botas de boxeo, zapatillas de lucha, sandalias
  ACCESORIOS = "ACCESORIOS" // Mochilas, cinturones, gorras, complementos
}

// 2. Interfaz para el producto
export interface IProduct {
  codigoArticulo: number;
  name: string;
  price: number;
  description: string;
  stock: number;
  category: Categoria;
  subcategoria: string; // Ej: "Rashguards" o "Guantillas" para afinar el filtro
  marca?: string; // Para futuras funcionalidades de marca
  imagenes: string[];
  tags?: string[]; // Para búsquedas cruzadas (ej: ["BJJ", "MMA", "Venum"])
}

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
    stock: {
      type: Number,
      required: true,
    },
    category: {
      type: String,
      required: true,
      enum: Object.values(Categoria), 
      index: true 
    },
    subcategoria: {
      type: String,
      required: true,
      trim: true
    },
    marca: {
      type: String,
      trim: true
    },
    imagenes: {
      type: [String],
      default: [],
      required: true,
    },
    tags: {
      type: [String],
      default: []
    }
  },
  {
    timestamps: true,
    versionKey: false,
    // Las imagenes se guardan como key del bucket. La URL publica depende del
    // entorno, asi que se resuelve aqui, en el borde de salida, en vez de
    // congelarse dentro del dato al subir el fichero.
    toJSON: {
      transform: (_doc: unknown, ret: Record<string, unknown>) => {
        const imagenes = ret['imagenes'];
        if (Array.isArray(imagenes)) {
          ret['imagenes'] = imagenes.map((img) => normalizarUrlMedia(String(img)));
        }
        return ret;
      },
    },
  },
);

// Índice de texto compuesto para el buscador global de la tienda
ProductoSchema.index({ name: "text", description: "text", subcategoria: "text", tags: "text" });

export const ProductoModelo = model<IProduct>("Producto", ProductoSchema);