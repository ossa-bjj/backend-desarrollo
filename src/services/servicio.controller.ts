/**
 * Manejadores HTTP del catalogo de servicios. Las consultas y las reglas viven
 * en `servicio.service.ts`; aqui solo se lee la peticion, se llama y se traduce
 * el resultado a una respuesta.
 */

import type { Request, Response } from 'express';
import { CODIGO_SERVICIO_MIN, CODIGO_SERVICIO_MAX } from './servicio.model';
import * as servicios from './servicio.service';
import {
  sendServerError,
  noEncontrado,
  peticionInvalida,
  conflicto,
  esDuplicado,
} from '../shared/controller.utils';
import { uploadToR2, deleteFromR2, keyFromPublicUrl } from '../shared/r2.utils';

const codigoInvalido = (res: Response): void =>
  peticionInvalida(
    res,
    `Código de servicio no válido: debe ser un entero entre ${CODIGO_SERVICIO_MIN} y ${CODIGO_SERVICIO_MAX}`,
  );

const sinServicio = (res: Response): void => noEncontrado(res, 'Servicio');

/** Borra un objeto del bucket sin propagar el fallo: la referencia ya no existe. */
const borrarDelBucket = async (url: string): Promise<void> => {
  try {
    await deleteFromR2(keyFromPublicUrl(url));
  } catch {
    /* si el fichero ya no esta en R2, no hay nada que hacer */
  }
};

// --- GET /api/servicios (publico: solo activos) ---
export const getServicios = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json({ success: true, data: await servicios.listarActivos() });
  } catch (error) {
    sendServerError(res, 'Error obteniendo servicios', error);
  }
};

// --- GET /api/servicios/admin/all (admin: incluye inactivos) ---
export const getServiciosAdmin = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json({ success: true, data: await servicios.listarTodos() });
  } catch (error) {
    sendServerError(res, 'Error obteniendo servicios', error);
  }
};

// --- GET /api/servicios/search?q= (publico) ---
export const buscarServicios = async (req: Request, res: Response): Promise<void> => {
  try {
    const { q } = req.query;
    if (typeof q !== 'string' || q.trim() === '') {
      peticionInvalida(res, 'Parámetro de búsqueda requerido');
      return;
    }

    res.status(200).json({ success: true, data: await servicios.buscarPorTexto(q) });
  } catch (error) {
    sendServerError(res, 'Error buscando servicios', error);
  }
};

// --- GET /api/servicios/:codigoArticulo (publico) ---
export const getServicioPorCodigo = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = servicios.leerCodigoServicio(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const servicio = await servicios.buscarPorCodigo(codigo);
    if (!servicio) return sinServicio(res);

    res.status(200).json({ success: true, data: servicio });
  } catch (error) {
    sendServerError(res, 'Error obteniendo servicio', error);
  }
};

// --- POST /api/servicios (admin) ---
export const crearServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    // El codigo se acepta del cuerpo porque en el alta si lo elige el admin; el
    // resto de campos pasa por la lista blanca del servicio.
    const servicio = await servicios.crearServicio({
      codigoArticulo: req.body?.codigoArticulo,
      ...servicios.soloCamposActualizables(req.body),
    });

    res.status(201).json({ success: true, message: 'Servicio creado correctamente', data: servicio });
  } catch (error) {
    if (esDuplicado(error)) {
      conflicto(res, 'Ya existe un servicio con ese código de artículo');
      return;
    }
    sendServerError(res, 'Error creando servicio', error);
  }
};

// --- PUT /api/servicios/:codigoArticulo (admin) ---
export const actualizarServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = servicios.leerCodigoServicio(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const servicio = await servicios.actualizarServicio(codigo, servicios.soloCamposActualizables(req.body));
    if (!servicio) return sinServicio(res);

    res.status(200).json({ success: true, data: servicio });
  } catch (error) {
    sendServerError(res, 'Error actualizando servicio', error);
  }
};

// --- PATCH /api/servicios/:codigoArticulo/activo (admin) ---
export const alternarActivoServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = servicios.leerCodigoServicio(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    // Permite fijar el estado explicitamente o, si no llega, alternarlo.
    const servicio = await servicios.alternarActivo(codigo, req.body?.activo);
    if (!servicio) return sinServicio(res);

    res.status(200).json({ success: true, data: servicio });
  } catch (error) {
    sendServerError(res, 'Error cambiando el estado del servicio', error);
  }
};

// --- POST /api/servicios/:codigoArticulo/imagenes (admin) ---
export const anadirImagenesServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = servicios.leerCodigoServicio(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const files = (req.files ?? []) as Express.Multer.File[];
    if (files.length === 0) {
      peticionInvalida(res, 'No se enviaron imágenes');
      return;
    }

    const urls = await Promise.all(files.map((f) => uploadToR2(f.buffer, f.originalname, f.mimetype)));

    const servicio = await servicios.anadirImagenes(codigo, urls);
    if (!servicio) return sinServicio(res);

    res.status(200).json({ success: true, data: servicio });
  } catch (error) {
    sendServerError(res, 'Error subiendo imagenes del servicio', error);
  }
};

// --- DELETE /api/servicios/:codigoArticulo/imagenes (admin) ---
export const eliminarImagenServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = servicios.leerCodigoServicio(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      peticionInvalida(res, 'Se requiere la URL de la imagen a eliminar');
      return;
    }

    // La base de datos manda: el `$pull` solo casa si la imagen es de ESTE
    // servicio. Solo entonces se borra el objeto del bucket.
    const servicio = await servicios.quitarImagen(codigo, url);
    if (!servicio) {
      res.status(404).json({ error: 'El servicio no existe o no tiene esa imagen' });
      return;
    }

    await borrarDelBucket(url);

    res.status(200).json({ success: true, data: servicio });
  } catch (error) {
    sendServerError(res, 'Error eliminando la imagen del servicio', error);
  }
};

// --- DELETE /api/servicios/:codigoArticulo (admin) ---
export const eliminarServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = servicios.leerCodigoServicio(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const servicio = await servicios.eliminarServicio(codigo);
    if (!servicio) return sinServicio(res);

    // Las imagenes se borran del bucket para no dejar huerfanos.
    await Promise.all(servicio.imagenes.map(borrarDelBucket));

    res.status(200).json({ success: true, message: 'Servicio eliminado' });
  } catch (error) {
    sendServerError(res, 'Error eliminando servicio', error);
  }
};
