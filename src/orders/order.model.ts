import { Schema, model, Types } from 'mongoose';

export enum OrderStatus {
  PENDIENTE = 'pendiente',
  PAGADO = 'pagado',
  PREPARANDO = 'preparando',
  ENVIADO = 'enviado',
  ENTREGADO = 'entregado',
  CANCELADO = 'cancelado',
}

export interface IOrderItem {
  codigoArticulo: number;
  name: string;
  quantity: number;
  price: number;
  image?: string;
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
}

const OrderItemSchema = new Schema<IOrderItem>(
  {
    codigoArticulo: { type: Number, required: true },
    name:           { type: String, required: true, trim: true },
    quantity:       { type: Number, required: true, min: 1 },
    price:          { type: Number, required: true, min: 0 },
    image:          { type: String, trim: true },
  },
  { _id: false },
);

const OrderSchema = new Schema<IOrder>(
  {
    user: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },
    items: {
      type:     [OrderItemSchema],
      required: true,
      validate: {
        validator: (items: IOrderItem[]) => items.length > 0,
        message:   'El pedido debe tener al menos un producto',
      },
    },
    total:  { type: Number, required: true, min: 0 },
    status: {
      type:    String,
      enum:    Object.values(OrderStatus),
      default: OrderStatus.PENDIENTE,
      index:   true,
    },
    shippingAddress: {
      calle:        { type: String, trim: true },
      ciudad:       { type: String, trim: true },
      provincia:    { type: String, trim: true },
      codigoPostal: { type: String, trim: true },
      pais:         { type: String, trim: true },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Order = model<IOrder>('Order', OrderSchema);
