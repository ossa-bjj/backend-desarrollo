import type { FilterQuery, HydratedDocument } from 'mongoose';
import type { IProduct, ITallaStock } from './producto.model';
import { Categoria, PREFIJO_CATEGORIA, ProductoModelo, TALLAS, esCategoria, esTalla } from './producto.model';
import { CODIGO_SERVICIO_MIN, CODIGO_SERVICIO_MAX } from '../services/servicio.model';
import { booleanoDeQuery, leerPaginacion, regexContiene, textoDeQuery } from '../shared/consulta.utils';
import { soloCampos } from '../shared/actualizacion.utils';
import { keyFromPublicUrl } from '../shared/r2.utils';

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
  activo?: boolean;
  incluirInactivos?: boolean;
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
export type LecturaCriterios = { ok: true; criterios: CriteriosProducto } | { ok: false; error: string };

const categoriasAdmitidas = (): string => Object.values(Categoria).join(', ');

// --- Reglas del codigo de articulo ---

/**
 * Un codigo de producto es un entero positivo fuera del rango de los servicios,
 * que comparten con los productos el mismo espacio de codigos.
 */
export const esCodigoDeProducto = (codigo: number): boolean =>
  Number.isInteger(codigo) && codigo > 0 && !(codigo >= CODIGO_SERVICIO_MIN && codigo <= CODIGO_SERVICIO_MAX);

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

  const ocupadoMasAlto = await ProductoModelo.findOne({ codigoArticulo: { $gte: primero, $lte: ultimo } })
    .sort({ codigoArticulo: -1 })
    .select('codigoArticulo');

  const siguiente = (ocupadoMasAlto?.codigoArticulo ?? primero) + 1;
  return siguiente > ultimo ? null : siguiente;
};

// --- Listado ---

export const leerCriteriosProducto = (
  query: Record<string, unknown>,
  esAdmin: boolean = false,
): LecturaCriterios => {
  const categoria = textoDeQuery(query.categoria);
  if (categoria !== undefined && !esCategoria(categoria)) {
    return { ok: false, error: `Categoría no válida. Valores admitidos: ${categoriasAdmitidas()}` };
  }

  // El panel busca por fragmento de codigo ("10" -> 1001, 1002...). Aceptar
  // texto libre aqui obligaria a escaparlo dentro de una consulta que ya es
  // delicada; limitarlo a digitos deja la intencion clara y la consulta simple.
  const codigo = textoDeQuery(query.codigo);
  if (codigo !== undefined && !new RegExp(`^\\d{1,${LONGITUD_CODIGO}}$`).test(codigo)) {
    return { ok: false, error: `El filtro de código admite entre 1 y ${LONGITUD_CODIGO} dígitos` };
  }

  const { pagina, limite } = leerPaginacion(query, LIMITE_POR_DEFECTO, LIMITE_MAXIMO);
  // Solo un admin puede pedir un estado concreto o ver los inactivos; a quien
  // no lo es se le ignora el filtro y cae en el `{ $ne: false }` publico de
  // `construirFiltro`, igual que ya hace `getProductoPorCodigo`.
  const activo = esAdmin ? booleanoDeQuery(query.activo) : undefined;
  const incluirInactivos = esAdmin && query.soloActivos !== 'true';

  return {
    ok: true,
    criterios: {
      categoria,
      codigo,
      nombre: textoDeQuery(query.nombre),
      marca: textoDeQuery(query.marca),
      texto: textoDeQuery(query.q),
      destacado: booleanoDeQuery(query.destacado),
      activo,
      incluirInactivos,
      pagina,
      limite,
    },
  };
};

