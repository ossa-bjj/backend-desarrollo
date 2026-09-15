import { ServicioModelo } from '../services/servicio.model';
import { ProductoModelo } from '../products/producto.model';
import { keyFromPublicUrl, deleteFromR2 } from './r2.utils';

/**
 * Comprueba si una imagen (por key o por URL) sigue estando referenciada
 * por algún servicio o producto en la base de datos.
 */
export const imagenEnUsoEnCatalogo = async (urlOKey: string): Promise<boolean> => {
  const key = keyFromPublicUrl(urlOKey);
  if (!key) return false;

  const escapada = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patron = new RegExp(escapada + '$');

  const [enServicio, enProducto] = await Promise.all([
    ServicioModelo.exists({
      imagenes: { $in: [key, patron] },
    }),
    ProductoModelo.exists({
      imagenes: { $in: [key, patron] },
    }),
  ]);

  return Boolean(enServicio || enProducto);
};

/**
 * Elimina la imagen de R2 únicamente si ningún otro servicio o producto
 * la está utilizando en la base de datos.
 */
export const borrarDeR2SiNoEstaEnUso = async (urlOKey: string): Promise<boolean> => {
  try {
    const enUso = await imagenEnUsoEnCatalogo(urlOKey);
    if (enUso) {
      // Otra entidad aún la referencia, no se borra el fichero físico de R2
      return false;
    }
    const key = keyFromPublicUrl(urlOKey);
    if (key) {
      await deleteFromR2(key);
      return true;
    }
  } catch (error) {
    console.warn('[R2] Error al intentar borrar imagen no referenciada:', error);
  }
  return false;
};
