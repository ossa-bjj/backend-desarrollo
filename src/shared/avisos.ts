import { enviarCorreo } from './correo';
import { enviarTelegram } from './telegram';

/**
 * Avisos a la academia: lo que alguien tiene que ver sin esperar a entrar al
 * panel. Hoy, tres sucesos: una solicitud de propuesta, una reclamacion de un
 * cobro a su banco y un cobro que no se pudo servir (sin existencias o sin
 * horario).
 *
 * Sale por los dos canales a la vez, y cada uno es opcional:
 *
 *   Telegram  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  (ver `telegram.ts`)
 *   Correo    CORREO_ACADEMIA, con el remitente de siempre (`correo.ts`)
 *
 * Un canal sin configurar o caido no afecta al otro ni a quien avisa: esta
 * funcion no lanza nunca. El suceso ya esta guardado donde corresponde —la
 * solicitud en su coleccion, la reclamacion y la incidencia en el pedido—, asi
 * que perder un aviso no pierde el dato.
 */

export interface Aviso {
  /** Una linea: lo que ha pasado. Va de titulo en Telegram y de asunto en el correo. */
  titulo: string;
  /** Datos del suceso, en orden. Se escapan aqui: pueden venir de un visitante. */
  datos: Array<[etiqueta: string, valor: string | number | undefined]>;
  /** Que hay que hacer, si hay algo que hacer. */
  accion?: string;
}

/**
 * Escapa un texto para meterlo en HTML, tanto el del correo como el del modo
 * HTML de Telegram. Imprescindible con lo que escribe un visitante: sin esto,
 * un `<a href=...>` en el nombre de una academia llegaria como enlace de verdad.
 */
export const escaparHtml = (valor: string): string =>
  valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const presentes = (datos: Aviso['datos']) =>
  datos.filter(([, valor]) => valor !== undefined && valor !== '') as Array<[string, string | number]>;

/** El aviso en el HTML reducido que admite Telegram (`<b>`, `<i>`, sin tablas). */
export const avisoParaTelegram = ({ titulo, datos, accion }: Aviso): string =>
  [
    `<b>${escaparHtml(titulo)}</b>`,
    '',
    ...presentes(datos).map(
      ([etiqueta, valor]) => `<b>${escaparHtml(etiqueta)}:</b> ${escaparHtml(String(valor))}`,
    ),
    ...(accion ? ['', `<i>${escaparHtml(accion)}</i>`] : []),
  ].join('\n');

const avisoParaCorreo = ({ titulo, datos, accion }: Aviso): string => `
  <p><strong>${escaparHtml(titulo)}</strong></p>
  <table cellpadding="4">
    ${presentes(datos)
      .map(
        ([etiqueta, valor]) =>
          `<tr><th align="left">${escaparHtml(etiqueta)}</th><td>${escaparHtml(String(valor))}</td></tr>`,
      )
      .join('')}
  </table>
  ${accion ? `<p><em>${escaparHtml(accion)}</em></p>` : ''}
`;

const enviarCorreoALaAcademia = async (aviso: Aviso): Promise<boolean> => {
  const destino = process.env.CORREO_ACADEMIA?.trim();
  if (!destino) {
    console.warn(`Aviso por correo no enviado ("${aviso.titulo}"): falta CORREO_ACADEMIA.`);
    return false;
  }
  return enviarCorreo({ para: destino, asunto: aviso.titulo, html: avisoParaCorreo(aviso) });
};

/**
 * Manda el aviso por los dos canales. Se espera a los dos —en serverless, lo
 * que no se espera antes de responder puede no llegar a salir— pero nunca
 * lanza: devuelve por donde salio.
 */
export const avisarALaAcademia = async (aviso: Aviso): Promise<{ telegram: boolean; correo: boolean }> => {
  const [telegram, correo] = await Promise.allSettled([
    enviarTelegram(avisoParaTelegram(aviso)),
    enviarCorreoALaAcademia(aviso),
  ]);

  return {
    telegram: telegram.status === 'fulfilled' && telegram.value,
    correo: correo.status === 'fulfilled' && correo.value,
  };
};

/** Referencia corta de un pedido, la misma que enseña el panel. */
export const referenciaDePedido = (id: unknown): string => String(id).slice(-6).toUpperCase();
