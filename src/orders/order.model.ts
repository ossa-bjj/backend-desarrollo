import type { Types } from 'mongoose';
import { Schema, model } from 'mongoose';

export enum OrderStatus {
  // El pedido lleva algun servicio que un admin debe revisar y tarificar
  // antes de que el cliente pueda pagarlo.
  PENDIENTE_CONFIRMACION = 'pendiente_confirmacion',
  // Confirmado y pagable: el total del pedido ya es definitivo.
  PENDIENTE = 'pendiente',
  PAGADO = 'pagado',
  PREPARANDO = 'preparando',
  ENVIADO = 'enviado',
  ENTREGADO = 'entregado',
  CANCELADO = 'cancelado',
  // La administracion no acepta el pedido; libera los horarios retenidos.
  RECHAZADO = 'rechazado',
}

/** Estados desde los que el cliente todavia no puede pagar. */
export const ESTADOS_NO_PAGABLES: OrderStatus[] = [
  OrderStatus.PENDIENTE_CONFIRMACION,
  OrderStatus.CANCELADO,
  OrderStatus.RECHAZADO,
];

export enum OrderItemTipo {
  PRODUCTO = 'producto',
  SERVICIO = 'servicio',
}

export interface IOrderItem {
  codigoArticulo: number;
  name: string;
  quantity: number;
  price: number;
  image?: string;
  tipo: OrderItemTipo;
  // Precio de catalogo en el momento de crear el pedido. Se conserva aunque el
  // admin ajuste `price`, para que quede rastro de por que cambio el importe.
  precioOriginal: number;
  motivoAjuste?: string;
  // Reserva asociada cuando la linea es un servicio con horario.
  slotId?: string;
  slotLabel?: string;
  /**
   * Talla pedida, cuando la linea es un producto. Se guarda en el pedido y no
   * se consulta al catalogo porque el stock del que hay que descontar es el de
   * ESTA talla, y porque el pedido tiene que seguir diciendo que se compro
   * aunque el producto cambie de tallas despues.
   */
  talla?: string;
}

export interface IOrder {
  user: Types.ObjectId;
  items: IOrderItem[];
  total: number;
  status: OrderStatus;
  shippingAddress?: {
    calle: string;
    ciudad: string;
    provincia: string;
    codigoPostal: string;
    pais: string;
  };
  pago?: {
    proveedor: string;
    paymentIntentId: string;
    estado: string;
    pagadoEn?: Date;
    /**
     * Referencia del reembolso en la pasarela y cuando se hizo. Se guarda para
     * que el panel pueda distinguir un pedido cancelado y devuelto de uno
     * cancelado a secas, y para no reembolsar dos veces el mismo cobro.
     */
    reembolsoId?: string;
    reembolsadoEn?: Date;
  };
  /**
   * Lineas que se cobraron sin existencias suficientes.
   *
   * Vive en el pedido y no solo en el log del servidor porque hay que actuar
   * sobre ella: el dinero esta cobrado y el articulo no existe, asi que alguien
   * tiene que ver el caso y decidir si repone o devuelve. Un `console.error` no
   * lo lee nadie.
   */
  incidenciasStock?: Array<{
    codigoArticulo: number;
    talla?: string;
    solicitadas: number;
    detectadaEn: Date;
  }>;
  confirmadoEn?: Date;
  confirmadoPor?: Types.ObjectId;
  motivoRechazo?: string;
}

const OrderItemSchema = new Schema<IOrderItem>(
  {
    codigoArticulo: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    image: { type: String, trim: true },
    tipo: {
      type: String,
      enum: Object.values(OrderItemTipo),
      required: true,
      default: OrderItemTipo.PRODUCTO,
    },
    precioOriginal: { type: Number, required: true, min: 0 },
    motivoAjuste: { type: String, trim: true },
    slotId: { type: String, trim: true },
    slotLabel: { type: String, trim: true },
    talla: { type: String, trim: true },
  },
  { _id: false },
);

const OrderSchema = new Schema<IOrder>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    items: {
      type: [OrderItemSchema],
      required: true,
      validate: {
        validator: (items: IOrderItem[]) => items.length > 0,
        message: 'El pedido debe tener al menos un producto',
      },
    },
    total: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: Object.values(OrderStatus),
      default: OrderStatus.PENDIENTE,
      index: true,
    },
    shippingAddress: {
      calle: { type: String, trim: true },
      ciudad: { type: String, trim: true },
      provincia: { type: String, trim: true },
      codigoPostal: { type: String, trim: true },
      pais: { type: String, trim: true },
    },
    // Rastro del cobro. `paymentIntentId` permite reutilizar el intento si el
    // cliente vuelve a la pantalla de pago sin haber terminado.
    pago: {
      proveedor: { type: String, trim: true },
      paymentIntentId: { type: String, trim: true, index: true },
      estado: { type: String, trim: true },
      pagadoEn: { type: Date },
      reembolsoId: { type: String, trim: true },
      reembolsadoEn: { type: Date },
    },
    incidenciasStock: {
      type: [
        new Schema(
          {
            codigoArticulo: { type: Number, required: true },
            talla: { type: String, trim: true },
            solicitadas: { type: Number, required: true },
            detectadaEn: { type: Date, required: true, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    confirmadoEn: { type: Date },
    confirmadoPor: { type: Schema.Types.ObjectId, ref: 'User' },
    motivoRechazo: { type: String, trim: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Order = model<IOrder>('Order', OrderSchema);

/**
 * Identidad de una linea dentro de un pedido.
 *
 * No basta el codigo de articulo: un pedido puede llevar dos sesiones del mismo
 * servicio a horas distintas, o la misma camiseta en dos tallas, y en los dos
 * casos son lineas legitimas y distinguibles. La identidad es articulo MAS
 * horario MAS talla.
 *
 * Existe como funcion unica a proposito. El alta del pedido y la confirmacion
 * del presupuesto tienen que generar exactamente la misma identidad para la
 * misma linea; si divergen, los ajustes del admin dejan de encontrar su linea
 * en silencio, sin error, sin aplicarse.
 *
 * CONTRATO CON EL FRONTEND. El cliente tiene su gemela en
 * `frontend/src/utils/identidadLinea.ts`, y las dos deben producir exactamente
 * la misma cadena para la misma linea. No se puede compartir el codigo: son dos
 * runtimes distintos. Si cambia el formato, cambia en los dos repositorios a la
 * vez. (El aviso ya estaba escrito en el lado del cliente y faltaba en este.)
 */
export const identidadLinea = (codigoArticulo: number, slotId?: string, talla?: string): string =>
  `${codigoArticulo}#${slotId ?? ''}#${talla ?? ''}`;
