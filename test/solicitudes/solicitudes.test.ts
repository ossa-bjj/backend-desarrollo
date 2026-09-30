/**
 * Solicitudes de propuesta: el formulario de «Solicitar propuesta» de un
 * servicio, y la bandeja del admin.
 *
 * Se comprueba que se guardan —es lo que evita perderlas aunque el aviso no
 * llegue—, que se avisa a la academia, que la ruta pública solo admite lo que
 * debe y tiene freno, y que la bandeja es solo del admin.
 *
 * El módulo de avisos está simulado: aquí no se manda nada.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { sesionDe, sesionDeAdmin } from '../ayudas/sesion';

const avisarALaAcademia = vi.hoisted(() => vi.fn(async () => ({ telegram: true, correo: true })));

vi.mock('../../src/shared/avisos', async () => {
  const real = await vi.importActual<typeof ModuloAvisos>('../../src/shared/avisos');
  return { ...real, avisarALaAcademia };
});

import type * as ModuloAvisos from '../../src/shared/avisos';

let app: Express;

const solicitud = {
  academia: 'Tatami Club',
  ciudad: 'Bilbao',
  alumnos: '25-30',
  fechas: 'Fines de semana de octubre',
  contacto: 'tatami@ejemplo.com',
  mensaje: 'Derribos para BJJ',
};

const crearServicio = async (activo = true) => {
  const { ServicioModelo } = await import('../../src/services/servicio.model');
  return ServicioModelo.create({
    codigoArticulo: 6010,
    nombre: 'Seminario para academias',
    precio: 0,
    subcategoria: 'Seminarios',
    descripcionCorta: 'Seminario a medida',
    descripcionCompleta: 'Seminario a medida en tu academia',
    duracion: 180,
    requiereConfirmacion: true,
    activo,
  });
};

const enviar = (cuerpo: Record<string, unknown>, codigo = 6010) =>
  request(app).post(`/api/servicios/${codigo}/solicitudes`).send(cuerpo);

const modelo = async () => (await import('../../src/services/solicitud.model')).SolicitudModelo;

beforeAll(async () => {
  app = (await import('../../index')).default;
});

beforeEach(() => {
  avisarALaAcademia.mockClear();
});

describe('solicitudes de propuesta · el formulario', () => {
  it('se guarda con el servicio por el que se pregunta y se avisa a la academia', async () => {
    await crearServicio();

    const respuesta = await enviar(solicitud);

    expect(respuesta.status).toBe(201);
    // Al público solo se le confirma: lo guardado es de la administración.
    expect(respuesta.body.data).toBeUndefined();

    const guardada = await (await modelo()).findOne({ academia: 'Tatami Club' });
    expect(guardada).toMatchObject({
      servicio: 6010,
      servicioNombre: 'Seminario para academias',
      contacto: 'tatami@ejemplo.com',
      estado: 'nueva',
    });

    expect(avisarALaAcademia).toHaveBeenCalledTimes(1);
    const [aviso] = avisarALaAcademia.mock.calls[0] as unknown as [{ titulo: string }];
    expect(aviso.titulo).toContain('Seminario para academias');
  });

  it('faltan datos: dice cuáles y no guarda nada', async () => {
    await crearServicio();

    const respuesta = await enviar({ ...solicitud, ciudad: '', contacto: '  ' });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toContain('ciudad');
    expect(respuesta.body.error).toContain('contacto');
    expect(await (await modelo()).countDocuments()).toBe(0);
  });

  it('un texto enorme no entra', async () => {
    await crearServicio();

    const respuesta = await enviar({ ...solicitud, mensaje: 'x'.repeat(5000) });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toContain('mensaje');
  });

  it('solo se guarda lo que es de la solicitud', async () => {
    await crearServicio();

    await enviar({ ...solicitud, estado: 'respondida', servicioNombre: 'Otro' });

    const guardada = await (await modelo()).findOne({ academia: 'Tatami Club' });
    expect(guardada!.estado).toBe('nueva');
    expect(guardada!.servicioNombre).toBe('Seminario para academias');
  });

  it('un servicio desactivado o inexistente no recibe solicitudes', async () => {
    await crearServicio(false);

    const desactivado = await enviar(solicitud);
    const inexistente = await enviar(solicitud, 6999);
    const noEsServicio = await enviar(solicitud, 1011);

    expect(desactivado.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(noEsServicio.status).toBe(400);
    expect(avisarALaAcademia).not.toHaveBeenCalled();
  });

  it('frena a quien encadena solicitudes desde la misma IP', async () => {
    await crearServicio();

    const estados: number[] = [];
    for (let i = 0; i < 6; i += 1) estados.push((await enviar(solicitud)).status);

    expect(estados.slice(0, 5).every((estado) => estado === 201)).toBe(true);
    expect(estados[5]).toBe(429);
  });
});

describe('solicitudes de propuesta · la bandeja del admin', () => {
  const admin = sesionDeAdmin();

  it('solo la ve el admin', async () => {
    const sinSesion = await request(app).get('/api/servicios/solicitudes');
    const cliente = await request(app)
      .get('/api/servicios/solicitudes')
      .set('Authorization', sesionDe().cabecera);

    expect(sinSesion.status).toBe(401);
    expect(cliente.status).toBe(403);
  });

  it('lista las más recientes primero y filtra por estado', async () => {
    await crearServicio();
    await enviar({ ...solicitud, academia: 'Primera' });
    await enviar({ ...solicitud, academia: 'Segunda' });

    const todas = await request(app).get('/api/servicios/solicitudes').set('Authorization', admin.cabecera);
    expect(todas.status).toBe(200);
    expect(todas.body.data.map((s: { academia: string }) => s.academia)).toEqual(['Segunda', 'Primera']);

    const respondidas = await request(app)
      .get('/api/servicios/solicitudes?estado=respondida')
      .set('Authorization', admin.cabecera);
    expect(respondidas.body.data).toHaveLength(0);

    const mal = await request(app)
      .get('/api/servicios/solicitudes?estado=otra')
      .set('Authorization', admin.cabecera);
    expect(mal.status).toBe(400);
  });

  it('marca una solicitud como respondida', async () => {
    await crearServicio();
    await enviar(solicitud);
    const guardada = await (await modelo()).findOne({ academia: 'Tatami Club' });

    const respuesta = await request(app)
      .patch(`/api/servicios/solicitudes/${String(guardada!._id)}`)
      .set('Authorization', admin.cabecera)
      .send({ estado: 'respondida' });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.data.estado).toBe('respondida');

    const invalido = await request(app)
      .patch(`/api/servicios/solicitudes/${String(guardada!._id)}`)
      .set('Authorization', admin.cabecera)
      .send({ estado: 'aprobada' });
    expect(invalido.status).toBe(400);
  });
});
