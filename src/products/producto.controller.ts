import { Request, Response } from 'express';
import { PREFIJO_CATEGORIA, esCategoria } from './producto.model';
import { CODIGO_SERVICIO_MIN, CODIGO_SERVICIO_MAX } from '../services/servicio.model';
import * as productos from './producto.service';
import { sendServerError } from '../shared/controller.utils';
import { uploadToR2, deleteFromR2, keyFromPublicUrl } from '../shared/r2.utils';

// Express 5 tipa los parametros de ruta como string | string[].
const parseCodigo = (valor: string | string[]): number | null => {
  if (Array.isArray(valor)) return null;

  const codigo = Number(valor);
  return productos.esCodigoDeProducto(codigo) ? codigo : null;
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

// --- GET /api/productos?categoria=&codigo=&nombre=&marca=&q=&destacado=&pagina=&limite= (publico) ---
export const getProductos = async (req: Request, res: Response): Promise<void> => {
  try {
    const lectura = productos.leerCriteriosProducto(req.query);
    if (!lectura.ok) {
      res.status(400).json({ error: lectura.error });
      return;
    }

    const { productos: encontrados, total, pagina, limite } =
      await productos.listarProductos(lectura.criterios);

    res.status(200).json({
      success: true,
      data:    encontrados,
      meta:    { total, pagina, limite },
    });
  } catch (error) {
    sendServerError(res, 'Error obteniendo productos', error);
  }
};

// --- GET /api/productos/siguiente-codigo?categoria= (admin) ---
export const getSiguienteCodigo = async (req: Request, res: Response): Promise<void> => {
  try {
    const { categoria } = req.query;
    if (!esCategoria(categoria)) {
      res.status(400).json({ error: 'Se requiere una categoria valida' });
      return;
    }

    const codigo = await productos.siguienteCodigoLibre(categoria);
    if (codigo === null) {
      res.status(409).json({
        error: `La serie de codigos ${PREFIJO_CATEGORIA[categoria]}XX de ${categoria} esta agotada`,
      });
      return;
    }

    res.status(200).json({ success: true, data: { codigo } });
  } catch (error) {
    sendServerError(res, 'Error calculando el siguiente codigo libre', error);
  }
};

// --- GET /api/productos/:codigoArticulo (publico) ---
export const getProductoPorCodigo = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = parseCodigo(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const producto = await productos.buscarPorCodigo(codigo);
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

    const invalido = productos.validarCodigoYCategoria(codigoArticulo, category);
    if (invalido) {
      res.status(400).json({ error: invalido });
      return;
    }

    const producto = await productos.crearProducto({
      codigoArticulo: Number(codigoArticulo), name, price, description, stock,
      category, subcategoria, marca, imagenes, tags,
    });

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

    // Solo los campos conocidos: el codigo identifica al producto y no se
    // reasigna, y el cuerpo en crudo permitiria colar operadores de Mongo.
    const cambios = productos.soloCamposActualizables(req.body);

    // Como el codigo no se puede reasignar, cambiar de categoria dejaria al
    // producto con un codigo que contradice su categoria. Antes esto pasaba en
    // silencio y rompia el listado por prefijo; ahora se dice en voz alta.
    if (cambios.category !== undefined) {
      const invalido = productos.validarCodigoYCategoria(codigo, cambios.category);
      if (invalido) {
        res.status(400).json({ error: invalido });
        return;
      }
    }

    const producto = await productos.actualizarProducto(codigo, cambios);
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

    const producto = await productos.actualizarStock(codigo, stock);
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
    if (!(await productos.existePorCodigo(codigo))) return noEncontrado(res);

    const urls = await Promise.all(
      files.map((f) => uploadToR2(f.buffer, f.originalname, f.mimetype)),
    );

    const producto = await productos.anadirImagenes(codigo, urls);
    if (!producto) return noEncontrado(res);

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
    const producto = await productos.quitarImagen(codigo, url);
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

    const producto = await productos.eliminarProducto(codigo);
    if (!producto) return noEncontrado(res);

    res.status(200).json({ success: true, message: 'Producto eliminado' });
  } catch (error) {
    sendServerError(res, 'Error eliminando producto', error);
  }
};
