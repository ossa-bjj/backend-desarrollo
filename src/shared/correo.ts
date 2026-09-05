/**
 * Envio de correo transaccional.
 *
 * Habla con la API REST de Resend por HTTP, sin SDK, por el mismo motivo que
 * `paypal.utils.ts`: es una sola llamada y el SDK no aporta nada aqui.
 *
 * Degrada a proposito: sin credenciales el servidor NO falla, deja constancia
 * en el log y devuelve `false`. Un correo que no sale no puede tumbar el alta
 * de un usuario ni una recuperacion de contrasena, pero tiene que verse.
 */

const API = 'https://api.resend.com/emails';

export interface Correo {
  para: string;
  asunto: string;
  html: string;
}

export const correoConfigurado = (): boolean =>
  Boolean(process.env.RESEND_API_KEY?.trim() && process.env.CORREO_REMITENTE?.trim());

/** Devuelve `true` solo si el proveedor acepto el envio. */
export const enviarCorreo = async ({ para, asunto, html }: Correo): Promise<boolean> => {
  if (!correoConfigurado()) {
    console.warn(
      `Correo no enviado a ${para} ("${asunto}"): faltan RESEND_API_KEY o CORREO_REMITENTE. ` +
        'El flujo continua, pero el destinatario no recibira nada.',
    );
    return false;
  }

  try {
    const respuesta = await fetch(API, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    process.env.CORREO_REMITENTE,
        to:      [para],
        subject: asunto,
        html,
      }),
    });

    if (!respuesta.ok) {
      console.error(`Resend rechazo el envio a ${para} (${respuesta.status}):`, await respuesta.text());
      return false;
    }

    return true;
  } catch (error) {
    // Un proveedor caido no puede propagar el fallo al flujo que lo llamo.
    console.error(`Error enviando correo a ${para}:`, (error as Error).message);
    return false;
  }
};

/**
 * Correo de recuperacion de contrasena.
 *
 * El enlace apunta al frontend, no a la API: quien recoge el token y pide la
 * contrasena nueva es la pantalla de recuperacion.
 */
export const enviarCorreoDeRecuperacion = (para: string, enlace: string): Promise<boolean> =>
  enviarCorreo({
    para,
    asunto: 'Recupera tu contrasena',
    html: `
      <p>Has pedido restablecer tu contrasena.</p>
      <p><a href="${enlace}">Elegir una contrasena nueva</a></p>
      <p>El enlace caduca en una hora. Si no has sido tu, ignora este correo.</p>
    `,
  });
