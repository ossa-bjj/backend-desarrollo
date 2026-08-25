import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { NoticiaModelo, CategoriaNoticia, AccionHistorial, INoticia } from './noticia.model';
import { sendServerError } from '../shared/controller.utils';
// Carga la declaracion global de Express.Request.user (definida en token.utils).
import '../shared/token.utils';

// La portada muestra primero lo mas reciente.
const ORDEN_LISTADO = { createdAt: -1 } as const;

// El frontend espera el autor como { _id, username }, tanto en la noticia como
// en cada entrada del historial.
const AUTOR_POPULADO = 'username' as const;

// Las dos rutas de autor se pueblan siempre juntas: la noticia y su historial.
const RUTAS_AUTOR = [
  { path: 'autor', select: AUTOR_POPULADO },
  { path: 'historial.autor', select: AUTOR_POPULADO },
] as const;

const noEncontrada = (res: Response): void => {
  res.status(404).json({ error: 'Noticia no encontrada' });
};

const idInvalido = (res: Response): void => {
  res.status(400).json({ error: 'Identificador de noticia no valido' });
};

// Express 5 tipa los parametros de ruta como string | string[].
const parseId = (valor: string | string[]): string | null => {
  if (Array.isArray(valor)) return null;
  return Types.ObjectId.isValid(valor) ? valor : null;
};

const esCategoria = (valor: unknown): valor is CategoriaNoticia =>
  typeof valor === 'string' && Object.values(CategoriaNoticia).includes(valor as CategoriaNoticia);

const normalizarTags = (valor: unknown): string[] | undefined => {
  if (valor === undefined) return undefined;
  if (!Array.isArray(valor)) return [];
  return valor.map((t) => String(t).trim()).filter(Boolean);
};

/**
 * Una entrada de historial es una foto del estado en el momento del cambio.
 * Se construye siempre a partir de la noticia ya modificada.
 */
const entradaHistorial = (
  noticia: Pick<INoticia, 'titulo' | 'contenido' | 'publicada'>,
  accion: AccionHistorial,
  autorId: string | undefined,
) => ({
  fecha:    new Date(),
  autor:    autorId ? new Types.ObjectId(autorId) : null,
  accion,
  snapshot: {
    titulo:    noticia.titulo,
    contenido: noticia.contenido,
    publicada: noticia.publicada,
  },
});

// --- GET /api/noticias (publico: solo publicadas) ---
export const getNoticias = async (req: Request, res: Response): Promise<void> => {
  try {
    const { categoria, q } = req.query;

    const filtro: Record<string, unknown> = { publicada: true };

    if (typeof categoria === 'string' && categoria.trim() !== '') {
      if (!esCategoria(categoria)) {
        res.status(400).json({ error: 'Categoria de noticia no valida' });
        return;
      }
      filtro.categoria = categoria;
    }

    if (typeof q === 'string' && q.trim() !== '') {
      filtro.$text = { $search: q.trim() };
    }

    const noticias = await NoticiaModelo.find(filtro).sort(ORDEN_LISTADO).populate(RUTAS_AUTOR.slice());
    res.status(200).json({ success: true, data: noticias });
  } catch (error) {
    sendServerError(res, 'Error obteniendo noticias', error);
  }
};

// --- GET /api/noticias/admin/all (admin: incluye borradores) ---
export const getNoticiasAdmin = async (_req: Request, res: Response): Promise<void> => {
  try {
    const noticias = await NoticiaModelo.find().sort(ORDEN_LISTADO).populate(RUTAS_AUTOR.slice());
    res.status(200).json({ success: true, data: noticias });
  } catch (error) {
    sendServerError(res, 'Error obteniendo noticias', error);
  }
};

