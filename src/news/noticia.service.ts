import { Types } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import type { INoticia } from './noticia.model';
import { NoticiaModelo, CategoriaNoticia, AccionHistorial } from './noticia.model';
import { enlaceDePostDeInstagram, resolverPortada } from '../shared/imagenRemota';

/**
 * Consultas y reglas de las noticias.
 *
 * Mismo reparto que en productos y servicios: el controlador lee la peticion,
 * llama aqui y traduce el resultado a HTTP. Aqui no hay `Request` ni `Response`.
 */

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

type Noticia = HydratedDocument<INoticia>;

/** Resultado de una operacion que puede rechazar la peticion por su contenido. */
export type Resultado = { ok: true } | { ok: false; error: string };

export const esCategoria = (valor: unknown): valor is CategoriaNoticia =>
  typeof valor === 'string' && Object.values(CategoriaNoticia).includes(valor as CategoriaNoticia);

const normalizarTags = (valor: unknown): string[] | undefined => {
  if (valor === undefined) return undefined;
  if (!Array.isArray(valor)) return [];
  return valor.map((t) => String(t).trim()).filter(Boolean);
};

/** Lee un identificador de noticia de la ruta. `null` si no es uno valido. */
export const leerIdNoticia = (valor: string | string[] | undefined): string | null => {
  if (typeof valor !== 'string') return null;
  return Types.ObjectId.isValid(valor) ? valor : null;
};

/**
 * Lo que ilustra una noticia: o un post de Instagram insertado, o una imagen
 * copiada al bucket. Nunca las dos, para que el frontend no tenga que decidir.
 */
interface Ilustracion {
  imagenPortada: string;
  instagramPost: string;
}

/**
 * El panel tiene un unico campo y admite las dos cosas, porque para quien
 * escribe la noticia es lo mismo: pegar lo que ha copiado. Aqui se distingue.
 *
 * Un post de Instagram se guarda como enlace y lo monta su propio script; asi
 * la foto se ve entera, mientras que la miniatura que Instagram publica en la
 * pagina del post viene recortada a un cuadrado y no hay forma de pedirla sin
 * recortar. Cualquier otro enlace se trata como imagen y se copia al bucket.
 */
const resolverIlustracion = async (valor: unknown, nombreBase: string): Promise<Ilustracion> => {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) return { imagenPortada: '', instagramPost: '' };

  const post = enlaceDePostDeInstagram(texto);
  if (post) return { imagenPortada: '', instagramPost: post };

  return { imagenPortada: await resolverPortada(texto, nombreBase), instagramPost: '' };
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
  fecha: new Date(),
  autor: autorId ? new Types.ObjectId(autorId) : null,
  accion,
  snapshot: {
    titulo: noticia.titulo,
    contenido: noticia.contenido,
    publicada: noticia.publicada,
  },
});

/* ── Lectura ───────────────────────────────────────────────────────────────── */

export type FiltroPublico = { ok: true; filtro: Record<string, unknown> } | { ok: false; error: string };

/** Traduce la query publica a un filtro. Solo se listan noticias publicadas. */
export const leerFiltroPublico = (query: Record<string, unknown>): FiltroPublico => {
  const { categoria, q } = query;
  const filtro: Record<string, unknown> = { publicada: true };

  if (typeof categoria === 'string' && categoria.trim() !== '') {
    if (!esCategoria(categoria)) return { ok: false, error: 'Categoría de noticia no válida' };
    filtro.categoria = categoria;
  }

  if (typeof q === 'string' && q.trim() !== '') {
    filtro.$text = { $search: q.trim() };
  }

  return { ok: true, filtro };
};

export const listar = (filtro: Record<string, unknown>) =>
  NoticiaModelo.find(filtro).sort(ORDEN_LISTADO).populate(RUTAS_AUTOR.slice());

/** Todas, incluidos los borradores: la vista de administracion. */
export const listarTodas = () => NoticiaModelo.find().sort(ORDEN_LISTADO).populate(RUTAS_AUTOR.slice());

/**
 * Una noticia publicada por su id.
 *
 * Un borrador no se distingue de algo inexistente a proposito: decir "existe
 * pero no puedes verla" convertiria la ruta en un detector de noticias sin
 * publicar.
 */
export const buscarPublicada = (id: string) =>
  NoticiaModelo.findOne({ _id: id, publicada: true }).populate(RUTAS_AUTOR.slice());

export const buscarPorId = (id: string) => NoticiaModelo.findById(id);