const construirFiltro = (criterios: CriteriosProducto): FilterQuery<IProduct> => {
  const filtro: FilterQuery<IProduct> = {};

  if (criterios.categoria) filtro.category = criterios.categoria;
  if (criterios.nombre) filtro.name = regexContiene(criterios.nombre);
  if (criterios.marca) filtro.marca = regexContiene(criterios.marca);
  if (criterios.texto) filtro.$text = { $search: criterios.texto };

  if (criterios.destacado !== undefined) {
    filtro.tags = criterios.destacado ? TAG_DESTACADO : { $ne: TAG_DESTACADO };
  }

  // Filtrado de productos activos/visibles:
  if (criterios.activo !== undefined) {
    filtro.activo = criterios.activo;
  } else if (!criterios.incluirInactivos) {
    // Para la tienda pública, solo productos activos (o que no tengan activo explícito en false)
    filtro.activo = { $ne: false };
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
    ? ProductoModelo.find(filtro, { score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' } })
    : ProductoModelo.find(filtro).sort(ORDEN_LISTADO);

  // El total se cuenta con el mismo filtro que la pagina: sin el, el cliente no
  // puede distinguir "esto es todo" de "esto es la primera pagina".
  const [productos, total] = await Promise.all([
    consulta.skip(salto).limit(criterios.limite),
    ProductoModelo.countDocuments(filtro),
  ]);

  return { productos, total, pagina: criterios.pagina, limite: criterios.limite };
};

// --- Tallas y existencias ---

/**
 * Las reglas de talla viven aqui y no en quien las consulta porque tienen dos
 * consumidores que deben coincidir: el alta del pedido, que decide si se puede
 * vender, y el cobro, que descuenta lo vendido. Si cada uno resolviera el stock
 * a su manera se podria aceptar un pedido y descontar de otra talla.
 */

/** Unidades disponibles de una talla. Cero si el producto no la vende. */
export const stockDeTalla = (producto: Pick<IProduct, 'tallas'>, talla: string): number =>
  producto.tallas.find((t) => t.talla === talla)?.stock ?? 0;

/** Todas las tallas a cero: el punto de partida de un producto nuevo. */
export const tallasVacias = (): ITallaStock[] => TALLAS.map((talla) => ({ talla, stock: 0 }));

/**
 * Normaliza lo que llega del panel a las cinco tallas, en orden y sin repetir.
 *
 * Un formulario puede mandarlas desordenadas, incompletas o con una talla
 * inventada. Guardar eso tal cual dejaria productos a los que les falta una
 * talla, y entonces «no la vende» y «esta agotada» pasarian a ser lo mismo.
 */
export const normalizarTallas = (valor: unknown): ITallaStock[] | null => {
  if (!Array.isArray(valor)) return null;

  const porTalla = new Map<string, number>();
  for (const entrada of valor) {
    const talla = (entrada as { talla?: unknown })?.talla;
    const stock = Number((entrada as { stock?: unknown })?.stock);

    if (!esTalla(talla)) return null;
    if (!Number.isInteger(stock) || stock < 0) return null;
    porTalla.set(talla, stock);
  }

  return TALLAS.map((talla) => ({ talla, stock: porTalla.get(talla) ?? 0 }));
};

/**
 * Decide si se pueden vender `cantidad` unidades de una talla.
 *
 * Devuelve el motivo por el que no se puede, o null si se puede. El texto sale
 * de aqui para que el cliente lea lo mismo venga del alta del pedido o del
 * cobro.
 */
export const motivoParaNoVender = (
  producto: Pick<IProduct, 'name' | 'tallas' | 'activo'>,
  talla: unknown,
  cantidad: number,
): string | null => {
  if (producto.activo === false) {
    return `El producto "${producto.name}" no está disponible actualmente`;
  }

  // Un producto se vende por tallas, asi que sin talla no hay de donde
  // descontar: pedir «una camiseta» sin decir cual es una peticion incompleta.
  //
  // Se distingue no haber puesto talla de haber puesto una que no existe: son
  // dos errores distintos y decir «falta la talla» a quien mando «XXXL» manda a
  // buscar el fallo donde no esta.
  if (talla === undefined || talla === null || talla === '') {
    return `Falta la talla de "${producto.name}"`;
  }

  if (!esTalla(talla) || !producto.tallas.some((t) => t.talla === talla)) {
    return `"${producto.name}" no se vende en talla ${String(talla)}`;
  }

  const disponibles = stockDeTalla(producto, talla);
  if (cantidad > disponibles) {
    return `Solo quedan ${disponibles} unidades de "${producto.name}" en talla ${talla}`;
  }

  return null;
};

/**
 * Descuenta unidades de una talla concreta.
 *
 * El filtro exige que quede stock suficiente EN ESA TALLA, asi que dos cobros
 * simultaneos del ultimo articulo no pueden dejarlo en negativo: el segundo no
 * encuentra documento que actualizar.
 */
export const descontarStockDeTalla = (codigo: number, talla: string, cantidad: number) =>
  ProductoModelo.findOneAndUpdate(
    { codigoArticulo: codigo, tallas: { $elemMatch: { talla, stock: { $gte: cantidad } } } },
    { $inc: { 'tallas.$[entrada].stock': -cantidad } },
    { arrayFilters: [{ 'entrada.talla': talla }], new: true },
  );

/**
 * Devuelve unidades a una talla. Lo contrario de descontar, para cuando se
 * cancela un pedido ya cobrado.
 *
 * Aqui no hay condicion que comprobar: sumar nunca deja el stock en negativo.
 */
export const devolverStockDeTalla = (codigo: number, talla: string, cantidad: number) =>
  ProductoModelo.findOneAndUpdate(
    { codigoArticulo: codigo, 'tallas.talla': talla },
    { $inc: { 'tallas.$[entrada].stock': cantidad } },
    { arrayFilters: [{ 'entrada.talla': talla }], new: true },
  );

// --- Actualizacion ---

/**
 * Campos que una actualizacion puede tocar. El codigo no esta: identifica al
 * producto y no se reasigna.
 */
const CAMPOS_ACTUALIZABLES = [
  'name',
  'price',
  'description',
  'tallas',
  'category',
  'subcategoria',
  'marca',
  'imagenes',
  'tags',
  'activo',
] as const;

/** Deja pasar solo los campos conocidos. Ver `shared/actualizacion.utils.ts`. */
export const soloCamposActualizables = (cuerpo: unknown): Partial<IProduct> =>
  soloCampos<IProduct>(cuerpo, CAMPOS_ACTUALIZABLES);

// --- Documento suelto ---

export const buscarPorCodigo = (codigo: number) => ProductoModelo.findOne({ codigoArticulo: codigo });

export const existePorCodigo = async (codigo: number): Promise<boolean> =>
  (await ProductoModelo.exists({ codigoArticulo: codigo })) !== null;

export const crearProducto = (datos: Partial<IProduct>) => new ProductoModelo(datos).save();

export const actualizarProducto = (codigo: number, cambios: Partial<IProduct>) =>
  ProductoModelo.findOneAndUpdate({ codigoArticulo: codigo }, cambios, { new: true, runValidators: true });

export const actualizarStock = (codigo: number, tallas: ITallaStock[]) =>
  ProductoModelo.findOneAndUpdate({ codigoArticulo: codigo }, { tallas }, { new: true, runValidators: true });

export const anadirImagenes = (codigo: number, urls: string[]) =>
  ProductoModelo.findOneAndUpdate(
    { codigoArticulo: codigo },
    { $push: { imagenes: { $each: urls } } },
    { new: true },
  );

/**
 * Mueve la imagen seleccionada al índice 0 del array `imagenes`.
 * La primera posición determina la imagen principal en toda la web (catálogo, ficha, pedidos).
 */
export const establecerImagenPrincipal = async (codigo: number, urlOKey: string) => {
  const producto = await buscarPorCodigo(codigo);
  if (!producto) return null;

  const targetKey = keyFromPublicUrl(urlOKey);
  const index = producto.imagenes.findIndex((img) => {
    if (img === urlOKey) return true;
    const k = keyFromPublicUrl(img);
    return Boolean(targetKey && k && k === targetKey);
  });

  if (index === -1) return null;
  if (index === 0) return producto;

  const [seleccionada] = producto.imagenes.splice(index, 1);
  producto.imagenes.unshift(seleccionada);
  return producto.save();
};

/**
 * Fija el estado activo/visible de un producto, o lo alterna si no se especifica.
 */
export const alternarActivo = async (codigo: number, activo?: unknown) => {
  if (typeof activo === 'boolean') {
    return ProductoModelo.findOneAndUpdate(
      { codigoArticulo: codigo },
      { activo },
      { new: true, runValidators: true },
    );
  }

  const producto = await buscarPorCodigo(codigo);
  if (!producto) return null;

  producto.activo = !(producto.activo ?? true);
  return producto.save();
};

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
