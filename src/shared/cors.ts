import type { CorsOptions } from 'cors';

/**
 * Politica de CORS. La lista de origenes sale entera de ALLOWED_ORIGINS, que
 * se declara como obligatoria en shared/env.ts: aqui no hay ningun dominio
 * escrito. Formato de la variable, separado por comas:
 *
 *   ALLOWED_ORIGINS=https://midominio.com,https://*.midominio.pages.dev
 *
 * Se admite un comodin por entrada, para los despliegues de preview que
 * estrenan subdominio en cada build y no se pueden enumerar. Un `*` suelto
 * abre la API a cualquier origen: solo para desarrollo.
 */

/**
 * La barra final, las mayusculas y las comillas de copiar y pegar en un panel
 * de deploy son las tres formas clasicas de que un origen correcto no case:
 * el navegador manda `https://midominio.com` y la variable dice
 * `"https://midominio.com/"`. Se normalizan los dos lados antes de comparar.
 */
const normalizar = (origen: string): string =>
  origen
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase()
    .replace(/\/+$/, '');

/**
 * Compara un origen con una entrada de la lista. Sin expresiones regulares a
 * proposito: un patron real es `https://*.midominio.dev`, asi que basta con
 * mirar el trozo de antes y el de despues del comodin, y asi no hay que
 * escapar la entrada del entorno para meterla en una regex.
 */
const casaConPatron = (patron: string, candidato: string): boolean => {
  const comodin = patron.indexOf('*');
  if (comodin === -1) return patron === candidato;

  const prefijo = patron.slice(0, comodin);
  const sufijo = patron.slice(comodin + 1);

  // El largo se comprueba aparte: sin esto, `https://*.dev` daria por bueno
  // `https://.dev` por solapamiento del prefijo con el sufijo.
  return (
    candidato.length >= prefijo.length + sufijo.length &&
    candidato.startsWith(prefijo) &&
    candidato.endsWith(sufijo)
  );
};

/** Lista efectiva declarada en ALLOWED_ORIGINS, ya normalizada y sin huecos. */
export const resolverOrigenesPermitidos = (): string[] => [
  ...new Set(
    (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map(normalizar)
      .filter(Boolean),
  ),
];

export const esOrigenPermitido = (
  origen: string,
  permitidos: string[] = resolverOrigenesPermitidos(),
): boolean => {
  const candidato = normalizar(origen);
  return permitidos.some((permitido) => casaConPatron(permitido, candidato));
};

export const corsOptions: CorsOptions = {
  origin: (origen, callback) => {
    // Sin cabecera Origin no hay navegador al que proteger: curl, los health
    // checks de Vercel o el webhook de Stripe entran por aqui. Esta rama es la
    // razon de que la API se leyera bien escribiendo la URL en el navegador
    // (una navegacion directa no manda Origin) mientras el frontend fallaba.
    if (!origen) return callback(null, true);

    if (esOrigenPermitido(origen)) return callback(null, true);

    // Se rechaza sin cabeceras CORS, nunca pasando un Error al callback:
    // el Error lo recoge el manejador de errores de Express y lo convierte en
    // un 500, de modo que un origen no permitido tumbaba todas las rutas
    // —incluida la raiz— en vez de limitarse a que el navegador bloquee la
    // lectura de la respuesta, que es lo que CORS debe hacer.
    console.warn(`CORS: origen no permitido -> ${origen}`);
    callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 204,
};

/**
 * Deja el estado de CORS por escrito en el arranque. env.ts ya impide que la
 * variable falte, pero un valor como `,` la pasa y deja la lista vacia, y eso
 * significa que ningun navegador podra hablar con la API: tiene que verse en
 * los logs y no deducirse de un fallo en el frontend media hora despues.
 */
export const registrarEstadoCors = (): void => {
  const permitidos = resolverOrigenesPermitidos();

  if (permitidos.length === 0) {
    console.error(
      'CORS: ALLOWED_ORIGINS no declara ningun origen valido. ' +
        'Ninguna peticion de navegador sera admitida.',
    );
    return;
  }

  console.log(`CORS activo para: ${permitidos.join(', ')}`);
};
