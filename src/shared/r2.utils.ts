import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

// Inicializar cliente S3 compatible con Cloudflare R2
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
 * Sube un buffer de imagen a Cloudflare R2
 */
export const uploadToR2 = async (fileBuffer: Buffer, fileName: string, mimeType: string): Promise<string> => {
  const bucketName = process.env.R2_BUCKET_NAME || "assets";
  const publicDomain = process.env.R2_PUBLIC_DOMAIN || "";
  const s3Client = getR2Client();

  const key = `uploads/${Date.now()}-${fileName.replace(/\s+/g, "_")}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType,
  });

  await s3Client.send(command);

  // Retorna la URL pública de la imagen
  if (publicDomain) {
    const cleanDomain = publicDomain.endsWith("/") ? publicDomain.slice(0, -1) : publicDomain;
    return `${cleanDomain}/${key}`;
  }

  return key;
};

/**
 * Elimina un objeto de Cloudflare R2 por su clave (key)
 */
export const deleteFromR2 = async (key: string): Promise<void> => {
  const bucketName = process.env.R2_BUCKET_NAME || "assets";
  const s3Client = getR2Client();

  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  await s3Client.send(command);
};
