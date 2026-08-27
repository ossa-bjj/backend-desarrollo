import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { DisponibilidadModelo, EstadoSlot, PATRON_HORA } from './disponibilidad.model';
import { ServicioModelo } from '../services/servicio.model';
import { liberarRetencionesCaducadas } from './disponibilidad.service';
import { sendServerError, esAdmin } from '../shared/controller.utils';

const MINUTOS_POR_DIA = 24 * 60;

const soloTexto = (valor: unknown): string | undefined =>
  typeof valor === 'string' ? valor : undefined;

/** Convierte "HH:MM" a minutos desde medianoche. Devuelve null si no es valido. */
const horaAMinutos = (hora: string): number | null => {
  if (!PATRON_HORA.test(hora)) return null;
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
};

const minutosAHora = (minutos: number): string => {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** Parsea "YYYY-MM-DD" a medianoche UTC. Devuelve null si no es una fecha valida. */
const fechaUtc = (valor: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const fecha = new Date(valor + 'T00:00:00.000Z');
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

/** Hoy a medianoche UTC: frontera para ocultar slots pasados al publico. */
const hoyUtc = (): Date => {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
};

/** Dia de la semana con lunes = 0, para que cuadre con la UI (L M X J V S D). */
const diaSemanaLunesCero = (fecha: Date): number => (fecha.getUTCDay() + 6) % 7;

// --- GET /api/disponibilidad?servicio=&desde=&hasta=&admin=true ---
export const getDisponibilidad = async (req: Request, res: Response): Promise<void> => {
  try {
    const servicio = Number(req.query.servicio);
    if (!Number.isInteger(servicio)) {
      res.status(400).json({ error: 'Parametro "servicio" requerido' });
      return;
    }

    const desde = fechaUtc(String(req.query.desde ?? ''));
    const hasta = fechaUtc(String(req.query.hasta ?? ''));
    if (!desde || !hasta) {
      res.status(400).json({ error: 'Parametros "desde" y "hasta" requeridos con formato YYYY-MM-DD' });
      return;
    }
    if (desde > hasta) {
      res.status(400).json({ error: '"desde" no puede ser posterior a "hasta"' });
      return;
    }

    // Antes de leer, se devuelven al catalogo las retenciones caducadas de este
    // servicio. Asi el sistema se autolimpia sin cron: quien consulta la agenda
    // la ve ya depurada.
    await liberarRetencionesCaducadas(servicio);

    // La vista de administracion solo se concede si ademas el token es de admin.
    const vistaAdmin = req.query.admin === 'true' && esAdmin(req);

    const filtro: Record<string, unknown> = {
      servicio,
      fecha: { $gte: vistaAdmin ? desde : new Date(Math.max(desde.getTime(), hoyUtc().getTime())), $lte: hasta },
    };

    // El publico solo ve lo que puede reservar; el admin ve tambien ocupados y bloqueados.
    if (!vistaAdmin) filtro.estado = EstadoSlot.DISPONIBLE;

    const slots = await DisponibilidadModelo
      .find(filtro)
      .sort({ fecha: 1, horaInicio: 1 });

    res.status(200).json({ success: true, data: slots });
  } catch (error) {
    sendServerError(res, 'Error obteniendo la disponibilidad', error);
  }
};

// --- POST /api/disponibilidad (admin) ---
export const crearDisponibilidad = async (req: Request, res: Response): Promise<void> => {
  try {
    const { servicio, fecha, horaInicio, horaFin, duracion, estado, nota } = req.body;

    const dia = fechaUtc(String(fecha ?? ''));
    if (!Number.isInteger(Number(servicio)) || !dia) {
      res.status(400).json({ error: 'Se requieren "servicio" y "fecha" (YYYY-MM-DD) validos' });
      return;
    }

    const inicio = horaAMinutos(String(horaInicio ?? ''));
    const fin    = horaAMinutos(String(horaFin ?? ''));
    if (inicio === null || fin === null || fin <= inicio) {
      res.status(400).json({ error: 'Horario no valido: "horaFin" debe ser posterior a "horaInicio"' });
      return;
    }

    const servicioExiste = await ServicioModelo.exists({ codigoArticulo: Number(servicio) });
    if (!servicioExiste) {
      res.status(404).json({ error: `No existe el servicio ${servicio}` });
      return;
    }

    const slot = await new DisponibilidadModelo({
      servicio:   Number(servicio),
      fecha:      dia,
      horaInicio: minutosAHora(inicio),
      horaFin:    minutosAHora(fin),
      duracion:   Number(duracion) || (fin - inicio),
      estado:     estado ?? EstadoSlot.DISPONIBLE,
      nota:       soloTexto(nota),
    }).save();

    res.status(201).json({ success: true, data: slot });
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
      res.status(409).json({ error: 'Ya existe un slot para ese servicio, dia y hora de inicio' });
      return;
    }
    sendServerError(res, 'Error creando el slot', error);
  }
};

// --- POST /api/disponibilidad/batch (admin) ---
// Genera la parrilla de un servicio: para cada dia del rango cuyo dia de la
// semana este seleccionado, trocea la franja [horaInicio, horaFin) en slots de
// `duracion` minutos. Es idempotente: los slots que ya existen se cuentan como
// omitidos en lugar de duplicarse o fallar.
export const generarDisponibilidad = async (req: Request, res: Response): Promise<void> => {
  try {
    const { servicio, desde, hasta, horaInicio, horaFin, duracion, diasSemana, nota } = req.body;

    const codigoServicio = Number(servicio);
    const inicioRango = fechaUtc(String(desde ?? ''));
    const finRango    = fechaUtc(String(hasta ?? ''));

    if (!Number.isInteger(codigoServicio) || !inicioRango || !finRango) {
      res.status(400).json({ error: 'Se requieren "servicio", "desde" y "hasta" validos' });
      return;
    }
    if (inicioRango > finRango) {
      res.status(400).json({ error: '"desde" no puede ser posterior a "hasta"' });
      return;
    }

    const minutoInicio = horaAMinutos(String(horaInicio ?? ''));
    const minutoFin    = horaAMinutos(String(horaFin ?? ''));
    if (minutoInicio === null || minutoFin === null || minutoFin <= minutoInicio) {
      res.status(400).json({ error: 'Horario no valido: "horaFin" debe ser posterior a "horaInicio"' });
      return;
    }

    if (!Array.isArray(diasSemana) || diasSemana.length === 0) {
      res.status(400).json({ error: 'Selecciona al menos un dia de la semana' });
      return;
    }
    const dias = new Set(
      diasSemana.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    );
    if (dias.size === 0) {
      res.status(400).json({ error: 'Dias de la semana no validos: se esperan enteros de 0 (lunes) a 6 (domingo)' });
      return;
    }

    const servicioDoc = await ServicioModelo.findOne({ codigoArticulo: codigoServicio });
    if (!servicioDoc) {
      res.status(404).json({ error: `No existe el servicio ${codigoServicio}` });
      return;
    }

    // Si no se indica duracion se usa la del propio servicio: es lo que hace que
    // los slots generados encajen con lo que dura de verdad una sesion.
    const paso = Number(duracion) > 0 ? Number(duracion) : servicioDoc.duracion;
    if (paso <= 0 || paso > MINUTOS_POR_DIA) {
      res.status(400).json({ error: 'Duracion de slot no valida' });
      return;
    }
    if (minutoFin - minutoInicio < paso) {
      res.status(400).json({ error: `La franja horaria es mas corta que la duracion del slot (${paso} min)` });
      return;
    }

    // --- Construccion de los candidatos ---
    const candidatos: Array<{ fecha: Date; horaInicio: string; horaFin: string }> = [];
    for (
      let dia = new Date(inicioRango);
      dia <= finRango;
      dia = new Date(dia.getTime() + 24 * 60 * 60 * 1000)
    ) {
      if (!dias.has(diaSemanaLunesCero(dia))) continue;

      for (let minuto = minutoInicio; minuto + paso <= minutoFin; minuto += paso) {
        candidatos.push({
          fecha:      new Date(dia),
          horaInicio: minutosAHora(minuto),
          horaFin:    minutosAHora(minuto + paso),
        });
      }
    }

    if (candidatos.length === 0) {
      res.status(200).json({ success: true, data: { creados: 0, omitidos: 0 } });
      return;
    }

    // --- Descarte de los que ya existen ---
    const existentes = await DisponibilidadModelo.find(
      {
        servicio: codigoServicio,
        fecha:    { $gte: inicioRango, $lte: finRango },
      },
      { fecha: 1, horaInicio: 1 },
    );

    const clave = (fecha: Date, hora: string) => `${fecha.toISOString().slice(0, 10)}#${hora}`;
    const yaExisten = new Set(existentes.map((s) => clave(s.fecha, s.horaInicio)));

    const nuevos = candidatos.filter((c) => !yaExisten.has(clave(c.fecha, c.horaInicio)));

    if (nuevos.length > 0) {
      await DisponibilidadModelo.insertMany(
        nuevos.map((c) => ({
          servicio:   codigoServicio,
          fecha:      c.fecha,
          horaInicio: c.horaInicio,
          horaFin:    c.horaFin,
          duracion:   paso,
          estado:     EstadoSlot.DISPONIBLE,
          nota:       soloTexto(nota),
        })),
        // Si dos admins generan a la vez, el indice unico frena los duplicados
        // sin abortar el resto del lote.
        { ordered: false },
      ).catch((error: unknown) => {
        if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) return;
        throw error;
      });
    }

    res.status(201).json({
      success: true,
      data: { creados: nuevos.length, omitidos: candidatos.length - nuevos.length },
    });
  } catch (error) {
    sendServerError(res, 'Error generando la disponibilidad', error);
  }
};