// --- POST /api/noticias (admin) ---
export const crearNoticia = async (req: Request, res: Response): Promise<void> => {
  try {
    const { titulo, extracto, contenido, imagenPortada, categoria, fechaEvento, horaInicio, horaFin, lugar, tags } =
      req.body;

    if (categoria !== undefined && !esCategoria(categoria)) {
      res.status(400).json({ error: 'Categoria de noticia no valida' });
      return;
    }

    const autorId = req.user?.id;

    const noticia = new NoticiaModelo({
      titulo,
      extracto,
      contenido,
      imagenPortada,
      categoria: categoria ?? CategoriaNoticia.GENERAL,
      fechaEvento,
      horaInicio,
      horaFin,
      lugar,
      // Nace como borrador: publicar es un acto explicito (PATCH /publicar).
      publicada: false,
      autor: autorId ? new Types.ObjectId(autorId) : null,
      tags: normalizarTags(tags) ?? [],
    });

    noticia.historial.push(entradaHistorial(noticia, AccionHistorial.CREADA, autorId));
    await noticia.save();

    const creada = await NoticiaModelo.findById(noticia._id).populate(RUTAS_AUTOR.slice());
    res.status(201).json({ success: true, data: creada });
  } catch (error) {
    if ((error as Error).name === 'ValidationError') {
      res.status(400).json({ error: 'Datos de noticia no validos', detail: (error as Error).message });
      return;
    }
    sendServerError(res, 'Error creando la noticia', error);
  }
};

// --- PUT /api/noticias/:id (admin) ---
export const actualizarNoticia = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return idInvalido(res);

    const noticia = await NoticiaModelo.findById(id);
    if (!noticia) return noEncontrada(res);

    const { titulo, extracto, contenido, imagenPortada, categoria, fechaEvento, horaInicio, horaFin, lugar, tags } =
      req.body;

    if (categoria !== undefined) {
      if (!esCategoria(categoria)) {
        res.status(400).json({ error: 'Categoria de noticia no valida' });
        return;
      }
      noticia.categoria = categoria;
    }

    if (titulo !== undefined) noticia.titulo = titulo;
    if (extracto !== undefined) noticia.extracto = extracto;
    if (contenido !== undefined) noticia.contenido = contenido;
    if (imagenPortada !== undefined) noticia.imagenPortada = imagenPortada;
    if (fechaEvento !== undefined) noticia.fechaEvento = fechaEvento === '' ? undefined : fechaEvento;
    if (horaInicio !== undefined) noticia.horaInicio = horaInicio;
    if (horaFin !== undefined) noticia.horaFin = horaFin;
    if (lugar !== undefined) noticia.lugar = lugar;

    const tagsNormalizados = normalizarTags(tags);
    if (tagsNormalizados !== undefined) noticia.tags = tagsNormalizados;

    noticia.historial.push(entradaHistorial(noticia, AccionHistorial.EDITADA, req.user?.id));
    await noticia.save();

    const actualizada = await NoticiaModelo.findById(noticia._id).populate(RUTAS_AUTOR.slice());
    res.status(200).json({ success: true, data: actualizada });
  } catch (error) {
    if ((error as Error).name === 'ValidationError') {
      res.status(400).json({ error: 'Datos de noticia no validos', detail: (error as Error).message });
      return;
    }
    sendServerError(res, 'Error actualizando la noticia', error);
  }
};

// --- PATCH /api/noticias/:id/publicar (admin) ---
export const alternarPublicacionNoticia = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return idInvalido(res);

    const noticia = await NoticiaModelo.findById(id);
    if (!noticia) return noEncontrada(res);

    noticia.publicada = !noticia.publicada;

    const accion = noticia.publicada ? AccionHistorial.PUBLICADA : AccionHistorial.DESPUBLICADA;
    noticia.historial.push(entradaHistorial(noticia, accion, req.user?.id));
    await noticia.save();

    const cambiada = await NoticiaModelo.findById(noticia._id).populate(RUTAS_AUTOR.slice());
    res.status(200).json({ success: true, data: cambiada });
  } catch (error) {
    sendServerError(res, 'Error cambiando el estado de publicacion', error);
  }
};

// --- DELETE /api/noticias/:id (admin) ---
export const eliminarNoticia = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return idInvalido(res);

    const noticia = await NoticiaModelo.findByIdAndDelete(id);
    if (!noticia) return noEncontrada(res);

    res.status(200).json({ success: true, data: { mensaje: 'Noticia eliminada' } });
  } catch (error) {
    sendServerError(res, 'Error eliminando la noticia', error);
  }
};
