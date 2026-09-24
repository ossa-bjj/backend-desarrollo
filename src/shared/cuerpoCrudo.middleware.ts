import type { NextFunction, Request, Response } from 'express';

/**
 * Tope del cuerpo. La ruta es pública y esto lee sin parser de por medio, así
 * que sin un límite cualquiera podría mandar un cuerpo enorme y tenerlo en
 * memoria. Un evento de Stripe ronda unos pocos KB.
 */
const LIMITE_BYTES = 512 * 1024;

/**
 * Deja en `req.body` los bytes exactos de la petición, como `Buffer`.
 *
 * Es lo que necesita el webhook de Stripe: la firma se calcula sobre los bytes
 * tal cual llegan, y cualquier re-serialización la rompe.
 *
 * Por qué no `express.raw`: en Vercel no funciona. Su runtime lee el cuerpo
 * entero antes de pasarle la petición a la app, deja `req.body` como el JSON ya
 * parseado, y la petición queda marcada como leída (`complete` a true,
 * `readable` a false). body-parser 2 —el de Express 5— mira esa marca, da por
 * hecho que el cuerpo ya lo leyó otro, y no hace nada. A la verificación le
 * llegaba un objeto, y Stripe rechazaba todas las firmas en producción con el
 * secreto correcto, mientras en local funcionaba.
 *
 * Aquí se escucha `data`/`end` sin mirar esa marca. En local se lee el stream de
 * verdad; en Vercel, el que él mismo deja preparado con los mismos bytes —lo
 * hace sustituyendo `req.on` para esos dos eventos—. Los dos casos quedan
 * cubiertos por `test/webhook/vercel.test.ts`.
 */
export const cuerpoCrudo = (req: Request, res: Response, next: NextFunction): void => {
  const trozos: Buffer[] = [];
  let recibidos = 0;
  let cortado = false;

  req.on('data', (trozo: Buffer) => {
    if (cortado) return;
    recibidos += trozo.length;
    if (recibidos > LIMITE_BYTES) {
      cortado = true;
      res.status(413).json({ error: 'Cuerpo demasiado grande' });
      return;
    }
    trozos.push(trozo);
  });

  req.on('end', () => {
    if (cortado) return;
    req.body = Buffer.concat(trozos);
    next();
  });

  req.on('error', next);
};
