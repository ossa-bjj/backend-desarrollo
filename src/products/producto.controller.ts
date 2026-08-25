import { Request, Response } from 'express';
import { ProductoModelo } from './producto.model';
import { CODIGO_SERVICIO_MIN, CODIGO_SERVICIO_MAX } from '../services/servicio.model';
import { sendServerError } from '../shared/controller.utils';
import { uploadToR2, deleteFromR2, keyFromPublicUrl } from '../shared/r2.utils';

// Express 5 tipa los parametros de ruta como string | string[].
// Los codigos 60XX pertenecen a los servicios, que viven en otra coleccion.
const parseCodigo = (valor: string | string[]): number | null => {
  if (Array.isArray(valor)) return null;

  const codigo = Number(valor);
  if (!Number.isInteger(codigo) || codigo <= 0) return null;
  if (codigo >= CODIGO_SERVICIO_MIN && codigo <= CODIGO_SERVICIO_MAX) return null;

  return codigo;
};

const codigoInvalido = (res: Response): void => {
  res.status(400).json({
    error: `Codigo de articulo no valido: debe ser un entero positivo fuera del rango ${CODIGO_SERVICIO_MIN}-${CODIGO_SERVICIO_MAX}, reservado a los servicios`,
  });
};

const noEncontrado = (res: Response): void => {
  res.status(404).json({ error: 'Producto no encontrado' });
};

// Mongoose lanza code 11000 al violar el indice unico de codigoArticulo.
const esDuplicado = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

// --- GET /api/productos (publico) ---
export const getProductos = async (_req: Request, res: Response): Promise<void> => {
  try {
    const productos = await ProductoModelo.find();
    res.status(200).json({ success: true, data: productos });
  } catch (error) {
    sendServerError(res, 'Error obteniendo productos', error);
  }
};

// --- GET /api/productos/search?q= (publico) ---
export const buscarProductos = async (req: Request, res: Response): Promise<void> => {
  try {
    const { q } = req.query;
    if (typeof q !== 'string' || q.trim() === '') {
      res.status(400).json({ error: 'Parametro de busqueda requerido' });
      return;
    }

    const productos = await ProductoModelo
      .find({ $text: { $search: q } }, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } });

    res.status(200).json({ success: true, data: productos });
  } catch (error) {
    sendServerError(res, 'Error buscando productos', error);
  }
};

// --- GET /api/productos/destacados (publico) ---
export const getProductosDestacados = async (_req: Request, res: Response): Promise<void> => {
  try {
    const productos = await ProductoModelo.find({ tags: 'destacado' });
    res.status(200).json({ success: true, data: productos });
  } catch (error) {
    sendServerError(res, 'Error obteniendo productos destacados', error);
  }
};

// --- GET /api/productos/categoria/:categoria (publico) ---
export const getProductosPorCategoria = async (req: Request, res: Response): Promise<void> => {
  try {
    const { categoria } = req.params;
    const productos = await ProductoModelo.find({ category: categoria });
    res.status(200).json({ success: true, data: productos });
  } catch (error) {
    sendServerError(res, 'Error obteniendo productos por categoria', error);
  }
};

// --- GET /api/productos/marca/:marca (publico) ---
export const getProductosPorMarca = async (req: Request, res: Response): Promise<void> => {
  try {
    const { marca } = req.params;
    const productos = await ProductoModelo.find({ marca: new RegExp(String(marca), 'i') });
    res.status(200).json({ success: true, data: productos });
  } catch (error) {
    sendServerError(res, 'Error obteniendo productos por marca', error);
  }
};

// --- GET /api/productos/:codigoArticulo (publico) ---
export const getProductoPorCodigo = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = parseCodigo(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const producto = await ProductoModelo.findOne({ codigoArticulo: codigo });
    if (!producto) return noEncontrado(res);

    res.status(200).json({ success: true, data: producto });
  } catch (error) {
    sendServerError(res, 'Error obteniendo producto', error);
  }
};

