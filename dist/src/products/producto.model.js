import { Schema, model } from "mongoose";
export var Categoria;
(function (Categoria) {
    Categoria["PROTECCIONES"] = "PROTECCIONES";
    Categoria["ROPA_ENTRENAMIENTO"] = "ROPA_ENTRENAMIENTO";
    Categoria["ROPA_CALLE"] = "ROPA_CALLE";
    Categoria["CALZADO"] = "CALZADO";
    Categoria["ACCESORIOS"] = "ACCESORIOS"; // Mochilas, cinturones, gorras, complementos
})(Categoria || (Categoria = {}));
// 3. Esquema de Mongoose
const ProductoSchema = new Schema({
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
}, {
    timestamps: true,
    versionKey: false,
});
// Índice de texto compuesto para el buscador global de la tienda
ProductoSchema.index({ name: "text", description: "text", subcategoria: "text", tags: "text" });
export const ProductoModelo = model("Producto", ProductoSchema);