/** Vuelve a leerla con los autores poblados, que es la forma que espera el cliente. */
export const conAutores = (id: Types.ObjectId | string) =>
  NoticiaModelo.findById(id).populate(RUTAS_AUTOR.slice());

/* ── Escritura ─────────────────────────────────────────────────────────────── */

/**
 * Crea una noticia a partir del cuerpo de la peticion.
 *
 * Nace siempre como borrador: publicar es un acto explicito y aparte. Devuelve
 * el motivo del rechazo cuando el contenido no vale —categoria desconocida o
 * una portada que no se puede resolver—, para que el controlador responda 400.
 */
export const crearNoticia = async (
  cuerpo: Record<string, unknown>,
  autorId: string | undefined,
): Promise<{ ok: true; noticia: Noticia } | { ok: false; error: string }> => {
  const {
    titulo,
    extracto,
    contenido,
    imagenPortada,
    categoria,
    fechaEvento,
    horaInicio,
    horaFin,
    lugar,
    tags,
  } = cuerpo;

  if (categoria !== undefined && !esCategoria(categoria)) {
    return { ok: false, error: 'Categoría de noticia no válida' };
  }

  let ilustracion: Ilustracion;
  try {
    ilustracion = await resolverIlustracion(imagenPortada, String(titulo ?? 'portada'));
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  const noticia = new NoticiaModelo({
    titulo,
    extracto,
    contenido,
    imagenPortada: ilustracion.imagenPortada,
    instagramPost: ilustracion.instagramPost,
    categoria: categoria ?? CategoriaNoticia.GENERAL,
    fechaEvento,
    horaInicio,
    horaFin,
    lugar,
    publicada: false,
    autor: autorId ? new Types.ObjectId(autorId) : null,
    tags: normalizarTags(tags) ?? [],
  });

  noticia.historial.push(entradaHistorial(noticia, AccionHistorial.CREADA, autorId));
  await noticia.save();

  return { ok: true, noticia };
};

/**
 * Aplica los campos presentes en el cuerpo sobre una noticia ya cargada y
 * anota el cambio en su historial.
 *
 * Se distingue "no viene" de "viene vacio": `undefined` deja el campo como
 * estaba, y una cadena vacia en `fechaEvento` lo borra. No guarda: eso lo hace
 * quien llama, para poder tratar los errores de validacion juntos.
 */
export const aplicarCambios = async (
  noticia: Noticia,
  cuerpo: Record<string, unknown>,
  autorId: string | undefined,
): Promise<Resultado> => {
  const {
    titulo,
    extracto,
    contenido,
    imagenPortada,
    categoria,
    fechaEvento,
    horaInicio,
    horaFin,
    lugar,
    tags,
  } = cuerpo;

  if (categoria !== undefined) {
    if (!esCategoria(categoria)) return { ok: false, error: 'Categoría de noticia no válida' };
    noticia.categoria = categoria;
  }

  if (titulo !== undefined) noticia.titulo = titulo as string;
  if (extracto !== undefined) noticia.extracto = extracto as string;
  if (contenido !== undefined) noticia.contenido = contenido as string;

  if (imagenPortada !== undefined) {
    try {
      const ilustracion = await resolverIlustracion(imagenPortada, noticia.titulo);
      noticia.imagenPortada = ilustracion.imagenPortada;
      noticia.instagramPost = ilustracion.instagramPost;
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  if (fechaEvento !== undefined) {
    noticia.fechaEvento = fechaEvento === '' ? undefined : (fechaEvento as Date);
  }
  if (horaInicio !== undefined) noticia.horaInicio = horaInicio as string;
  if (horaFin !== undefined) noticia.horaFin = horaFin as string;
  if (lugar !== undefined) noticia.lugar = lugar as string;

  const tagsNormalizados = normalizarTags(tags);
  if (tagsNormalizados !== undefined) noticia.tags = tagsNormalizados;

  noticia.historial.push(entradaHistorial(noticia, AccionHistorial.EDITADA, autorId));
  return { ok: true };
};

/** Invierte el estado de publicacion y lo deja anotado en el historial. */
export const alternarPublicacion = async (noticia: Noticia, autorId: string | undefined): Promise<void> => {
  noticia.publicada = !noticia.publicada;

  const accion = noticia.publicada ? AccionHistorial.PUBLICADA : AccionHistorial.DESPUBLICADA;
  noticia.historial.push(entradaHistorial(noticia, accion, autorId));
  await noticia.save();
};

export const eliminarNoticia = (id: string) => NoticiaModelo.findByIdAndDelete(id);
