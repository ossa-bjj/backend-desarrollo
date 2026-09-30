/**
 * Una cuenta bloqueada pierde la sesión que ya tenía.
 *
 * El login ya no la deja entrar, pero un token emitido antes vale ocho horas:
 * sin comprobarlo en cada petición, bloquear a alguien no le cortaba nada.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { sesionDe } from '../ayudas/sesion';

let app: Express;

const crearCuenta = async (status: 'activo' | 'baneado') => {
  const { User } = await import('../../src/users/user.model');
  return User.create({
    username: `cuenta-${status}`,
    email: `${status}@ejemplo.com`,
    password: 'secreta123',
    status,
    profile: { firstName: 'A', lastName: 'B' },
  });
};

beforeAll(async () => {
  app = (await import('../../index')).default;
});

describe('cuenta bloqueada', () => {
  it('su token deja de valer en las rutas protegidas', async () => {
    const cuenta = await crearCuenta('baneado');
    const sesion = sesionDe({ id: cuenta._id });

    const respuesta = await request(app).get('/api/users/me').set('Authorization', sesion.cabecera);

    expect(respuesta.status).toBe(401);
    expect(respuesta.body.error).toBe('Esta cuenta está bloqueada');
  });

  it('una cuenta activa sigue entrando', async () => {
    const cuenta = await crearCuenta('activo');
    const sesion = sesionDe({ id: cuenta._id });

    const respuesta = await request(app).get('/api/users/me').set('Authorization', sesion.cabecera);

    expect(respuesta.status).toBe(200);
  });

  it('equivocarse con la contraseña actual es un 400, no un 401 que cierre la sesión', async () => {
    const cuenta = await crearCuenta('activo');
    const sesion = sesionDe({ id: cuenta._id });

    const mal = await request(app)
      .patch(`/api/users/${String(cuenta._id)}/password`)
      .set('Authorization', sesion.cabecera)
      .send({ currentPassword: 'no-es-esta', newPassword: 'nueva-clave' });
    const corta = await request(app)
      .patch(`/api/users/${String(cuenta._id)}/password`)
      .set('Authorization', sesion.cabecera)
      .send({ currentPassword: 'secreta123', newPassword: '123' });
    const bien = await request(app)
      .patch(`/api/users/${String(cuenta._id)}/password`)
      .set('Authorization', sesion.cabecera)
      .send({ currentPassword: 'secreta123', newPassword: 'nueva-clave' });

    expect(mal.status).toBe(400);
    expect(corta.status).toBe(400);
    expect(bien.status).toBe(200);
  });

  it('bloquearla corta la sesión en la petición siguiente', async () => {
    const cuenta = await crearCuenta('activo');
    const sesion = sesionDe({ id: cuenta._id });
    expect((await request(app).get('/api/users/me').set('Authorization', sesion.cabecera)).status).toBe(200);

    const { User } = await import('../../src/users/user.model');
    await User.updateOne({ _id: cuenta._id }, { status: 'baneado' });

    expect((await request(app).get('/api/users/me').set('Authorization', sesion.cabecera)).status).toBe(401);
  });
});
