/**
 * Piezas comunes para leer la query string de un listado: saneado de texto,
 * busqueda por subcadena y paginacion.
 *
 * Las usan los servicios de dominio, que son los duenos de sus consultas. Aqui
 * no hay ninguna regla de negocio: solo la traduccion de lo que llega por la
 * URL a valores con los que se puede construir un filtro.
 */

/** Texto util de la query: descarta arrays, vacios y espacios sueltos. */
export const textoDeQuery = (valor: unknown): string | undefined => {
  if (typeof valor !== 'string') return undefined;

  const limpio = valor.trim();
  return limpio === '' ? undefined : limpio;
};

/**
 * Los metacaracteres de una expresion regular llegan aqui dentro de texto que
 * ha escrito un usuario. Sin escapar, un `(a+)+$` cuelga el proceso (ReDoS) y
 * un `.` suelto amplia la busqueda en silencio.
 */
export const escaparRegex = (texto: string): string =>
  texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Coincidencia por subcadena, sin distinguir mayusculas ni acentos de teclado. */
export const regexContiene = (texto: string): RegExp =>
  new RegExp(escaparRegex(texto), 'i');

/** Solo `true` y `false` explicitos filtran; cualquier otra cosa es "sin filtrar". */
export const booleanoDeQuery = (valor: unknown): boolean | undefined => {
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  return undefined;
};

export interface Paginacion {
  pagina: number;
  limite: number;
}

/**
 * Todo listado sale paginado aunque nadie lo pida. Sin tope, el dia que el
 * catalogo crezca la respuesta se vuelve ilimitada sin que ningun cambio lo
 * avise, y el cliente acaba recibiendo mas de lo que puede pintar.
 *
 * Un valor ilegible no es un error: se cae al valor por defecto, porque la
 * paginacion es una preferencia de lectura, no parte del criterio de busqueda.
 */
export const leerPaginacion = (
  query: Record<string, unknown>,
  limitePorDefecto: number,
  limiteMaximo: number,
): Paginacion => {
  const pagina = Number(textoDeQuery(query.pagina));
  const limite = Number(textoDeQuery(query.limite));

  return {
    pagina: Number.isInteger(pagina) && pagina > 0 ? pagina : 1,
    limite:
      Number.isInteger(limite) && limite > 0
        ? Math.min(limite, limiteMaximo)
        : limitePorDefecto,
  };
};
