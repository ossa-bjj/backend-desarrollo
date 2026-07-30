import { Schema, model } from 'mongoose';
export var OrderStatus;
(function (OrderStatus) {
    OrderStatus["PENDIENTE"] = "pendiente";
    OrderStatus["PAGADO"] = "pagado";
    OrderStatus["PREPARANDO"] = "preparando";
    OrderStatus["ENVIADO"] = "enviado";
    OrderStatus["ENTREGADO"] = "entregado";
    OrderStatus["CANCELADO"] = "cancelado";
})(OrderStatus || (OrderStatus = {}));
const OrderItemSchema = new Schema({
    codigoArticulo: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    image: { type: String, trim: true },
}, { _id: false });
const OrderSchema = new Schema({
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
            validator: (items) => items.length > 0,
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
}, {
    timestamps: true,
    versionKey: false,
});
export const Order = model('Order', OrderSchema);
