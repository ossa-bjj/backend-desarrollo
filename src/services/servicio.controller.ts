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
import { uploadToR2, keyFromPublicUrl } from '../shared/r2.utils';
import { borrarDeR2SiNoEstaEnUso } from '../shared/media.utils';

const codigoInvalido = (res: Response): void =>
  peticionInvalida(
    res,
    `Código de servicio no válido: debe ser un entero entre ${CODIGO_SERVICIO_MIN} y ${CODIGO_SERVICIO_MAX}`,
  );

const sinServicio = (res: Response): void => noEncontrado(res, 'Servicio');

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
    let urlsOKeys: string[] = [];

    if (files.length > 0) {
      urlsOKeys = await Promise.all(files.map((f) => uploadToR2(f.buffer, f.originalname, f.mimetype)));
    } else if (req.body?.urls && Array.isArray(req.body.urls)) {
      urlsOKeys = req.body.urls
        .filter((u: unknown): u is string => typeof u === 'string' && u.trim().length > 0)
        .map((u: string) => keyFromPublicUrl(u) || u.trim());
    } else if (typeof req.body?.url === 'string' && req.body.url.trim().length > 0) {
      const u = req.body.url.trim();
      urlsOKeys = [keyFromPublicUrl(u) || u];
    }

    if (urlsOKeys.length === 0) {
      peticionInvalida(res, 'No se enviaron imágenes');
      return;
    }

    const servicio = await servicios.anadirImagenes(codigo, urlsOKeys);
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

    const resultado = await servicios.quitarImagen(codigo, url);
    if (!resultado) {
      res.status(404).json({ error: 'El servicio no existe o no tiene esa imagen' });
      return;
    }

    // Solo borra el fichero físico de R2 si ninguna otra entidad (otro servicio o producto) lo está usando
    await borrarDeR2SiNoEstaEnUso(resultado.quitada || url);

    res.status(200).json({ success: true, data: resultado.servicio });
  } catch (error) {
    sendServerError(res, 'Error eliminando la imagen del servicio', error);
  }
};

// --- PATCH /api/servicios/:codigoArticulo/imagenes/principal (admin) ---
export const establecerImagenPrincipalServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = servicios.leerCodigoServicio(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const { url } = req.body;
    if (typeof url !== 'string' || !url) {
      peticionInvalida(res, 'Se requiere la URL o clave de la imagen a marcar como principal');
      return;
    }

    const servicio = await servicios.establecerImagenPrincipal(codigo, url);
    if (!servicio) return sinServicio(res);

    res.status(200).json({ success: true, data: servicio });
  } catch (error) {
    sendServerError(res, 'Error marcando imagen principal del servicio', error);
  }
};

// --- DELETE /api/servicios/:codigoArticulo (admin) ---
export const eliminarServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = servicios.leerCodigoServicio(req.params.codigoArticulo);
    if (codigo === null) return codigoInvalido(res);

    const servicio = await servicios.eliminarServicio(codigo);
    if (!servicio) return sinServicio(res);

    // Las imagenes se borran de R2 solo si ningun otro producto o servicio las usa
    await Promise.all(servicio.imagenes.map((img) => borrarDeR2SiNoEstaEnUso(img)));

    res.status(200).json({ success: true, message: 'Servicio eliminado' });
  } catch (error) {
    sendServerError(res, 'Error eliminando servicio', error);
  }
};
