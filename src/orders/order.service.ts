import { FilterQuery, HydratedDocument, Types, isValidObjectId } from 'mongoose';
import { IOrder, Order, OrderStatus } from './order.model';
import { leerPaginacion, textoDeQuery } from '../shared/consulta.utils';

/**
 * Seleccion, filtrado y paginacion del historial de pedidos.
 *
 * A diferencia del catalogo, los pedidos no dejan de crecer nunca: sin tope, la
 * pantalla de administracion se traia la historia entera del negocio en una
 * sola respuesta, con el usuario populado de cada linea.
 */

const LIMITE_POR_DEFECTO = 50;
const LIMITE_MAXIMO = 200;

// Lo mas reciente primero: es como se mira una bandeja de pedidos.
const ORDEN_LISTADO = { createdAt: -1 } as const;

// El frontend espera el usuario como { _id, username, email }.
const CAMPOS_USUARIO = 'username email' as const;

export interface CriteriosPedido {
  /**
   * Dueño de los pedidos. No es un filtro opcional mas: para quien no es admin
   * lo fija el servidor con su propia identidad, y es lo que impide que
   * `?usuario=` sirva para leer los pedidos de otro.
   */
  usuario?: string;
  status?: OrderStatus;
  desde?: Date;
  hasta?: Date;
  pagina: number;
  limite: number;
}

export interface ListadoPedidos {
  pedidos: HydratedDocument<IOrder>[];
  total: number;
  pagina: number;
  limite: number;
}

export type LecturaCriterios =
  | { ok: true; criterios: CriteriosPedido }
  | { ok: false; error: string };

const esEstado = (valor: unknown): valor is OrderStatus =>
  typeof valor === 'string' && Object.values(OrderStatus).includes(valor as OrderStatus);

/** Parsea "YYYY-MM-DD" a medianoche UTC. Devuelve null si no es una fecha valida. */
const fechaUtc = (valor: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;

  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

/**
 * Lee los criterios de la peticion.
 *
 * `esAdmin` y `usuarioAutenticado` no son parametros de conveniencia: deciden
 * si `?usuario=` se respeta o se ignora. Quien no es admin queda siempre
 * acotado a lo suyo, mande lo que mande.
 */
export const leerCriteriosPedido = (
  query: Record<string, unknown>,
  esAdmin: boolean,
  usuarioAutenticado: string,
): LecturaCriterios => {
  const status = textoDeQuery(query.status);
  if (status !== undefined && !esEstado(status)) {
    return { ok: false, error: `Estado no valido. Valores admitidos: ${Object.values(OrderStatus).join(', ')}` };
  }

  const usuarioPedido = textoDeQuery(query.usuario);
  if (esAdmin && usuarioPedido !== undefined && !isValidObjectId(usuarioPedido)) {
    return { ok: false, error: 'Identificador de usuario no valido' };
  }

  const desdeTexto = textoDeQuery(query.desde);
  const desde = desdeTexto === undefined ? undefined : fechaUtc(desdeTexto);
  if (desde === null) {
    return { ok: false, error: 'El parametro "desde" debe tener formato YYYY-MM-DD' };
  }

  const hastaTexto = textoDeQuery(query.hasta);
  const hasta = hastaTexto === undefined ? undefined : fechaUtc(hastaTexto);
  if (hasta === null) {
    return { ok: false, error: 'El parametro "hasta" debe tener formato YYYY-MM-DD' };
  }

  if (desde && hasta && desde > hasta) {
    return { ok: false, error: '"desde" no puede ser posterior a "hasta"' };
  }

  const { pagina, limite } = leerPaginacion(query, LIMITE_POR_DEFECTO, LIMITE_MAXIMO);

  return {
    ok: true,
    criterios: {
      usuario: esAdmin ? usuarioPedido : usuarioAutenticado,
      status,
      desde,
      hasta,
      pagina,
      limite,
    },
  };
};

const construirFiltro = (criterios: CriteriosPedido): FilterQuery<IOrder> => {
  const filtro: FilterQuery<IOrder> = {};

  if (criterios.usuario) filtro.user = new Types.ObjectId(criterios.usuario);
  if (criterios.status) filtro.status = criterios.status;

  // `hasta` es un dia, no un instante: se incluye entero sumandole 24 horas,
  // porque si no un pedido de esa misma tarde quedaria fuera del rango.
  if (criterios.desde || criterios.hasta) {
    const rango: Record<string, Date> = {};
    if (criterios.desde) rango.$gte = criterios.desde;
    if (criterios.hasta) rango.$lt = new Date(criterios.hasta.getTime() + 24 * 60 * 60 * 1000);
    filtro.createdAt = rango;
  }

  return filtro;
};

export const listarPedidos = async (criterios: CriteriosPedido): Promise<ListadoPedidos> => {
  const filtro = construirFiltro(criterios);
  const salto = (criterios.pagina - 1) * criterios.limite;

  const [pedidos, total] = await Promise.all([
    Order.find(filtro)
      .sort(ORDEN_LISTADO)
      .skip(salto)
      .limit(criterios.limite)
      .populate('user', CAMPOS_USUARIO),
    Order.countDocuments(filtro),
  ]);

  return { pedidos, total, pagina: criterios.pagina, limite: criterios.limite };
};
