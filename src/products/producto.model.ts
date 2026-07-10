import { Schema, model } from "mongoose";

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
      default: ['https://res.cloudinary.com/dw6qgshkz/image/upload/v1781696078/no-image-available_gwtbah.png'],
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
  },
);

// Índice de texto compuesto para el buscador global de la tienda
ProductoSchema.index({ name: "text", description: "text", subcategoria: "text", tags: "text" });

export const ProductoModelo = model<IProduct>("Producto", ProductoSchema);