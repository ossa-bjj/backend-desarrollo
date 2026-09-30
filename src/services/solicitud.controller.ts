/**
 * Manejadores HTTP de las solicitudes de propuesta. Las reglas viven en
 * `solicitud.service.ts`; aqui solo se lee la peticion y se responde.
 */

import type { Request, Response } from 'express';
import * as servicios from './servicio.service';
import {
  cambiarEstadoSolicitud,
  crearSolicitud,
  esEstadoSolicitud,
  leerSolicitud,
  listarSolicitudes,
} from './solicitud.service';
import { EstadoSolicitud } from './solicitud.model';
import { avisarALaAcademia } from '../shared/avisos';
import {
  leerObjectId,
  noEncontrada,
  noEncontrado,
  peticionInvalida,
  sendServerError,
} from '../shared/controller.utils';
import { claveIp, segundosHasta, superaLimiteDeUso } from '../users/acceso.service';

/**
 * Solicitudes por IP y hora. Una academia de verdad manda una o dos; esto
 * frena a quien quiera llenar la bandeja o usar el aviso para mandar correo.
 */
const MAXIMO_SOLICITUDES_POR_IP = 5;

// POST /api/servicios/:codigoArticulo/solicitudes (publico)
// Se guarda primero y se avisa despues: si el correo falla, la solicitud ya
// esta en el panel y nadie se queda sin respuesta.
export const crearSolicitudDeServicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const codigo = servicios.leerCodigoServicio(req.params.codigoArticulo);
    if (codigo === null) {
      peticionInvalida(res, 'Código de servicio no válido');
      return;
    }

    const datos = leerSolicitud(req.body);
    if (!datos.ok) {
      peticionInvalida(res, datos.error);
      return;
    }

    const servicio = await servicios.buscarPorCodigo(codigo);
    if (!servicio || !servicio.activo) {
      noEncontrado(res, 'Servicio');
      return;
    }

    const bloqueo = await superaLimiteDeUso(
      `solicitud:${claveIp(req.ip ?? 'desconocida')}`,
      MAXIMO_SOLICITUDES_POR_IP,
      60,
    );
    if (bloqueo) {
      res.set('Retry-After', String(segundosHasta(bloqueo)));
      res.status(429).json({ error: 'Demasiadas solicitudes seguidas. Inténtalo de nuevo más tarde' });
      return;
    }

    const solicitud = await crearSolicitud(servicio, datos.valor);
    await avisarALaAcademia({
      titulo: `Solicitud de propuesta: ${solicitud.servicioNombre}`,
      datos: [
        ['Academia', solicitud.academia],
        ['Ciudad', solicitud.ciudad],
        ['Alumnos', solicitud.alumnos],
        ['Fechas', solicitud.fechas],
        ['Contacto', solicitud.contacto],
        ['Notas', solicitud.mensaje],
      ],
      accion: 'Respóndela y márcala como respondida en el panel, en «Solicitudes».',
    });

    // Al publico solo se le confirma: lo guardado es de la administracion.
    res.status(201).json({ success: true, message: 'Solicitud recibida' });
  } catch (error) {
    sendServerError(res, 'Error enviando la solicitud', error);
  }
};

// GET /api/servicios/solicitudes?estado= (admin)
export const getSolicitudes = async (req: Request, res: Response): Promise<void> => {
  try {
    const { estado } = req.query;
    if (estado !== undefined && !esEstadoSolicitud(estado)) {
      peticionInvalida(
        res,
        `Estado no válido. Valores admitidos: ${Object.values(EstadoSolicitud).join(', ')}`,
      );
      return;
    }

    res.status(200).json({ success: true, data: await listarSolicitudes(estado) });
  } catch (error) {
    sendServerError(res, 'Error obteniendo solicitudes', error);
  }
};

// PATCH /api/servicios/solicitudes/:id (admin)
export const actualizarEstadoSolicitud = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = leerObjectId(res, req.params.id, 'solicitud');
    if (!id) return;

    const { estado } = req.body ?? {};
    if (!esEstadoSolicitud(estado)) {
      peticionInvalida(
        res,
        `Estado no válido. Valores admitidos: ${Object.values(EstadoSolicitud).join(', ')}`,
      );
      return;
    }

    const solicitud = await cambiarEstadoSolicitud(id, estado);
    if (!solicitud) {
      noEncontrada(res, 'Solicitud');
      return;
    }

    res.status(200).json({ success: true, data: solicitud });
  } catch (error) {
    sendServerError(res, 'Error actualizando la solicitud', error);
  }
};
