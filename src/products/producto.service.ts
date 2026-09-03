import { FilterQuery, HydratedDocument } from 'mongoose';
import { Categoria, IProduct, PREFIJO_CATEGORIA, ProductoModelo, esCategoria } from './producto.model';
import { CODIGO_SERVICIO_MIN, CODIGO_SERVICIO_MAX } from '../services/servicio.model';
import {
  booleanoDeQuery,
  leerPaginacion,
  regexContiene,
  textoDeQuery,
} from '../shared/consulta.utils';

/**
 * Toda la logica de seleccion, filtrado y paginacion del catalogo de productos.
 * El controlador no construye consultas: lee la peticion, llama aqui y traduce
 * el resultado a una respuesta HTTP.
 */

const LIMITE_POR_DEFECTO = 100;
const LIMITE_MAXIMO = 500;

// El catalogo se lee siempre en orden de codigo: agrupa por categoria sin
// necesidad de un segundo criterio, porque el prefijo ya es la categoria.
const ORDEN_LISTADO = { codigoArticulo: 1 } as const;

const TAG_DESTACADO = 'destacado';

// Un codigo de producto tiene cuatro digitos: dos de categoria y dos de serie.
const LONGITUD_CODIGO = 4;
const CODIGOS_POR_CATEGORIA = 100;

export interface CriteriosProducto {
  categoria?: Categoria;
  codigo?: string;
  nombre?: string;
  marca?: string;
  texto?: string;
  destacado?: boolean;
  pagina: number;
  limite: number;
}

export interface ListadoProductos {
  productos: HydratedDocument<IProduct>[];
  total: number;
  pagina: number;
  limite: number;
}

/** Criterios validados, o el mensaje que el controlador devolvera como 400. */
export type LecturaCriterios =
  | { ok: true; criterios: CriteriosProducto }
  | { ok: false; error: string };

const categoriasAdmitidas = (): string => Object.values(Categoria).join(', ');


// --- Reglas del codigo de articulo ---

/**
 * Un codigo de producto es un entero positivo fuera del rango de los servicios,
 * que comparten con los productos el mismo espacio de codigos.
 */
export const esCodigoDeProducto = (codigo: number): boolean =>
  Number.isInteger(codigo) &&
  codigo > 0 &&
  !(codigo >= CODIGO_SERVICIO_MIN && codigo <= CODIGO_SERVICIO_MAX);

/**
 * Comprueba a la vez el codigo y su coherencia con la categoria. Es regla de
 * negocio, no ayuda del formulario: el panel avisa antes de enviar, pero sin
 * esta comprobacion cualquier cliente podria dejar un producto en una categoria
 * que su codigo contradice, y el listado por prefijo dejaria de cuadrar.
 */
export const validarCodigoYCategoria = (codigo: unknown, categoria: unknown): string | null => {
  const numero = Number(codigo);

  if (!esCodigoDeProducto(numero)) {
    return `Codigo de articulo no valido: debe ser un entero positivo fuera del rango ${CODIGO_SERVICIO_MIN}-${CODIGO_SERVICIO_MAX}, reservado a los servicios`;
  }
  if (!esCategoria(categoria)) {
    return `Categoria no valida. Valores admitidos: ${categoriasAdmitidas()}`;
  }

  const prefijo = PREFIJO_CATEGORIA[categoria];
  if (!String(numero).startsWith(prefijo)) {
    return `La categoria ${categoria} usa codigos que empiezan por ${prefijo}`;
  }

  return null;
};

/**
 * Primer codigo libre de una categoria.
 *
 * Vive en el servidor porque depende del catalogo entero. El panel solo tiene
 * delante la pagina que esta mirando, asi que calcularlo alli devolvia codigos
 * ya ocupados en cuanto habia un filtro puesto.
 *
 * Devuelve null si la serie de la categoria esta agotada: son cien codigos, y
 * repartir mas obligaria a tocar el mapa de prefijos.
 */
export const siguienteCodigoLibre = async (categoria: Categoria): Promise<number | null> => {
  const primero = Number(`${PREFIJO_CATEGORIA[categoria]}00`);
  const ultimo = primero + CODIGOS_POR_CATEGORIA - 1;

  const ocupadoMasAlto = await ProductoModelo
    .findOne({ codigoArticulo: { $gte: primero, $lte: ultimo } })
    .sort({ codigoArticulo: -1 })
    .select('codigoArticulo');

  const siguiente = (ocupadoMasAlto?.codigoArticulo ?? primero) + 1;
  return siguiente > ultimo ? null : siguiente;
};


// --- Listado ---

export const leerCriteriosProducto = (query: Record<string, unknown>): LecturaCriterios => {
  const categoria = textoDeQuery(query.categoria);
  if (categoria !== undefined && !esCategoria(categoria)) {
    return { ok: false, error: `Categoria no valida. Valores admitidos: ${categoriasAdmitidas()}` };
  }

  // El panel busca por fragmento de codigo ("10" -> 1001, 1002...). Aceptar
  // texto libre aqui obligaria a escaparlo dentro de una consulta que ya es
  // delicada; limitarlo a digitos deja la intencion clara y la consulta simple.
  const codigo = textoDeQuery(query.codigo);
  if (codigo !== undefined && !new RegExp(`^\\d{1,${LONGITUD_CODIGO}}$`).test(codigo)) {
    return { ok: false, error: `El filtro de codigo admite entre 1 y ${LONGITUD_CODIGO} digitos` };
  }

  const { pagina, limite } = leerPaginacion(query, LIMITE_POR_DEFECTO, LIMITE_MAXIMO);

  return {
    ok: true,
    criterios: {
      categoria,
      codigo,
      nombre:    textoDeQuery(query.nombre),
      marca:     textoDeQuery(query.marca),
      texto:     textoDeQuery(query.q),
      destacado: booleanoDeQuery(query.destacado),
      pagina,
      limite,
    },
  };
};

