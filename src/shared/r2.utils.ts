import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

const getR2Client = () => {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Faltan credenciales de Cloudflare R2 en las variables de entorno");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
};

/**
 * Extrae la key interna del bucket a partir de lo que haya guardado en base de
 * datos. Hasta ahora se persistia la URL absoluta con el dominio del entorno en
 * el que se subio el fichero, asi que conviven dos formatos y ambos se aceptan:
 *
 *   uploads/123-foto.jpg                                  -> ya es una key
 *   http://localhost:3000/api/media/uploads/123-foto.jpg  -> URL de otro entorno
 *   https://pub-xxx.r2.dev/uploads/123-foto.jpg           -> dominio directo de R2
 *
 * Es deliberadamente independiente de R2_PUBLIC_DOMAIN: si dependiera del valor
 * actual, cambiar de dominio dejaria de reconocer las filas antiguas y los
 * borrados pasarian a fallar en silencio, dejando huerfanos en el bucket.
 */
export const keyFromPublicUrl = (urlOrKey: string): string => {
  if (!urlOrKey) return "";

  if (!/^https?:\/\//i.test(urlOrKey)) {
    return urlOrKey.replace(/^\/+/, "");
  }

  let pathname: string;
  try {
    pathname = new URL(urlOrKey).pathname;
  } catch {
    return urlOrKey;
  }

  // El proxy de imagenes cuelga de /api/media; los dominios publicos de R2 no.
  return pathname.replace(/^\/api\/media\//, "/").replace(/^\/+/, "");
};

/** Construye la URL publica del entorno actual para una key del bucket. */
export const publicUrlFromKey = (key: string): string => {
  if (!key) return "";

  const publicDomain = process.env.R2_PUBLIC_DOMAIN || "";
  if (!publicDomain) return key;

  const cleanDomain = publicDomain.endsWith("/") ? publicDomain.slice(0, -1) : publicDomain;
  return `${cleanDomain}/${key}`;
};

/**
 * Reescribe cualquier valor almacenado a la URL publica del entorno actual.
 * Sirve tanto para las keys nuevas como para las URLs absolutas heredadas, y
 * evita tener que migrar la base de datos para cambiar de dominio.
 */
export const normalizarUrlMedia = (urlOrKey: string): string =>
  publicUrlFromKey(keyFromPublicUrl(urlOrKey));

/**
 * Sube el fichero y devuelve la KEY, no la URL. Guardar la URL absoluta
 * congelaba el dominio del entorno dentro del dato y rompia las imagenes al
 * desplegar; la URL publica se construye al leer con normalizarUrlMedia.
 */
export const uploadToR2 = async (
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  keyFija?: string,
): Promise<string> => {
  const bucketName = process.env.R2_BUCKET_NAME || "assets";
  const s3Client = getR2Client();

  // Con keyFija el objeto se sobrescribe en vez de acumular una copia por
  // subida. Lo usa la semilla para no dejar huerfanos en cada ejecucion.
  const key = keyFija ?? `uploads/${Date.now()}-${fileName.replace(/\s+/g, "_")}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType,
  });

  await s3Client.send(command);

  return key;
};

export const deleteFromR2 = async (key: string): Promise<void> => {
  const bucketName = process.env.R2_BUCKET_NAME || "assets";
  const s3Client = getR2Client();

  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  await s3Client.send(command);
};

export const getFromR2 = async (key: string): Promise<{ stream: Readable; contentType: string }> => {
  const bucketName = process.env.R2_BUCKET_NAME || "assets";
  const s3Client = getR2Client();

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  const response = await s3Client.send(command);
  return {
    stream: response.Body as Readable,
    contentType: response.ContentType || "application/octet-stream",
  };
};
