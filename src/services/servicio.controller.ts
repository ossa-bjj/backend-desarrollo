import { Request, Response } from 'express';
import { ServicioModelo, CODIGO_SERVICIO_MIN, CODIGO_SERVICIO_MAX } from './servicio.model';
import { sendServerError } from '../shared/controller.utils';
import { uploadToR2, deleteFromR2, keyFromPublicUrl } from '../shared/r2.utils';

// Orden estable para la landing: primero el campo `orden`, luego el codigo.
const ORDEN_LISTADO = { orden: 1, codigoArticulo: 1 } as const;

// Express 5 tipa los parametros de ruta como string | string[].
const parseCodigo = (valor: string | string[]): number | null => {
  if (Array.isArray(valor)) return null;

  const codigo = Number(valor);
  if (!Number.isInteger(codigo) || codigo < CODIGO_SERVICIO_MIN || codigo > CODIGO_SERVICIO_MAX) {
    return null;
  }
  return codigo;
};

const codigoInvalido = (res: Response): void => {
  res.status(400).json({
    error: `Codigo de servicio no valido: debe ser un entero entre ${CODIGO_SERVICIO_MIN} y ${CODIGO_SERVICIO_MAX}`,
  });
};

const noEncontrado = (res: Response): void => {
  res.status(404).json({ error: 'Servicio no encontrado' });
};

// Mongoose lanza code 11000 al violar el indice unico de codigoArticulo.
const esDuplicado = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

// --- GET /api/servicios (publico: solo activos) ---
export const getServicios = async (_req: Request, res: Response): Promise<void> => {
  try {
    const servicios = await ServicioModelo.find({ activo: true }).sort(ORDEN_LISTADO);
    res.status(200).json({ success: true, data: servicios });
  } catch (error) {
    sendServerError(res, 'Error obteniendo servicios', error);
  }
};

// --- GET /api/servicios/admin/all (admin: incluye inactivos) ---
export const getServiciosAdmin = async (_req: Request, res: Response): Promise<void> => {
  try {
    const servicios = await ServicioModelo.find().sort(ORDEN_LISTADO);
    res.status(200).json({ success: true, data: servicios });
  } catch (error) {
    sendServerError(res, 'Error obteniendo servicios', error);
  }
};

// --- GET /api/servicios/search?q= (publico) ---
export const buscarServicios = async (req: Request, res: Response): Promise<void> => {
  try {
    const { q } = req.query;
    if (typeof q !== 'string' || q.trim() === '') {
      res.status(400).json({ error: 'Parametro de busqueda requerido' });
      return;
    }

    const servicios = await ServicioModelo
      .find({ activo: true, $text: { $search: q } }, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } });

    res.status(200).json({ success: true, data: servicios });
  } catch (error) {
    sendServerError(res, 'Error buscando servicios', error);
  }
};

// --- GET /api/servicios/:codigoArticulo (publico) ---
export const getServicioPorCodigo = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = parseCodigo(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const servicio = await ServicioModelo.findOne({ codigoArticulo: codigo });
    if (!servicio) return noEncontrado(res);

    res.status(200).json({ success: true, data: servicio });
  } catch (error) {
    sendServerError(res, 'Error obteniendo servicio', error);
  }
};

// --- POST /api/servicios (admin) ---
export const crearServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      codigoArticulo, nombre, precio, subcategoria,
      descripcionCorta, descripcionCompleta, modalidad,
      duracion, plazas, requiereReserva, activo, imagenes, tags, orden,
    } = req.body;

    const servicio = await new ServicioModelo({
      codigoArticulo, nombre, precio, subcategoria,
      descripcionCorta, descripcionCompleta, modalidad,
      duracion, plazas, requiereReserva, activo, imagenes, tags, orden,
    }).save();

    res.status(201).json({ success: true, message: 'Servicio creado correctamente', data: servicio });
  } catch (error) {
    if (esDuplicado(error)) {
      res.status(409).json({ error: 'Ya existe un servicio con ese codigo de articulo' });
      return;
    }
    sendServerError(res, 'Error creando servicio', error);
  }
};

// --- PUT /api/servicios/:codigoArticulo (admin) ---
export const actualizarServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = parseCodigo(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    // El codigo identifica al servicio: no se reasigna desde el body.
    const { codigoArticulo: _ignorado, ...cambios } = req.body;

    const servicio = await ServicioModelo.findOneAndUpdate(
      { codigoArticulo: codigo },
      cambios,
      { new: true, runValidators: true },
    );
    if (!servicio) return noEncontrado(res);

    res.status(200).json({ success: true, data: servicio });
  } catch (error) {
    sendServerError(res, 'Error actualizando servicio', error);
  }
};

// --- PATCH /api/servicios/:codigoArticulo/activo (admin) ---
export const alternarActivoServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = parseCodigo(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const servicio = await ServicioModelo.findOne({ codigoArticulo: codigo });
    if (!servicio) return noEncontrado(res);

    // Permite fijar el estado explicitamente o, si no llega, alternarlo.
    const { activo } = req.body;
    servicio.activo = typeof activo === 'boolean' ? activo : !servicio.activo;
    await servicio.save();

    res.status(200).json({ success: true, data: servicio });
  } catch (error) {
    sendServerError(res, 'Error cambiando el estado del servicio', error);
  }
};

// --- POST /api/servicios/:codigoArticulo/imagenes (admin) ---
export const anadirImagenesServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = parseCodigo(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const files = (req.files ?? []) as Express.Multer.File[];
    if (files.length === 0) {
      res.status(400).json({ error: 'No se enviaron imagenes' });
      return;
    }

    const urls = await Promise.all(
      files.map((f) => uploadToR2(f.buffer, f.originalname, f.mimetype)),
    );

    const servicio = await ServicioModelo.findOneAndUpdate(
      { codigoArticulo: codigo },
      { $push: { imagenes: { $each: urls } } },
      { new: true },
    );
    if (!servicio) return noEncontrado(res);

    res.status(200).json({ success: true, data: servicio });
  } catch (error) {
    sendServerError(res, 'Error subiendo imagenes del servicio', error);
  }
};

// --- DELETE /api/servicios/:codigoArticulo/imagenes (admin) ---
export const eliminarImagenServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = parseCodigo(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'Se requiere la URL de la imagen a eliminar' });
      return;
    }

    // Si el fichero ya no esta en R2 seguimos adelante y limpiamos la referencia.
    try { await deleteFromR2(keyFromPublicUrl(url)); } catch { /* noop */ }

    const servicio = await ServicioModelo.findOneAndUpdate(
      { codigoArticulo: codigo },
      { $pull: { imagenes: url } },
      { new: true },
    );
    if (!servicio) return noEncontrado(res);

    res.status(200).json({ success: true, data: servicio });
  } catch (error) {
    sendServerError(res, 'Error eliminando la imagen del servicio', error);
  }
};

// --- DELETE /api/servicios/:codigoArticulo (admin) ---
export const eliminarServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = parseCodigo(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const servicio = await ServicioModelo.findOneAndDelete({ codigoArticulo: codigo });
    if (!servicio) return noEncontrado(res);

    // Las imagenes se borran del bucket para no dejar huerfanos.
    await Promise.all(
      servicio.imagenes.map(async (url) => {
        try { await deleteFromR2(keyFromPublicUrl(url)); } catch { /* noop */ }
      }),
    );

    res.status(200).json({ success: true, message: 'Servicio eliminado' });
  } catch (error) {
    sendServerError(res, 'Error eliminando servicio', error);
  }
};
