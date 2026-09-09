/**
 * Conversion de importes, en un solo sitio.
 *
 * Habia tres: `redondearEuros` como constante privada de `order.controller.ts`,
 * `aCentimos` dentro de las utilidades de Stripe y un `toFixed(2)` suelto en las
 * de PayPal. Las tres deciden lo mismo —como se redondea un euro— y ninguna
 * conocia a las otras.
 *
 * Por que importa: el total que se guarda en el pedido y el importe que se manda
 * a cobrar tienen que salir del mismo redondeo. Si un dia una de ellas pasara a
 * truncar en vez de redondear, el pedido y el cobro se separarian un centimo, y
 * eso no lo detecta nadie hasta que lo dice un cliente.
 *
 * Se redondea con `Math.round` sobre centimos enteros a proposito: los flotantes
 * no representan 0,1 de forma exacta, y sumar precios sin redondear deja totales
 * como 34,989999999999995.
 */

/** Importe en euros con dos decimales, como numero. Es lo que se persiste. */
export const redondearEuros = (euros: number): number => Math.round(euros * 100) / 100;

/**
 * Importe en centimos enteros, que es la unidad en la que trabaja Stripe.
 * Mandarle decimales provoca importes silenciosamente equivocados.
 */
export const aCentimos = (euros: number): number => Math.round(euros * 100);

/**
 * Importe como cadena con dos decimales, que es lo que exige PayPal en el
 * campo `amount.value` de una orden.
 */
export const comoDecimalDeTexto = (euros: number): string => redondearEuros(euros).toFixed(2);
