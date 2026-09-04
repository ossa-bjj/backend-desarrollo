/**
 * Cliente REST de PayPal (Orders v2).
 *
 * Se habla con la API por HTTP directamente, sin SDK: el flujo que necesitamos
 * son tres llamadas (token, crear orden, capturar) y el SDK oficial arrastra
 * mas superficie de la que usariamos.
 *
 * Mismo criterio perezoso que `stripe.utils.ts`: el arranque no exige las
 * credenciales, pero cualquier intento real de cobrar falla con un mensaje que
 * dice exactamente que variable falta.
 */

const SANDBOX = 'https://api-m.sandbox.paypal.com';
const PRODUCCION = 'https://api-m.paypal.com';

export const MONEDA_PAYPAL = 'EUR';

interface Credenciales {
  clientId: string;
  clientSecret: string;
  base: string;
}

const getCredenciales = (): Credenciales => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Faltan PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET en las variables de entorno');
  }

  // Cualquier valor distinto de "live" se trata como pruebas: equivocarse hacia
  // el sandbox no cobra a nadie, equivocarse hacia produccion si.
  const base = process.env.PAYPAL_ENTORNO === 'live' ? PRODUCCION : SANDBOX;

  return { clientId, clientSecret, base };
};

/**
 * Token OAuth cacheado en el proceso.
 *
 * Es cache, no estado de negocio: si la instancia serverless se recicla se pide
 * otro y no se pierde nada. Se renueva un minuto antes de caducar para que una
 * peticion no salga con un token que expira en vuelo.
 */
let tokenCacheado: { valor: string; expiraEn: number } | null = null;

const obtenerAccessToken = async (): Promise<string> => {
  if (tokenCacheado && Date.now() < tokenCacheado.expiraEn) return tokenCacheado.valor;

  const { clientId, clientSecret, base } = getCredenciales();
  const credencial = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const respuesta = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${credencial}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!respuesta.ok) {
    throw new Error(`PayPal rechazo las credenciales (${respuesta.status})`);
  }

  const datos = (await respuesta.json()) as { access_token: string; expires_in: number };
  tokenCacheado = {
    valor:    datos.access_token,
    expiraEn: Date.now() + (datos.expires_in - 60) * 1000,
  };

  return datos.access_token;
};

const llamar = async <T>(ruta: string, init: RequestInit): Promise<T> => {
  const { base } = getCredenciales();
  const token = await obtenerAccessToken();

  const respuesta = await fetch(`${base}${ruta}`, {
    ...init,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  const cuerpo = await respuesta.text();

  if (!respuesta.ok) {
    // El detalle de PayPal se queda en el log del servidor: al cliente solo le
    // llega el mensaje generico que ya emite el controlador.
    console.error(`Error de PayPal en ${ruta} (${respuesta.status}):`, cuerpo);
    throw new Error(`PayPal respondio ${respuesta.status}`);
  }

  return JSON.parse(cuerpo) as T;
};

interface OrdenPayPal {
  id: string;
  status: string;
  links?: Array<{ rel: string; href: string }>;
}

export interface OrdenCreada {
  id: string;
  /** URL de PayPal a la que hay que mandar al cliente para que apruebe el pago. */
  approveUrl: string;
}

/**
 * Crea una orden de PayPal por el importe del pedido.
 *
 * `custom_id` lleva el id de nuestro pedido: es lo que permite reconciliar el
 * cobro con el pedido al capturar, igual que `metadata.orderId` en Stripe.
 */
export const crearOrdenPayPal = async (
  pedidoId: string,
  total: number,
  returnUrl: string,
  cancelUrl: string,
): Promise<OrdenCreada> => {
  const orden = await llamar<OrdenPayPal>('/v2/checkout/orders', {
    method: 'POST',
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: pedidoId,
          custom_id:    pedidoId,
          amount: {
            currency_code: MONEDA_PAYPAL,
            // PayPal quiere el importe como cadena con dos decimales.
            value: total.toFixed(2),
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url:  returnUrl,
            cancel_url:  cancelUrl,
            user_action: 'PAY_NOW',
            // Sin esto PayPal pide direccion de envio otra vez, que ya tenemos.
            shipping_preference: 'NO_SHIPPING',
          },
        },
      },
    }),
  });

  // Con `experience_context` el enlace viene como `payer-action`; sin el, como
  // `approve`. Se aceptan los dos para no depender de ese detalle.
  const enlace = orden.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  if (!enlace) {
    throw new Error('PayPal no devolvio enlace de aprobacion');
  }

  return { id: orden.id, approveUrl: enlace.href };
};

/**
 * Comprueba que un webhook viene de PayPal de verdad.
 *
 * PayPal no firma con un secreto compartido como Stripe: hay que preguntarle a
 * el si la firma es buena, mandandole las cabeceras del aviso y el evento tal
 * como llego. Sin esta comprobacion, cualquiera que conozca la URL podria dar
 * un pedido por cobrado con una peticion falsa.
 *
 * Falla cerrado: si no hay `PAYPAL_WEBHOOK_ID` no se puede verificar nada, asi
 * que el aviso se rechaza en vez de creerselo.
 */
export const firmaDeWebhookEsValida = async (
  cabeceras: Record<string, string | string[] | undefined>,
  evento: unknown,
): Promise<boolean> => {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    console.error('Falta PAYPAL_WEBHOOK_ID: no se puede verificar el webhook de PayPal');
    return false;
  }

  const leer = (nombre: string): string => {
    const valor = cabeceras[nombre];
    return Array.isArray(valor) ? (valor[0] ?? '') : (valor ?? '');
  };

  const cuerpo = {
    auth_algo:         leer('paypal-auth-algo'),
    cert_url:          leer('paypal-cert-url'),
    transmission_id:   leer('paypal-transmission-id'),
    transmission_sig:  leer('paypal-transmission-sig'),
    transmission_time: leer('paypal-transmission-time'),
    webhook_id:        webhookId,
    webhook_event:     evento,
  };

  if (Object.entries(cuerpo).some(([clave, valor]) => clave !== 'webhook_event' && !valor)) {
    console.error('Webhook de PayPal sin las cabeceras de firma completas');
    return false;
  }

  try {
    const { verification_status } = await llamar<{ verification_status: string }>(
      '/v1/notifications/verify-webhook-signature',
      { method: 'POST', body: JSON.stringify(cuerpo) },
    );
    return verification_status === 'SUCCESS';
  } catch (error) {
    console.error('No se pudo verificar la firma del webhook de PayPal:', (error as Error).message);
    return false;
  }
};

export interface CapturaPayPal {
  estado: string;
  completada: boolean;
  /** Id de pedido que viajaba en la orden, para comprobar que se cobro lo que se pidio. */
  pedidoId?: string;
}

/**
 * Captura el dinero de una orden ya aprobada por el cliente.
 *
 * `PayPal-Request-Id` la hace idempotente: si el cliente recarga la pagina de
 * retorno, PayPal devuelve la captura que ya hizo en vez de cobrar dos veces.
 */
export const capturarOrdenPayPal = async (paypalOrderId: string): Promise<CapturaPayPal> => {
  const orden = await llamar<OrdenPayPal & {
    purchase_units?: Array<{ custom_id?: string; payments?: unknown }>;
  }>(`/v2/checkout/orders/${paypalOrderId}/capture`, {
    method:  'POST',
    headers: { 'PayPal-Request-Id': `captura-${paypalOrderId}` },
    body:    '{}',
  });

  return {
    estado:     orden.status,
    completada: orden.status === 'COMPLETED',
    pedidoId:   orden.purchase_units?.[0]?.custom_id,
  };
};
