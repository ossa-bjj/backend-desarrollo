import { uploadToR2, keyFromPublicUrl, esReferenciaDeNuestroAlmacen } from './r2.utils';

/**
 * Trae una imagen de fuera y se queda una copia en R2.
 *
 * Existe porque pegar el enlace de una foto ajena no funciona: la URL de una
 * pagina (`instagram.com/p/...`) no es una imagen, y la del CDN que hay detras
 * viene firmada y caduca en unos dias. Guardar una copia propia es lo unico que
 * hace que la portada siga viendose dentro de un mes.
 *
 * Acepta las dos formas de enlace que pega alguien en la practica: la de la
 * imagen y la de la pagina que la contiene, de la que se saca su `og:image`.
 */

/**
 * Tope del HTML del que se saca la metaetiqueta. Generoso a proposito: la
 * pagina de un post de Instagram ronda los 700 KB, casi todo javascript, y con
 * un margen mas justo se rechazaba precisamente el caso que hay que cubrir.
 */
const MAXIMO_HTML = 4 * 1024 * 1024;

/** Tope de la propia imagen, del orden de lo que admite la subida por archivo. */
const MAXIMO_IMAGEN = 8 * 1024 * 1024;

const ESPERA_MS = 15_000;

const TIPOS_ADMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/**
 * El servidor va a pedir la URL que le manden, asi que hay que acotar a donde
 * puede ir: sin esto, un enlace a `localhost` o a una IP privada convertiria
 * este endpoint en una ventana a la red interna del despliegue.
 */
const esDestinoPermitido = (url: URL): boolean => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  // `hostname` devuelve las direcciones IPv6 entre corchetes —`[fd00::1]`—, asi
  // que hay que quitarlos antes de comparar. Sin esto, las comprobaciones de
  // IPv6 de abajo miraban una cadena que empieza por `[` y no casaban nunca:
  // las direcciones locales `fd00::/8` y `fe80::/10` pasaban el filtro.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;

  // IPv4 privada, bucle local y enlace local (la metadata de los proveedores
  // cuelga de 169.254.169.254).
  if (/^(10|127)\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;

  // IPv6: bucle local, direccion sin especificar, unicas locales (fc00::/7) y
  // enlace local (fe80::/10).
  if (host === '::1' || host === '::') return false;
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return false;
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return false;

  return true;
};

const pedir = (url: string): Promise<Response> =>
  fetch(url, {
    signal: AbortSignal.timeout(ESPERA_MS),
    headers: {
      // Sin un agente reconocible, Instagram y otros devuelven el muro de login
      // en vez de la pagina con sus metaetiquetas.
      'User-Agent': 'Mozilla/5.0 (compatible; OssaBJJ/1.0; +https://ossabjj.com)',
      Accept: 'text/html,image/*;q=0.9,*/*;q=0.8',
    },
  });

/** Saca la imagen que la propia pagina declara como su representacion. */
const imagenDeclaradaEn = (html: string): string | null => {
  const etiqueta =
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html) ??
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i.exec(html);

  if (!etiqueta) return null;

  // El HTML escapa los `&` de la query, y sin deshacerlo la URL firmada no vale.
  return etiqueta[1]
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/');
};

const enMegas = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

const leerAcotado = async (respuesta: Response, tope: number): Promise<Buffer> => {
  const declarado = Number(respuesta.headers.get('content-length') ?? 0);
  if (declarado > tope) {
    throw new Error(`El archivo pesa ${enMegas(declarado)} MB y el maximo son ${enMegas(tope)} MB`);
  }

  const datos = Buffer.from(await respuesta.arrayBuffer());
  // La cabecera puede faltar o mentir: se comprueba tambien lo que llego.
  if (datos.byteLength > tope) {
    throw new Error(`El archivo pesa ${enMegas(datos.byteLength)} MB y el maximo son ${enMegas(tope)} MB`);
  }
  return datos;
};

const extensionDe = (mime: string): string =>
  ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
  })[mime] ?? 'jpg';

