import type { FilterQuery, HydratedDocument } from 'mongoose';
import { Types, isValidObjectId } from 'mongoose';
import type { IOrder } from './order.model';
import { Order, OrderStatus, OrderItemTipo, identidadLinea } from './order.model';
import { ProductoModelo, esTalla, type ITallaStock } from '../products/producto.model';
import { motivoParaNoVender } from '../products/producto.service';
import { ServicioModelo } from '../services/servicio.model';
import { esCodigoDeServicio } from '../services/servicio.service';
import { normalizarUrlMedia } from '../shared/r2.utils';
import { redondearEuros } from '../shared/dinero';
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

export type LecturaCriterios = { ok: true; criterios: CriteriosPedido } | { ok: false; error: string };

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
    return {
      ok: false,
      error: `Estado no válido. Valores admitidos: ${Object.values(OrderStatus).join(', ')}`,
    };
  }

  const usuarioPedido = textoDeQuery(query.usuario);
  if (esAdmin && usuarioPedido !== undefined && !isValidObjectId(usuarioPedido)) {
    return { ok: false, error: 'Identificador de usuario no válido' };
  }

  const desdeTexto = textoDeQuery(query.desde);
  const desde = desdeTexto === undefined ? undefined : fechaUtc(desdeTexto);
  if (desde === null) {
    return { ok: false, error: 'El parámetro "desde" debe tener formato YYYY-MM-DD' };
  }

  const hastaTexto = textoDeQuery(query.hasta);
  const hasta = hastaTexto === undefined ? undefined : fechaUtc(hastaTexto);
  if (hasta === null) {
    return { ok: false, error: 'El parámetro "hasta" debe tener formato YYYY-MM-DD' };
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

/* ── Alta de un pedido ─────────────────────────────────────────────────────── */
/*
 * Todo lo que sigue estaba dentro de `createOrder`, que eran 186 lineas de
 * reglas de negocio metidas en un manejador HTTP. Aqui no hay `Response`: se
 * devuelve el resultado y quien llame decide como responderlo.
 */

// Linea de pedido tal y como la envia el cliente: solo dice QUE quiere y CUANTO.
// El precio nunca viaja en la peticion, se resuelve contra el catalogo.
export interface LineaPedidoInput {
  codigoArticulo: unknown;
  quantity: unknown;
  slotId?: unknown;
  slotLabel?: unknown;
  /** Obligatoria en los productos: el stock se lleva por talla. */
  talla?: unknown;
}

// Entrada del catalogo ya normalizada, sea producto o servicio.
interface EntradaCatalogo {
  name: string;
  price: number;
  image?: string;
  tipo: OrderItemTipo;
  /**
   * Tope de unidades vendibles cuando NO depende de la talla: las plazas de un
   * servicio. En un producto el tope lo pone la talla pedida, asi que viaja en
   * `tallas` y se resuelve por linea.
   */
  maximo: number;
  tallas?: ITallaStock[];
  etiqueta: string;
  // Si alguna linea lo pide, el pedido entero pasa por confirmacion previa.
  requiereConfirmacion: boolean;
}

/** Linea ya resuelta contra el catalogo, lista para guardarse en el pedido. */
interface LineaResuelta {
  codigoArticulo: number;
  name: string;
  quantity: number;
  price: number;
  precioOriginal: number;
  image?: string;
  tipo: OrderItemTipo;
  slotId?: string;
  slotLabel?: string;
  talla?: string;
}

export type PedidoPreparado =
  | { ok: true; items: LineaResuelta[]; total: number; necesitaConfirmacion: boolean }
  | { ok: false; estado: number; error: string };

/**
 * Trae del catalogo lo que piden las lineas y lo normaliza a una forma comun.
 *
 * Productos y servicios viven en colecciones distintas y con nombres de campo
 * distintos (`name`/`nombre`, `price`/`precio`); a partir de aqui el resto del
 * alta no tiene que saber de cual viene cada linea.
 */
const resolverCatalogo = async (codigos: number[]): Promise<Map<number, EntradaCatalogo>> => {
  const codigosServicio = codigos.filter(esCodigoDeServicio);
  const codigosProducto = codigos.filter((codigo) => !esCodigoDeServicio(codigo));

  const [productos, servicios] = await Promise.all([
    codigosProducto.length
      ? ProductoModelo.find({ codigoArticulo: { $in: codigosProducto } })
      : Promise.resolve([]),
    codigosServicio.length
      ? ServicioModelo.find({ codigoArticulo: { $in: codigosServicio } })
      : Promise.resolve([]),
  ]);

  const catalogo = new Map<number, EntradaCatalogo>();

  for (const producto of productos) {
    catalogo.set(producto.codigoArticulo, {
      name: producto.name,
      price: producto.price,
      image: normalizarUrlMedia(producto.imagenes?.[0] ?? ''),
      tipo: OrderItemTipo.PRODUCTO,
      maximo: producto.tallas.reduce((total, t) => total + t.stock, 0),
      tallas: producto.tallas,
      etiqueta: 'unidades en stock',
      requiereConfirmacion: false,
    });
  }

  for (const servicio of servicios) {
    // Un servicio desactivado deja de venderse, aunque siga en carritos antiguos.
    if (!servicio.activo) continue;
    catalogo.set(servicio.codigoArticulo, {
      name: servicio.nombre,
      price: servicio.precio,
      image: normalizarUrlMedia(servicio.imagenes?.[0] ?? ''),
      tipo: OrderItemTipo.SERVICIO,
      maximo: servicio.plazas,
      etiqueta: 'plazas disponibles',
      requiereConfirmacion: servicio.requiereConfirmacion,
    });
  }

  return catalogo;
};

/**
 * Valida las lineas que manda el cliente y las resuelve contra el catalogo.
 *
 * El cliente solo dice QUE quiere y CUANTO: nombre, precio, imagen y total se
 * resuelven aqui contra la base de datos. Confiar en el precio que envia el
 * navegador permitiria pagar 0,01 EUR por cualquier articulo.
 */
export const prepararPedido = async (entrada: unknown): Promise<PedidoPreparado> => {
  if (!Array.isArray(entrada) || entrada.length === 0) {
    return { ok: false, estado: 400, error: 'El pedido debe incluir al menos una línea' };
  }

  const lineas = entrada as LineaPedidoInput[];

  // --- Validacion de forma antes de tocar la base de datos ---
  const codigos: number[] = [];
  for (const linea of lineas) {
    const codigo = Number(linea.codigoArticulo);
    if (!Number.isInteger(codigo)) {
      return {
        ok: false,
        estado: 400,
        error: `Código de artículo no válido: ${String(linea.codigoArticulo)}`,
      };
    }
    codigos.push(codigo);
  }

  // Dos sesiones del mismo servicio a distinta hora son dos lineas legitimas.
  // Lo que no se admite es repetir exactamente la misma combinacion.
  const claves = lineas.map((linea, i) =>
    identidadLinea(
      codigos[i],
      typeof linea.slotId === 'string' ? linea.slotId : undefined,
      typeof linea.talla === 'string' ? linea.talla : undefined,
    ),
  );

  if (new Set(claves).size !== claves.length) {
    return {
      ok: false,
      estado: 400,
      error: 'El pedido repite el mismo artículo, horario y talla dos veces',
    };
  }

  const catalogo = await resolverCatalogo(codigos);

  // --- Construccion de las lineas definitivas ---
  const items: LineaResuelta[] = [];
  const unidadesPorArticulo = new Map<string, number>();
  let total = 0;

  for (let i = 0; i < lineas.length; i += 1) {
    const linea = lineas[i];
    const codigo = codigos[i];
    const entradaCatalogo = catalogo.get(codigo);

    if (!entradaCatalogo) {
      return { ok: false, estado: 400, error: `El artículo ${codigo} no está disponible` };
    }

    const quantity = Number(linea.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { ok: false, estado: 400, error: `Cantidad no válida para el artículo ${codigo}` };
    }

    const esServicio = entradaCatalogo.tipo === OrderItemTipo.SERVICIO;
    const talla = !esServicio && typeof linea.talla === 'string' ? linea.talla : undefined;

    // Con varias lineas del mismo articulo hay que sumar: tres reservas de
    // una plaza agotan un servicio de tres plazas igual que una reserva de
    // tres. En un producto la cuenta va por talla, porque el stock tambien.
    const clave = identidadLinea(codigo, undefined, talla);
    const acumulado = (unidadesPorArticulo.get(clave) ?? 0) + quantity;

    if (esServicio) {
      if (acumulado > entradaCatalogo.maximo) {
        return {
          ok: false,
          estado: 409,
          error: `Solo quedan ${entradaCatalogo.maximo} ${entradaCatalogo.etiqueta} de "${entradaCatalogo.name}"`,
        };
      }
    } else {
      // Quien decide si una talla se puede vender es la capa de servicio de
      // productos: es la misma regla que aplica el cobro al descontar, y
      // resolverla dos veces por separado permitiria aceptar un pedido y
      // luego descontar de otro sitio.
      const motivo = motivoParaNoVender(
        { name: entradaCatalogo.name, tallas: entradaCatalogo.tallas ?? [] },
        talla,
        acumulado,
      );
      if (motivo) {
        // Falta la talla o el producto no la vende: la peticion esta mal
        // formada. Que no queden unidades es un conflicto de estado.
        return { ok: false, estado: esTalla(talla) ? 409 : 400, error: motivo };
      }
    }

    unidadesPorArticulo.set(clave, acumulado);

    items.push({
      codigoArticulo: codigo,
      name: entradaCatalogo.name,
      quantity,
      price: entradaCatalogo.price,
      precioOriginal: entradaCatalogo.price,
      image: entradaCatalogo.image,
      tipo: entradaCatalogo.tipo,
      slotId: esServicio && typeof linea.slotId === 'string' ? linea.slotId : undefined,
      slotLabel: esServicio && typeof linea.slotLabel === 'string' ? linea.slotLabel : undefined,
      talla,
    });

    total += entradaCatalogo.price * quantity;
  }

  // Un solo servicio marcado como presupuesto obliga a revisar el pedido entero:
  // no tiene sentido cobrar la mitad y dejar la otra a la espera.
  const necesitaConfirmacion = lineas.some((_, i) => catalogo.get(codigos[i])?.requiereConfirmacion);

  return { ok: true, items, total: redondearEuros(total), necesitaConfirmacion };
};
