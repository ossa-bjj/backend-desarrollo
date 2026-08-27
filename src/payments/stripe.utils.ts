import Stripe from 'stripe';

/**
 * Cliente de Stripe creado bajo demanda.
 *
 * Se instancia perezosamente, igual que el cliente de R2: asi el arranque no
 * exige la clave en entornos donde no se cobra (tests, seed, desarrollo sin
 * pasarela), pero cualquier intento real de cobrar falla con un mensaje claro.
 */
let cliente: Stripe | null = null;

export const getStripe = (): Stripe => {
  if (cliente) return cliente;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Falta STRIPE_SECRET_KEY en las variables de entorno');
  }

  cliente = new Stripe(secretKey);
  return cliente;
};

export const getWebhookSecret = (): string => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('Falta STRIPE_WEBHOOK_SECRET en las variables de entorno');
  }
  return secret;
};

/**
 * Stripe trabaja en la unidad minima de la moneda: para euros, centimos enteros.
 * Mandar decimales provoca importes silenciosamente equivocados.
 */
export const aCentimos = (euros: number): number => Math.round(euros * 100);

export const MONEDA = 'eur';

/** Estados de un PaymentIntent que todavia admiten que el cliente pague. */
const REUTILIZABLES: Stripe.PaymentIntent.Status[] = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
];

export const esReutilizable = (intent: Stripe.PaymentIntent): boolean =>
  REUTILIZABLES.includes(intent.status);
