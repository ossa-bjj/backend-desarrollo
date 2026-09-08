/**
 * Manejadores HTTP de las noticias. Las consultas y las reglas viven en
 * `noticia.service.ts`; aqui solo se lee la peticion, se llama y se traduce el
 * resultado a una respuesta.
 */

import type { Request, Response } from 'express';
import * as noticias from './noticia.service';
import { sendServerError, noEncontrada, peticionInvalida } from '../shared/controller.utils';
import { deleteFromR2, keyFromPublicUrl } from '../shared/r2.utils';
// Carga la declaracion global de Express.Request.user (definida en token.utils).
import '../shared/token.utils';

const idInvalido = (res: Response): void => peticionInvalida(res, 'Identificador de noticia no válido');

const sinNoticia = (res: Response): void => noEncontrada(res, 'Noticia');

/**
 * Mongoose rechaza el documento: es una peticion mal formada, no un fallo del
 * servidor. `sendServerError` ya lo distingue, pero aqui el detalle ayuda a
 * quien escribe desde el panel.
 */
const esValidacion = (error: unknown): boolean => (error as Error)?.name === 'ValidationError';

// --- GET /api/noticias (publico: solo publicadas) ---
export const getNoticias = async (req: Request, res: Response): Promise<void> => {
  try {
    const lectura = noticias.leerFiltroPublico(req.query as Record<string, unknown>);
    if (!lectura.ok) {
      peticionInvalida(res, lectura.error);
      return;
    }

    res.status(200).json({ success: true, data: await noticias.listar(lectura.filtro) });
  } catch (error) {
    sendServerError(res, 'Error obteniendo noticias', error);
  }
};

// --- GET /api/noticias/:id (publico: solo si esta publicada) ---
// Una noticia suelta, para que su direccion se pueda compartir y abrir directa
// sin arrastrar el listado entero detras.
export const getNoticia = async (req: Request, res: Response): Promise<void> => {
  const id = noticias.leerIdNoticia(req.params['id']);
  if (!id) return idInvalido(res);

  try {
    const noticia = await noticias.buscarPublicada(id);
    if (!noticia) return sinNoticia(res);

    res.status(200).json({ success: true, data: noticia });
  } catch (error) {
    sendServerError(res, 'Error obteniendo la noticia', error);
  }
};

// --- GET /api/noticias/admin/all (admin: incluye borradores) ---
export const getNoticiasAdmin = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json({ success: true, data: await noticias.listarTodas() });
  } catch (error) {
    sendServerError(res, 'Error obteniendo noticias', error);
  }
};

// --- POST /api/noticias (admin) ---
export const crearNoticia = async (req: Request, res: Response): Promise<void> => {
  try {
    const creacion = await noticias.crearNoticia(req.body as Record<string, unknown>, req.user?.id);
    if (!creacion.ok) {
      peticionInvalida(res, creacion.error);
      return;
    }

    res.status(201).json({ success: true, data: await noticias.conAutores(creacion.noticia._id) });
  } catch (error) {
    if (esValidacion(error)) {
      res.status(400).json({ error: 'Datos de noticia no válidos', detail: (error as Error).message });
      return;
    }
    sendServerError(res, 'Error creando la noticia', error);
  }
};

// --- PUT /api/noticias/:id (admin) ---
export const actualizarNoticia = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = noticias.leerIdNoticia(req.params.id);
    if (id === null) return idInvalido(res);

    const noticia = await noticias.buscarPorId(id);
    if (!noticia) return sinNoticia(res);

    const cambio = await noticias.aplicarCambios(noticia, req.body as Record<string, unknown>, req.user?.id);
    if (!cambio.ok) {
      peticionInvalida(res, cambio.error);
      return;
    }

    await noticia.save();

    res.status(200).json({ success: true, data: await noticias.conAutores(noticia._id) });
  } catch (error) {
    if (esValidacion(error)) {
      res.status(400).json({ error: 'Datos de noticia no válidos', detail: (error as Error).message });
      return;
    }
    sendServerError(res, 'Error actualizando la noticia', error);
  }
};

// --- PATCH /api/noticias/:id/publicar (admin) ---
export const alternarPublicacionNoticia = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = noticias.leerIdNoticia(req.params.id);
    if (id === null) return idInvalido(res);

    const noticia = await noticias.buscarPorId(id);
    if (!noticia) return sinNoticia(res);

    await noticias.alternarPublicacion(noticia, req.user?.id);

    res.status(200).json({ success: true, data: await noticias.conAutores(noticia._id) });
  } catch (error) {
    sendServerError(res, 'Error cambiando el estado de publicacion', error);
  }
};

// --- DELETE /api/noticias/:id (admin) ---
export const eliminarNoticia = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = noticias.leerIdNoticia(req.params.id);
    if (id === null) return idInvalido(res);

    const noticia = await noticias.eliminarNoticia(id);
    if (!noticia) return sinNoticia(res);

    // La portada vive en el bucket desde que se copia al guardar: si no se
    // borra aqui, cada noticia eliminada deja su imagen ocupando sitio sin que
    // nada la referencie. Si el objeto ya no esta, se sigue adelante.
    if (noticia.imagenPortada) {
      try {
        await deleteFromR2(keyFromPublicUrl(noticia.imagenPortada));
      } catch (error) {
        console.warn(`No se pudo borrar la portada de la noticia ${id}:`, (error as Error).message);
      }
    }

    res.status(200).json({ success: true, data: { mensaje: 'Noticia eliminada' } });
  } catch (error) {
    sendServerError(res, 'Error eliminando la noticia', error);
  }
};