// --- POST /api/productos (admin) ---
export const crearProducto = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      codigoArticulo, name, price, description, stock,
      category, subcategoria, marca, imagenes, tags,
    } = req.body;

    const producto = await new ProductoModelo({
      codigoArticulo, name, price, description, stock,
      category, subcategoria, marca, imagenes, tags,
    }).save();

    res.status(201).json({ success: true, message: 'Producto creado correctamente', data: producto });
  } catch (error) {
    if (esDuplicado(error)) {
      res.status(409).json({ error: 'Ya existe un producto con ese codigo de articulo' });
      return;
    }
    sendServerError(res, 'Error creando producto', error);
  }
};

// --- PUT /api/productos/:codigoArticulo (admin) ---
export const actualizarProducto = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = parseCodigo(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    // El codigo identifica al producto: no se reasigna desde el body.
    const { codigoArticulo: _ignorado, ...cambios } = req.body;

    const producto = await ProductoModelo.findOneAndUpdate(
      { codigoArticulo: codigo },
      cambios,
      { new: true, runValidators: true },
    );
    if (!producto) return noEncontrado(res);

    res.status(200).json({ success: true, data: producto });
  } catch (error) {
    sendServerError(res, 'Error actualizando producto', error);
  }
};

// --- PATCH /api/productos/:codigoArticulo/stock (admin) ---
export const actualizarStock = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = parseCodigo(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const { stock } = req.body;
    if (typeof stock !== 'number' || !Number.isInteger(stock) || stock < 0) {
      res.status(400).json({ error: 'El stock debe ser un entero mayor o igual a 0' });
      return;
    }

    const producto = await ProductoModelo.findOneAndUpdate(
      { codigoArticulo: codigo },
      { stock },
      { new: true, runValidators: true },
    );
    if (!producto) return noEncontrado(res);

    res.status(200).json({ success: true, data: producto });
  } catch (error) {
    sendServerError(res, 'Error actualizando el stock', error);
  }
};

// --- POST /api/productos/:codigoArticulo/imagenes (admin) ---
export const anadirImagenes = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = parseCodigo(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const files = (req.files ?? []) as Express.Multer.File[];
    if (files.length === 0) {
      res.status(400).json({ error: 'No se enviaron imagenes' });
      return;
    }

    // Solo se sube a R2 despues de saber que el producto existe: evita dejar
    // objetos huerfanos en el bucket por un codigo equivocado.
    const producto = await ProductoModelo.findOne({ codigoArticulo: codigo });
    if (!producto) return noEncontrado(res);

    const urls = await Promise.all(
      files.map((f) => uploadToR2(f.buffer, f.originalname, f.mimetype)),
    );

    producto.imagenes.push(...urls);
    await producto.save();

    res.status(200).json({ success: true, data: producto });
  } catch (error) {
    sendServerError(res, 'Error subiendo las imagenes', error);
  }
};

// --- DELETE /api/productos/:codigoArticulo/imagenes (admin) ---
export const eliminarImagen = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = parseCodigo(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const { url } = req.body;
    if (typeof url !== 'string' || !url) {
      res.status(400).json({ error: 'Se requiere la URL de la imagen a eliminar' });
      return;
    }

    // Se quita primero la referencia y solo despues se borra el objeto: si la
    // imagen no pertenece a este producto, el bucket no se toca.
    const producto = await ProductoModelo.findOneAndUpdate(
      { codigoArticulo: codigo, imagenes: url },
      { $pull: { imagenes: url } },
      { new: true },
    );
    if (!producto) {
      res.status(404).json({ error: 'El producto no existe o no tiene esa imagen' });
      return;
    }

    try { await deleteFromR2(keyFromPublicUrl(url)); } catch { /* el objeto ya no estaba en R2 */ }

    res.status(200).json({ success: true, data: producto });
  } catch (error) {
    sendServerError(res, 'Error eliminando la imagen', error);
  }
};

// --- DELETE /api/productos/:codigoArticulo (admin) ---
export const eliminarProducto = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = parseCodigo(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const producto = await ProductoModelo.findOneAndDelete({ codigoArticulo: codigo });
    if (!producto) return noEncontrado(res);

    res.status(200).json({ success: true, message: 'Producto eliminado' });
  } catch (error) {
    sendServerError(res, 'Error eliminando producto', error);
  }
};