const construirFiltro = (criterios: CriteriosProducto): FilterQuery<IProduct> => {
  const filtro: FilterQuery<IProduct> = {};

  if (criterios.categoria) filtro.category = criterios.categoria;
  if (criterios.nombre)    filtro.name     = regexContiene(criterios.nombre);
  if (criterios.marca)     filtro.marca    = regexContiene(criterios.marca);
  if (criterios.texto)     filtro.$text    = { $search: criterios.texto };

  if (criterios.destacado !== undefined) {
    filtro.tags = criterios.destacado ? TAG_DESTACADO : { $ne: TAG_DESTACADO };
  }

  // `codigoArticulo` es numerico y el filtro busca un fragmento, no el valor
  // exacto. Comparar subcadenas obliga a convertirlo a texto dentro de la
  // propia consulta: un `find` normal solo sabe comparar el numero entero.
  // El criterio ya viene validado como digitos, asi que no hay nada que escapar.
  if (criterios.codigo) {
    filtro.$expr = {
      $regexMatch: { input: { $toString: '$codigoArticulo' }, regex: criterios.codigo },
    };
  }

  return filtro;
};

export const listarProductos = async (criterios: CriteriosProducto): Promise<ListadoProductos> => {
  const filtro = construirFiltro(criterios);
  const salto = (criterios.pagina - 1) * criterios.limite;

  // Con busqueda de texto manda la relevancia; sin ella, el orden del catalogo.
  const consulta = criterios.texto
    ? ProductoModelo
        .find(filtro, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
    : ProductoModelo.find(filtro).sort(ORDEN_LISTADO);

  // El total se cuenta con el mismo filtro que la pagina: sin el, el cliente no
  // puede distinguir "esto es todo" de "esto es la primera pagina".
  const [productos, total] = await Promise.all([
    consulta.skip(salto).limit(criterios.limite),
    ProductoModelo.countDocuments(filtro),
  ]);

  return { productos, total, pagina: criterios.pagina, limite: criterios.limite };
};


// --- Actualizacion ---

/**
 * Campos que una actualizacion puede tocar. El codigo no esta: identifica al
 * producto y no se reasigna.
 */
const CAMPOS_ACTUALIZABLES = [
  'name', 'price', 'description', 'stock',
  'category', 'subcategoria', 'marca', 'imagenes', 'tags',
] as const;

/**
 * Deja pasar solo los campos conocidos.
 *
 * Sin esta lista el cuerpo entra tal cual en findOneAndUpdate, y Mongoose
 * interpreta como operadores las claves que empiezan por `$`: un cuerpo con
 * `{"$unset": {"price": ""}}` deja el producto sin precio saltandose el
 * `required` del esquema, porque `runValidators` solo comprueba los campos que
 * se asignan, no los que se borran.
 */
export const soloCamposActualizables = (cuerpo: unknown): Partial<IProduct> => {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) return {};

  const entrada = cuerpo as Record<string, unknown>;
  const cambios: Record<string, unknown> = {};

  for (const campo of CAMPOS_ACTUALIZABLES) {
    if (entrada[campo] !== undefined) cambios[campo] = entrada[campo];
  }

  return cambios as Partial<IProduct>;
};


// --- Documento suelto ---

export const buscarPorCodigo = (codigo: number) =>
  ProductoModelo.findOne({ codigoArticulo: codigo });

export const existePorCodigo = async (codigo: number): Promise<boolean> =>
  (await ProductoModelo.exists({ codigoArticulo: codigo })) !== null;

export const crearProducto = (datos: Partial<IProduct>) =>
  new ProductoModelo(datos).save();

export const actualizarProducto = (codigo: number, cambios: Partial<IProduct>) =>
  ProductoModelo.findOneAndUpdate(
    { codigoArticulo: codigo },
    cambios,
    { new: true, runValidators: true },
  );

export const actualizarStock = (codigo: number, stock: number) =>
  ProductoModelo.findOneAndUpdate(
    { codigoArticulo: codigo },
    { stock },
    { new: true, runValidators: true },
  );

export const anadirImagenes = (codigo: number, urls: string[]) =>
  ProductoModelo.findOneAndUpdate(
    { codigoArticulo: codigo },
    { $push: { imagenes: { $each: urls } } },
    { new: true },
  );

/**
 * Quita la referencia a la imagen solo si pertenece a este producto: el filtro
 * incluye la propia url. Asi el llamante sabe, por el resultado, si puede
 * borrar el objeto del bucket sin arriesgarse a tocar el de otro producto.
 */
export const quitarImagen = (codigo: number, url: string) =>
  ProductoModelo.findOneAndUpdate(
    { codigoArticulo: codigo, imagenes: url },
    { $pull: { imagenes: url } },
    { new: true },
  );

export const eliminarProducto = (codigo: number) =>
  ProductoModelo.findOneAndDelete({ codigoArticulo: codigo });
