import type { IServicio } from './servicio.model';
import { ServicioModelo, CODIGO_SERVICIO_MIN, CODIGO_SERVICIO_MAX } from './servicio.model';
import { soloCampos } from '../shared/actualizacion.utils';
import { keyFromPublicUrl } from '../shared/r2.utils';

/**
 * Consultas y operaciones del catalogo de servicios.
 *
 * Mismo reparto que en productos: el controlador lee la peticion, llama aqui y
 * traduce el resultado a HTTP. Aqui no hay `Request` ni `Response`.
 */

// Orden estable para la landing: primero el campo `orden`, luego el codigo.
const ORDEN_LISTADO = { orden: 1, codigoArticulo: 1 } as const;

/**
 * Campos que una actualizacion puede tocar. El codigo no esta: identifica al
 * servicio y no se reasigna.
 */
const CAMPOS_ACTUALIZABLES = [
  'nombre',
  'precio',
  'subcategoria',
  'descripcionCorta',
  'descripcionCompleta',
  'modalidad',
  'duracion',
  'plazas',
  'requiereReserva',
  'requiereConfirmacion',
  'activo',
  'imagenes',
  'tags',
  'orden',
  'textoBoton',
  'precioDesde',
  'unidadPrecio',
] as const;

/**
 * Los servicios ocupan un rango reservado de codigos de articulo; todo lo que
 * cae fuera es un producto.
 *
 * Vive aqui, en el dominio dueño del rango, y no en el de pedidos: es quien
 * decide que es un servicio.
 */
export const esCodigoDeServicio = (codigo: number): boolean =>
  codigo >= CODIGO_SERVICIO_MIN && codigo <= CODIGO_SERVICIO_MAX;

/** Lee un codigo de servicio de la ruta. `null` si no es uno valido. */
export const leerCodigoServicio = (valor: string | string[]): number | null => {
  if (Array.isArray(valor)) return null;

  const codigo = Number(valor);
  return Number.isInteger(codigo) && esCodigoDeServicio(codigo) ? codigo : null;
};

/** Solo los activos: es el catalogo que ve el publico. */
export const listarActivos = () => ServicioModelo.find({ activo: true }).sort(ORDEN_LISTADO);

/** Todos, incluidos los desactivados: la vista de administracion. */
export const listarTodos = () => ServicioModelo.find().sort(ORDEN_LISTADO);

/**
 * Busqueda de texto sobre el catalogo publico, ordenada por relevancia.
 * Usa el indice de texto declarado en el modelo.
 */
export const buscarPorTexto = (texto: string) =>
  ServicioModelo.find({ activo: true, $text: { $search: texto } }, { score: { $meta: 'textScore' } }).sort({
    score: { $meta: 'textScore' },
  });

export const buscarPorCodigo = (codigo: number) => ServicioModelo.findOne({ codigoArticulo: codigo });

export const crearServicio = (datos: Partial<IServicio>) => new ServicioModelo(datos).save();

/**
 * Se queda solo con los campos conocidos: el cuerpo en crudo permitiria colar
 * operadores de Mongo, y el codigo identifica al servicio y no se reasigna.
 */
export const soloCamposActualizables = (cuerpo: unknown): Partial<IServicio> =>
  soloCampos<IServicio>(cuerpo, CAMPOS_ACTUALIZABLES);

export const actualizarServicio = (codigo: number, cambios: Partial<IServicio>) =>
  ServicioModelo.findOneAndUpdate({ codigoArticulo: codigo }, cambios, {
    new: true,
    runValidators: true,
  });

/**
 * Fija el estado activo, o lo alterna si no se indica cual.
 *
 * Alternar necesita leer antes de escribir, asi que no es atomico; con un solo
 * administrador tocando el panel no hay carrera real, y fijar el valor —que es
 * lo que hace el panel— si lo es.
 */
export const alternarActivo = async (codigo: number, activo?: unknown) => {
  if (typeof activo === 'boolean') {
    return ServicioModelo.findOneAndUpdate({ codigoArticulo: codigo }, { activo }, { new: true });
  }

  const servicio = await buscarPorCodigo(codigo);
  if (!servicio) return null;

  servicio.activo = !servicio.activo;
  await servicio.save();
  return servicio;
};

export const anadirImagenes = (codigo: number, urls: string[]) =>
  ServicioModelo.findOneAndUpdate(
    { codigoArticulo: codigo },
    { $push: { imagenes: { $each: urls } } },
    { new: true },
  );

/**
 * Quita la referencia a la imagen casando tanto por URL publica completa como por key
 * almacenada en la base de datos.
 */
export const quitarImagen = async (codigo: number, urlOKey: string) => {
  const servicio = await buscarPorCodigo(codigo);
  if (!servicio) return null;

  const targetKey = keyFromPublicUrl(urlOKey);
  const index = servicio.imagenes.findIndex((img) => {
    if (img === urlOKey) return true;
    const k = keyFromPublicUrl(img);
    return Boolean(targetKey && k && k === targetKey);
  });

  if (index === -1) return null;

  const [quitada] = servicio.imagenes.splice(index, 1);
  await servicio.save();
  return { servicio, quitada };
};

/**
 * Marca una imagen como principal moviendola al primer indice (0).
 */
export const establecerImagenPrincipal = async (codigo: number, urlOKey: string) => {
  const servicio = await buscarPorCodigo(codigo);
  if (!servicio) return null;

  const targetKey = keyFromPublicUrl(urlOKey);
  const index = servicio.imagenes.findIndex((img) => {
    if (img === urlOKey) return true;
    const k = keyFromPublicUrl(img);
    return Boolean(targetKey && k && k === targetKey);
  });

  if (index === -1) return null;
  if (index === 0) return servicio;

  const [seleccionada] = servicio.imagenes.splice(index, 1);
  servicio.imagenes.unshift(seleccionada);
  return servicio.save();
};

export const eliminarServicio = (codigo: number) =>
  ServicioModelo.findOneAndDelete({ codigoArticulo: codigo });
