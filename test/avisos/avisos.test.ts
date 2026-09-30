/**
 * Avisos a la academia por Telegram y por correo.
 *
 * Lo que importa: que cada canal sea opcional, que uno caído no tumbe al otro
 * ni a quien avisa, y que lo que escribe un visitante llegue escapado —si no,
 * un `<a href>` en el nombre de una academia sería un enlace de verdad—.
 *
 * `fetch` está espiado: aquí no sale nada a Telegram ni a Resend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { avisarALaAcademia, avisoParaTelegram } from '../../src/shared/avisos';

const VARIABLES = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'CORREO_ACADEMIA',
  'RESEND_API_KEY',
  'CORREO_REMITENTE',
];

const aviso = {
  titulo: 'Solicitud de propuesta: Seminario',
  datos: [
    ['Academia', '<a href="https://malo.test">Gracie</a>'],
    ['Notas', undefined],
  ] as Array<[string, string | undefined]>,
  accion: 'Respóndela',
};

let espiaFetch: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  VARIABLES.forEach((nombre) => delete process.env[nombre]);
  espiaFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
});

afterEach(() => {
  espiaFetch.mockRestore();
  VARIABLES.forEach((nombre) => delete process.env[nombre]);
});

describe('avisos a la academia', () => {
  it('sin ningún canal configurado no llama a nadie ni falla', async () => {
    const resultado = await avisarALaAcademia(aviso);

    expect(resultado).toEqual({ telegram: false, correo: false });
    expect(espiaFetch).not.toHaveBeenCalled();
  });

  it('con Telegram configurado manda el mensaje al chat de la academia, en HTML', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token-de-prueba';
    process.env.TELEGRAM_CHAT_ID = '-100123';

    const resultado = await avisarALaAcademia(aviso);

    expect(resultado.telegram).toBe(true);
    const [url, opciones] = espiaFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bottoken-de-prueba/sendMessage');
    const cuerpo = JSON.parse(String(opciones.body));
    expect(cuerpo.chat_id).toBe('-100123');
    expect(cuerpo.parse_mode).toBe('HTML');
  });

  it('lo que escribe el visitante llega escapado y los datos vacíos no salen', () => {
    const texto = avisoParaTelegram(aviso);

    expect(texto).not.toContain('<a href');
    expect(texto).toContain('&lt;a href=&quot;https://malo.test&quot;&gt;');
    expect(texto).not.toContain('Notas');
  });

  it('con correo configurado lo manda a CORREO_ACADEMIA', async () => {
    process.env.CORREO_ACADEMIA = 'academia@ejemplo.com';
    process.env.RESEND_API_KEY = 're_prueba';
    process.env.CORREO_REMITENTE = 'Tienda <no-reply@ejemplo.com>';

    const resultado = await avisarALaAcademia(aviso);

    expect(resultado.correo).toBe(true);
    const [url, opciones] = espiaFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const cuerpo = JSON.parse(String(opciones.body));
    expect(cuerpo.to).toEqual(['academia@ejemplo.com']);
    expect(cuerpo.subject).toBe(aviso.titulo);
    expect(cuerpo.html).not.toContain('<a href');
  });

  it('un canal caído no tumba al otro ni lanza', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token-de-prueba';
    process.env.TELEGRAM_CHAT_ID = '-100123';
    process.env.CORREO_ACADEMIA = 'academia@ejemplo.com';
    process.env.RESEND_API_KEY = 're_prueba';
    process.env.CORREO_REMITENTE = 'Tienda <no-reply@ejemplo.com>';
    espiaFetch.mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes('telegram')) throw new Error('Telegram caído');
      return new Response('{}', { status: 200 });
    });

    const resultado = await avisarALaAcademia(aviso);

    expect(resultado).toEqual({ telegram: false, correo: true });
  });
});