// --- PATCH /api/disponibilidad/:id/bloquear (admin) ---
export const bloquearDisponibilidad = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de slot no valido' });
      return;
    }

    const slot = await DisponibilidadModelo.findById(id);
    if (!slot) {
      res.status(404).json({ error: 'Slot no encontrado' });
      return;
    }

    // Un slot ya vendido no se bloquea: habria que cancelar el pedido primero.
    if (slot.estado === EstadoSlot.OCUPADO) {
      res.status(409).json({ error: 'No se puede bloquear un slot ya reservado' });
      return;
    }

    slot.estado = EstadoSlot.BLOQUEADO;
    slot.nota   = soloTexto(req.body?.nota) ?? slot.nota;
    await slot.save();

    res.status(200).json({ success: true, data: slot });
  } catch (error) {
    sendServerError(res, 'Error bloqueando el slot', error);
  }
};

// --- PATCH /api/disponibilidad/:id/desbloquear (admin) ---
export const desbloquearDisponibilidad = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de slot no valido' });
      return;
    }

    const slot = await DisponibilidadModelo.findById(id);
    if (!slot) {
      res.status(404).json({ error: 'Slot no encontrado' });
      return;
    }

    if (slot.estado === EstadoSlot.OCUPADO) {
      res.status(409).json({ error: 'El slot esta reservado, no bloqueado' });
      return;
    }

    slot.estado = EstadoSlot.DISPONIBLE;
    slot.nota   = undefined;
    await slot.save();

    res.status(200).json({ success: true, data: slot });
  } catch (error) {
    sendServerError(res, 'Error desbloqueando el slot', error);
  }
};

// --- DELETE /api/disponibilidad/:id (admin) ---
export const eliminarDisponibilidad = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      res.status(400).json({ error: 'ID de slot no valido' });
      return;
    }

    const slot = await DisponibilidadModelo.findById(id);
    if (!slot) {
      res.status(404).json({ error: 'Slot no encontrado' });
      return;
    }

    // Borrar un slot vendido dejaria al cliente con una reserva fantasma.
    if (slot.estado === EstadoSlot.OCUPADO) {
      res.status(409).json({ error: 'No se puede eliminar un slot ya reservado' });
      return;
    }

    await slot.deleteOne();
    res.status(200).json({ success: true, message: 'Slot eliminado' });
  } catch (error) {
    sendServerError(res, 'Error eliminando el slot', error);
  }
};
