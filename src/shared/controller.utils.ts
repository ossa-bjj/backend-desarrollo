import type { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { UserRole } from '../users/user.model';
// Carga la declaracion global de Express.Request.user (definida en token.utils).
// Sin ella, quien compile este fichero por separado —ts-node-dev lo hace en cada
// recarga— no conoce `req.user` y el arranque falla aunque `tsc` pase.
import './token.utils';

/**
 * Nombres de los campos que Mongoose rechazo, sin el resto del mensaje.
 *
 * El texto crudo de Mongoose nombra la coleccion y la ruta interna del modelo;
 * la lista de campos, en cambio, es justo lo que necesita saber quien llama
 * para corregir la peticion, y no cuenta nada del interior.
 */
const camposInvalidos = (error: unknown): string[] => {
  const errores = (error as { errors?: Record<string, unknown> }).errors;
  return errores ? Object.keys(errores) : [];
};

/**
 * Respuesta unica para un fallo no previsto.
 *
 * El detalle se registra en el servidor y no viaja al cliente: los mensajes de
 * Mongoose y de los drivers nombran colecciones, campos, indices y rutas de
 * fichero, y eso es un mapa gratis de la aplicacion para quien la esta
 * sondeando. Quien llama recibe que fallo, no por que.
 *
 * Con una excepcion: que falte un campo obligatorio o venga con un valor fuera
 * de rango **no es un fallo del servidor**, es una peticion mal formada. Antes
 * salia como 500 y mandaba a buscar la averia donde no estaba; ahora responde
 * 400 diciendo que campos hay que corregir.
 */
export const sendServerError = (res: Response, message: string, error: unknown): void => {
  if ((error as Error)?.name === 'ValidationError') {
    const campos = camposInvalidos(error);
    console.warn(`${message} — datos no validos: ${campos.join(', ') || 'sin detalle'}`);
    res.status(400).json({
      error: campos.length > 0 ? `Datos no validos: ${campos.join(', ')}` : 'Datos no validos',
    });
    return;
  }

  console.error(`${message}:`, error);
  res.status(500).json({ error: message });
};

/**
 * Normaliza la referencia a un usuario, venga como viene en cada controlador:
 * un id suelto, un ObjectId, o un documento ya populado (`{ _id, username... }`).
 * Devuelve undefined si no hay forma de sacar un id comparable.
 */
const idDeUsuario = (usuario: unknown): string | undefined => {
  if (usuario === null || usuario === undefined) return undefined;
  if (typeof usuario === 'string') return usuario;
  if (Array.isArray(usuario)) return undefined;

  if (typeof usuario === 'object') {
    const propio = (usuario as { _id?: unknown })._id;
    if (propio !== undefined && propio !== null) return String(propio);
  }

  return String(usuario);
};

/*
 * Respuestas de error corrientes.
 *
 * Estaban escritas a mano en cada manejador, y el mismo texto llego a divergir
 * dentro de un solo fichero: 'ID de pedido no válido' y 'ID de pedido no
 * valido' convivian en `order.controller.ts`. Con una sola implementacion, la
 * API responde igual por todas las puertas y corregir un texto es corregirlo.
 *
 * Estas cadenas SI llevan acentos: las lee una persona. Los comentarios y los
 * mensajes de commit del proyecto van sin ellos, que es otra cosa.
 */

/** 400: la peticion esta mal formada. */
export const peticionInvalida = (res: Response, mensaje: string): void => {
  res.status(400).json({ error: mensaje });
};

/** 404: `recurso` es el nombre en singular — "Pedido", "Producto", "Noticia". */
export const noEncontrado = (res: Response, recurso: string): void => {
  res.status(404).json({ error: `${recurso} no encontrado` });
};

/** Igual que `noEncontrado` para los recursos de genero femenino. */
export const noEncontrada = (res: Response, recurso: string): void => {
  res.status(404).json({ error: `${recurso} no encontrada` });
};

/** 403: hay sesion, pero no permiso sobre este recurso concreto. */
export const sinPermiso = (res: Response, mensaje = 'No tienes permisos sobre este recurso'): void => {
  res.status(403).json({ error: mensaje });
};

/** 409: la peticion es correcta, pero choca con el estado actual. */
export const conflicto = (res: Response, mensaje: string): void => {
  res.status(409).json({ error: mensaje });
};

/**
 * Mongoose lanza `code: 11000` al violar un indice unico.
 *
 * Es un choque de datos, no un fallo del servidor: quien llama tiene que verlo
 * como 409 y no como 500. Estaba escrito igual en dos controladores.
 */
export const esDuplicado = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

/**
 * Lee un ObjectId de la ruta y responde 400 si no lo es.
 *
 * Devuelve `null` cuando ya ha respondido, para que quien llama solo tenga que
 * cortar. Express 5 tipa los parametros como `string | string[]`, y un array
 * tampoco es un identificador valido.
 */
export const leerObjectId = (
  res: Response,
  valor: string | string[] | undefined,
  recurso: string,
): string | null => {
  if (typeof valor === 'string' && isValidObjectId(valor)) return valor;

  peticionInvalida(res, `ID de ${recurso} no válido`);
  return null;
};

export const esAdmin = (req: Request): boolean => req.user?.rol === UserRole.ADMIN;

/**
 * Unica implementacion de la regla de acceso del proyecto: pasa el admin, y
 * pasa el dueno del recurso. `usuario` admite id, ObjectId o documento populado.
 */
export const esDuenoOAdmin = (req: Request, usuario: unknown): boolean => {
  if (esAdmin(req)) return true;

  const id = idDeUsuario(usuario);
  return id !== undefined && id === req.user?.id;
};
