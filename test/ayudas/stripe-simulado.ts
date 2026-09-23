/**
 * SDK de Stripe simulado.
 *
 * Iniciar un pago o reembolsar llaman a la API de Stripe de verdad. Aquí se
 * sustituye el cliente entero por uno de mentira que apunta lo que se le pide:
 * lo que hay que comprobar no es qué contesta Stripe, sino **con qué se le
 * llama** —importe en céntimos, metadata con el pedido, método correcto— y qué
 * hace el servidor con la respuesta.
 *
 * El fichero que lo use tiene que declarar el mock antes de importar la app:
 *
 *   vi.mock('../../src/payments/stripe.utils', async () => {
 *     const { moduloStripeSimulado } = await import('../ayudas/stripe-simulado');
 *     return moduloStripeSimulado();
 *   });
 */

import { vi } from 'vitest';
import type * as moduloStripe from '../../src/payments/stripe.utils';

type ModuloStripe = typeof moduloStripe;

export type LlamadaCrear = {
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
  payment_method_types?: string[];
};

export const stripeSimulado = {
  paymentIntents: {
    create: vi.fn(async (params: LlamadaCrear) => ({
      id: 'pi_creado_en_el_test',
      client_secret: 'pi_creado_en_el_test_secret',
      status: 'requires_payment_method',
      amount: params.amount,
    })),
    retrieve: vi.fn(async (id: string) => ({
      id,
      client_secret: `${id}_secret`,
      status: 'requires_payment_method',
      amount: 5000,
    })),
    update: vi.fn(async (id: string, params: { amount: number }) => ({
      id,
      client_secret: `${id}_secret`,
      status: 'requires_payment_method',
      amount: params.amount,
    })),
  },
  refunds: {
    create: vi.fn(async (_params: { payment_intent: string }) => ({
      id: 're_creado_en_el_test',
      status: 'succeeded',
    })),
  },
};

/** Deja el simulado como recién estrenado. Va en un `beforeEach`. */
export const reiniciarStripeSimulado = (): void => {
  vi.clearAllMocks();
  stripeSimulado.paymentIntents.retrieve.mockImplementation(async (id: string) => ({
    id,
    client_secret: `${id}_secret`,
    status: 'requires_payment_method',
    amount: 5000,
  }));
};

/**
 * Reemplazo de `stripe.utils`. Se conserva todo lo que no habla con la red
 * —`MONEDA`, `esReutilizable`— porque son reglas nuestras y deben probarse tal
 * cual son, no simuladas.
 */
export const moduloStripeSimulado = async () => {
  const real = await vi.importActual<ModuloStripe>('../../src/payments/stripe.utils');

  return {
    ...real,
    getStripe: () => stripeSimulado,
  };
};
