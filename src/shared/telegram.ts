/**
 * Mensajes a Telegram a traves de un bot.
 *
 * Una sola llamada a la API de bots (`sendMessage`), sin SDK, por el mismo
 * motivo que `correo.ts`: el SDK no aportaria nada.
 *
 * Degrada igual que el correo: sin `TELEGRAM_BOT_TOKEN` o `TELEGRAM_CHAT_ID` no
 * falla nada, se deja constancia en el log y devuelve `false`. Un aviso que no
 * sale no puede tumbar el cobro ni el webhook que lo disparo.
 *
 * Puesta en marcha: crear el bot con @BotFather (da el token), anadirlo al chat
 * o grupo de la academia y sacar el id de ese chat (por ejemplo con
 * `https://api.telegram.org/bot<token>/getUpdates` tras escribir en el grupo).
 */

const API = 'https://api.telegram.org';

/** Lo que se espera como mucho: el aviso va dentro de un webhook que tiene prisa. */
const ESPERA_MAXIMA_MS = 5000;

export const telegramConfigurado = (): boolean =>
  Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());

/**
 * Envia un mensaje con formato HTML de Telegram (`<b>`, `<i>`...). Quien llama
 * es responsable de escapar lo que venga de fuera. Devuelve `true` solo si
 * Telegram acepto el mensaje.
 */
export const enviarTelegram = async (html: string): Promise<boolean> => {
  if (!telegramConfigurado()) {
    console.warn('Aviso por Telegram no enviado: faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.');
    return false;
  }

  try {
    const respuesta = await fetch(`${API}/bot${process.env.TELEGRAM_BOT_TOKEN!.trim()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID!.trim(),
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
    });

    if (!respuesta.ok) {
      // El cuerpo de error de Telegram no lleva el token: se puede registrar.
      console.error(`Telegram rechazo el aviso (${respuesta.status}):`, await respuesta.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error enviando aviso por Telegram:', (error as Error).message);
    return false;
  }
};
