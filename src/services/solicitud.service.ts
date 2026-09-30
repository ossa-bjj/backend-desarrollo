import type { HydratedDocument } from 'mongoose';
import type { ISolicitud } from './solicitud.model';
import { EstadoSolicitud, SolicitudModelo } from './solicitud.model';
import type { IServicio } from './servicio.model';

/**
 * Reglas de las solicitudes de propuesta. El controlador solo lee la peticion
 * y responde; que se admite y como se guarda se decide aqui.
 */

export type DatosSolicitud = Pick<
  ISolicitud,
  'academia' | 'ciudad' | 'alumnos' | 'fechas' | 'contacto' | 'mensaje'
>;

type Lectura<T> = { ok: true; valor: T } | { ok: false; error: string };

/** Campos obligatorios y su tope de longitud: los mismos que declara el modelo. */
const OBLIGATORIOS = { academia: 150, ciudad: 100, alumnos: 50, fechas: 200, contacto: 200 } as const;
const LARGO_MAXIMO_MENSAJE = 2000;

const texto = (valor: unknown): string => (typeof valor === 'string' ? valor.trim() : '');

/**
 * Lee y valida lo que manda el formulario. Llega de una ruta publica: solo
 * texto, con tope, y ningun campo que no sea de la solicitud.
 */
export const leerSolicitud = (entrada: unknown): Lectura<DatosSolicitud> => {
  const datos = (entrada ?? {}) as Record<string, unknown>;

  const campos = Object.fromEntries(
    Object.keys(OBLIGATORIOS).map((campo) => [campo, texto(datos[campo])]),
  ) as Record<keyof typeof OBLIGATORIOS, string>;

  const faltan = Object.entries(campos)
    .filter(([, valor]) => !valor)
    .map(([campo]) => campo);
  if (faltan.length > 0) return { ok: false, error: `Faltan datos de la solicitud: ${faltan.join(', ')}` };

  const mensaje = texto(datos.mensaje);
  const largos: string[] = (Object.keys(OBLIGATORIOS) as Array<keyof typeof OBLIGATORIOS>).filter(
    (campo) => campos[campo].length > OBLIGATORIOS[campo],
  );
  if (mensaje.length > LARGO_MAXIMO_MENSAJE) largos.push('mensaje');
  if (largos.length > 0) return { ok: false, error: `Datos demasiado largos: ${largos.join(', ')}` };

  return { ok: true, valor: { ...campos, mensaje: mensaje || undefined } };
};

export const crearSolicitud = (
  servicio: Pick<IServicio, 'codigoArticulo' | 'nombre'>,
  datos: DatosSolicitud,
): Promise<HydratedDocument<ISolicitud>> =>
  new SolicitudModelo({
    ...datos,
    servicio: servicio.codigoArticulo,
    servicioNombre: servicio.nombre,
  }).save();

export const esEstadoSolicitud = (valor: unknown): valor is EstadoSolicitud =>
  typeof valor === 'string' && Object.values(EstadoSolicitud).includes(valor as EstadoSolicitud);

/** Las mas recientes primero: es como se atiende una bandeja de entrada. */
export const listarSolicitudes = (estado?: EstadoSolicitud) =>
  SolicitudModelo.find(estado ? { estado } : {})
    .sort({ createdAt: -1 })
    .limit(500);

export const cambiarEstadoSolicitud = (id: string, estado: EstadoSolicitud) =>
  SolicitudModelo.findByIdAndUpdate(id, { estado }, { new: true, runValidators: true });
