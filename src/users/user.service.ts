import { FilterQuery, HydratedDocument } from 'mongoose';
import { IUser, User, UserRole, UserStatus } from './user.model';
import {
  booleanoDeQuery,
  leerPaginacion,
  regexContiene,
  textoDeQuery,
} from '../shared/consulta.utils';

/**
 * Busqueda de personas del panel de administracion. El controlador solo lee la
 * peticion y responde: los criterios y la consulta se resuelven aqui.
 */

const LIMITE_POR_DEFECTO = 100;
const LIMITE_MAXIMO = 500;

// El hash nunca sale del servidor, ni siquiera para un admin.
const SIN_PASSWORD = '-password';

/**
 * Columnas por las que se puede ordenar, con la ruta real del documento detras.
 *
 * Es una lista blanca a proposito: `sort` acepta cualquier ruta, asi que dejar
 * pasar el texto del cliente permitiria ordenar por campos que no se muestran
 * —`password` entre ellos— y deducir su contenido a base de comparar paginas.
 * Ordenar por un nombre de columna, no por una ruta de la base de datos, ademas
 * desacopla la tabla del esquema.
 */
const CAMPOS_ORDENABLES = {
  nombre:   ['profile.firstName', 'profile.lastName'],
  username: ['username'],
  email:    ['email'],
  role:     ['role'],
  status:   ['status'],
  cliente:  ['customer.isCustomer'],
  licencia: ['sportsProfile.licenseNumber'],
  alta:     ['createdAt'],
} as const;

export type CampoOrdenUsuario = keyof typeof CAMPOS_ORDENABLES;
export type DireccionOrden = 'asc' | 'desc';

const ORDEN_POR_DEFECTO: CampoOrdenUsuario = 'nombre';

const esCampoOrdenable = (valor: unknown): valor is CampoOrdenUsuario =>
  typeof valor === 'string' && Object.hasOwn(CAMPOS_ORDENABLES, valor);

/** Traduce la columna elegida a las rutas reales que entiende Mongo. */
const construirOrden = (
  campo: CampoOrdenUsuario,
  direccion: DireccionOrden,
): Record<string, 1 | -1> => {
  const sentido = direccion === 'desc' ? -1 : 1;

  return Object.fromEntries(CAMPOS_ORDENABLES[campo].map((ruta) => [ruta, sentido]));
};

export interface CriteriosUsuario {
  texto?: string;
  username?: string;
  email?: string;
  role?: UserRole;
  status?: UserStatus;
  esCliente?: boolean;
  licencia?: string;
  orden: CampoOrdenUsuario;
  direccion: DireccionOrden;
  pagina: number;
  limite: number;
}

export interface ListadoUsuarios {
  usuarios: HydratedDocument<IUser>[];
  total: number;
  pagina: number;
  limite: number;
}

export type LecturaCriterios =
  | { ok: true; criterios: CriteriosUsuario }
  | { ok: false; error: string };

const esRol = (valor: unknown): valor is UserRole =>
  typeof valor === 'string' && Object.values(UserRole).includes(valor as UserRole);

const esEstado = (valor: unknown): valor is UserStatus =>
  typeof valor === 'string' && Object.values(UserStatus).includes(valor as UserStatus);

export const leerCriteriosUsuario = (query: Record<string, unknown>): LecturaCriterios => {
  const role = textoDeQuery(query.role);
  if (role !== undefined && !esRol(role)) {
    return { ok: false, error: `Rol no valido. Valores admitidos: ${Object.values(UserRole).join(', ')}` };
  }

  const status = textoDeQuery(query.status);
  if (status !== undefined && !esEstado(status)) {
    return { ok: false, error: `Estado no valido. Valores admitidos: ${Object.values(UserStatus).join(', ')}` };
  }

  // Una columna desconocida cae al orden por defecto en lugar de dar error: el
  // orden es una preferencia de lectura, no parte del criterio de busqueda.
  const ordenPedido = textoDeQuery(query.orden);
  const orden = esCampoOrdenable(ordenPedido) ? ordenPedido : ORDEN_POR_DEFECTO;
  const direccion: DireccionOrden = textoDeQuery(query.direccion) === 'desc' ? 'desc' : 'asc';

  const { pagina, limite } = leerPaginacion(query, LIMITE_POR_DEFECTO, LIMITE_MAXIMO);

  return {
    ok: true,
    criterios: {
      texto:     textoDeQuery(query.q),
      username:  textoDeQuery(query.username),
      email:     textoDeQuery(query.email),
      role,
      status,
      esCliente: booleanoDeQuery(query.customer),
      licencia:  textoDeQuery(query.license),
      orden,
      direccion,
      pagina,
      limite,
    },
  };
};

const construirFiltro = (criterios: CriteriosUsuario): FilterQuery<IUser> => {
  const filtro: FilterQuery<IUser> = {};

  if (criterios.username) filtro.username = regexContiene(criterios.username);
  if (criterios.email)    filtro.email    = regexContiene(criterios.email);
  if (criterios.role)     filtro.role     = criterios.role;
  if (criterios.status)   filtro.status   = criterios.status;

  if (criterios.esCliente !== undefined) filtro['customer.isCustomer'] = criterios.esCliente;
  if (criterios.licencia) filtro['sportsProfile.licenseNumber'] = regexContiene(criterios.licencia);

  // El buscador del panel ofrece una sola caja para "nombre, usuario o email",
  // asi que el termino se prueba contra los cuatro campos por los que alguien
  // buscaria a una persona.
  if (criterios.texto) {
    const patron = regexContiene(criterios.texto);
    filtro.$or = [
      { username: patron },
      { email: patron },
      { 'profile.firstName': patron },
      { 'profile.lastName': patron },
    ];
  }

  return filtro;
};

export const listarUsuarios = async (criterios: CriteriosUsuario): Promise<ListadoUsuarios> => {
  const filtro = construirFiltro(criterios);
  const salto = (criterios.pagina - 1) * criterios.limite;

  const [usuarios, total] = await Promise.all([
    User.find(filtro)
      .select(SIN_PASSWORD)
      .sort(construirOrden(criterios.orden, criterios.direccion))
      .skip(salto)
      .limit(criterios.limite),
    User.countDocuments(filtro),
  ]);

  return { usuarios, total, pagina: criterios.pagina, limite: criterios.limite };
};
