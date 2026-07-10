import {Request, Response, NextFunction} from 'express';
import { ProductoModelo } from './producto.model';



// --- Obtener todos los productos ---

export const getProductos = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const productos = await ProductoModelo.find();
        res.status(200).json({ success: true, data: productos });
    } catch (error) {
        next(error);
    }
}

// --- Crear Producto ---
export const crearProducto = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Validación básica de campos requeridos
        const { codigoArticulo, name, price, description, stock, category, subcategoria, marca, imagenes, tags } = req.body;
        // Crear instancia
        const nuevoProducto = new ProductoModelo({
            codigoArticulo,
            name,
            price,
            description,
            stock,
            category,
            subcategoria,
            marca,
            imagenes,
            tags
        });    
        // guardamos en la base de datos
        const productoGuardado = await nuevoProducto.save();
        
        // Respondemos con el producto creado
        res.status(201).json({
            success:true,
            message: "Producto creado exitosamente",
            data: productoGuardado
        });

    } catch (error) {
        next(error); // Pasamos el error al middleware de manejo de errores

    }
}

// --- GET un producto por ID ---
export const getProductoById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { codigoArticulo } = req.params;
        const producto = await ProductoModelo.findOne({ codigoArticulo });
        if(!producto){
            res.status(404).json({ error: 'Producto no encontrado' });
            return;
        }
        res.status(200).json({ success: true, data: producto });
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo producto', detail: (error as Error).message });
    }
};

// --- UPDATE un producto ---
export const updateProducto = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { codigoArticulo } = req.params;
        const producto = await ProductoModelo.findOneAndUpdate(
            { codigoArticulo },
            req.body,
            { new: true, runValidators: true }
        );
        if (!producto) {
            res.status(404).json({ error: 'Producto no encontrado' });
            return;
        }
        res.status(200).json({ success: true, data: producto });
    } catch (error) {
        next(error);
    }
};

// --- DELETE un producto ---
export const deleteProducto = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { codigoArticulo } = req.params;
        const producto = await ProductoModelo.findOneAndDelete({ codigoArticulo });
        if (!producto) {
            res.status(404).json({ error: 'Producto no encontrado' });
            return;
        }
        res.status(200).json({ success: true, message: 'Producto eliminado' });
    } catch (error) {
        next(error);
    }
};

// --- ADD imágenes a un producto ---
export const addImagenes = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { codigoArticulo } = req.params;
        const files = ((req as any).files ?? []) as { path: string }[];

        if (files.length === 0) {
            res.status(400).json({ error: 'No se enviaron imágenes' });
            return;
        }

        const urls = files.map((f) => f.path);

        const producto = await ProductoModelo.findOneAndUpdate(
            { codigoArticulo },
            { $push: { imagenes: { $each: urls } } },
            { new: true }
        );

        if (!producto) {
            res.status(404).json({ error: 'Producto no encontrado' });
            return;
        }

        res.status(200).json({ success: true, data: producto });
    } catch (error) {
        next(error);
    }
};

// --- REMOVE imagen de un producto ---
export const removeImagen = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { codigoArticulo } = req.params;
        const { url } = req.body;

        if (!url) {
            res.status(400).json({ error: 'Se requiere la URL de la imagen a eliminar' });
            return;
        }

        const producto = await ProductoModelo.findOneAndUpdate(
            { codigoArticulo },
            { $pull: { imagenes: url } },
            { new: true }
        );

        if (!producto) {
            res.status(404).json({ error: 'Producto no encontrado' });
            return;
        }

        res.status(200).json({ success: true, data: producto });
    } catch (error) {
        next(error);
    }
};

// --- SEARCH productos por texto ---
export const searchProductos = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { q } = req.query;
        if (!q || typeof q !== 'string' || q.trim() === '') {
            res.status(400).json({ error: 'Parámetro de búsqueda requerido' });
            return;
        }
        const productos = await ProductoModelo
            .find({ $text: { $search: q } }, { score: { $meta: 'textScore' } })
            .sort({ score: { $meta: 'textScore' } });
        res.status(200).json({ success: true, data: productos });
    } catch (error) {
        next(error);
    }
};

// --- GET productos por categoría ---
export const getProductosByCategoria = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { categoria } = req.params;
        const productos = await ProductoModelo.find({ category: categoria });
        res.status(200).json({ success: true, data: productos });
    } catch (error) {
        next(error);
    }
};

// --- GET productos por marca ---
export const getProductosByMarca = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { marca } = req.params;
        const productos = await ProductoModelo.find({ marca: new RegExp(String(marca), 'i') });
        res.status(200).json({ success: true, data: productos });
    } catch (error) {
        next(error);
    }
};

// --- PATCH stock de un producto ---
export const updateStock = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { codigoArticulo } = req.params;
        const { stock } = req.body;
        if (stock === undefined || typeof stock !== 'number' || stock < 0) {
            res.status(400).json({ error: 'Stock debe ser un número mayor o igual a 0' });
            return;
        }
        const producto = await ProductoModelo.findOneAndUpdate(
            { codigoArticulo },
            { stock },
            { new: true, runValidators: true }
        );
        if (!producto) {
            res.status(404).json({ error: 'Producto no encontrado' });
            return;
        }
        res.status(200).json({ success: true, data: producto });
    } catch (error) {
        next(error);
    }
};

// --- GET productos destacados (tag "destacado") ---
export const getProductosDestacados = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const productos = await ProductoModelo.find({ tags: 'destacado' });
        res.status(200).json({ success: true, data: productos });
    } catch (error) {
        next(error);
    }
};