/**
 * Descarga la imagen que haya en `origen` y devuelve su key en R2.
 *
 * `origen` puede ser la URL de la imagen o la de la pagina que la contiene.
 * Lanza con un mensaje explicable si no hay imagen que traer: es preferible a
 * guardar la noticia con una portada que no se va a ver, que es justo lo que
 * pasaba antes.
 */
export const copiarImagenRemotaAR2 = async (origen: string, nombreBase: string): Promise<string> => {
  let url: URL;
  try {
    url = new URL(origen);
  } catch {
    throw new Error('La direccion de la imagen no es una URL valida');
  }

  if (!esDestinoPermitido(url)) {
    throw new Error('Esa direccion no se puede descargar');
  }

  let respuesta = await pedir(url.toString());
  if (!respuesta.ok) {
    throw new Error(`No se pudo descargar la imagen (el servidor respondio ${respuesta.status})`);
  }

  let tipo = (respuesta.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();

  // Es una pagina, no una imagen: se busca la que ella misma declara.
  if (tipo.startsWith('text/html')) {
    const html = (await leerAcotado(respuesta, MAXIMO_HTML)).toString('utf8');
    const declarada = imagenDeclaradaEn(html);
    if (!declarada) {
      throw new Error('Esa pagina no declara ninguna imagen que se pueda usar de portada');
    }

    const urlDeclarada = new URL(declarada, url);
    if (!esDestinoPermitido(urlDeclarada)) {
      throw new Error('Esa direccion no se puede descargar');
    }

    respuesta = await pedir(urlDeclarada.toString());
    if (!respuesta.ok) {
      throw new Error(`No se pudo descargar la imagen de la pagina (${respuesta.status})`);
    }
    tipo = (respuesta.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  }

  if (!TIPOS_ADMITIDOS.includes(tipo)) {
    throw new Error(`Ese enlace no lleva a una imagen (llego ${tipo || 'un tipo desconocido'})`);
  }

  const datos = await leerAcotado(respuesta, MAXIMO_IMAGEN);
  const nombre = `${nombreBase.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'portada'}.${extensionDe(tipo)}`;

  return uploadToR2(datos, nombre, tipo);
};

/**
 * Deja la portada lista para guardar.
 *
 * Lo que ya vive en el bucket se queda como esta —volver a editar la noticia no
 * puede duplicar su imagen en cada guardado—; lo que viene de fuera se copia.
 */
/**
 * Saca el enlace del post del codigo de insercion de Instagram.
 *
 * Del bloque que da Instagram al pulsar «Insertar» solo hace falta el
 * permalink: con el, su propio script monta la publicacion entera. Guardar el
 * HTML tal cual seria meter en la base marcado ajeno con estilos y enlaces
 * dentro, y habria que pintarlo sin escapar para que sirviera de algo.
 *
 * Admite tambien el enlace pelado, que es lo que sale de «Copiar enlace».
 * Devuelve `null` si ahi no hay ningun post.
 */
export const enlaceDePostDeInstagram = (valor: string): string | null => {
  const permalink =
    /data-instgrm-permalink=["']([^"']+)["']/i.exec(valor)?.[1] ??
    (/^\s*https?:\/\/(www\.)?instagram\.com\//i.test(valor) ? valor.trim() : null);

  if (!permalink) return null;

  // `/p/` son publicaciones y `/reel/` videos; ambos se pueden insertar.
  const codigo = /instagram\.com\/(p|reel)\/([\w-]+)/i.exec(permalink);
  if (!codigo) return null;

  // Se normaliza sin los parametros de campana que arrastra el enlace copiado.
  return `https://www.instagram.com/${codigo[1]}/${codigo[2]}/`;
};

export const resolverPortada = async (valor: string, nombreBase: string): Promise<string> => {
  const limpio = valor.trim();
  if (!limpio) return '';

  // Lo que ya esta en el bucket se queda con su key; lo de fuera se copia.
  if (esReferenciaDeNuestroAlmacen(limpio)) return keyFromPublicUrl(limpio);

  return copiarImagenRemotaAR2(limpio, nombreBase);
};
