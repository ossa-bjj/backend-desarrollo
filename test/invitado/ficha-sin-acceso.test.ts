/**
 * La ficha de invitado y el acceso.
 *
 * Una ficha es un `User` con rol `invitado` y sin contraseña. Nadie puede
 * iniciar sesión con ella, ni ponerle contraseña a mano, ni cambiarle el rol.
 * La única forma de convertirla en cuenta es que su dueño abra el enlace que le
 * llega al correo: es lo primero que demuestra que ese correo es suyo.
 *
 * Aquí también se cierra un fallo que ya existía: los campos de las rutas
 * públicas de acceso aceptaban objetos, y un `{ "$ne": null }` como token de
 * recuperación cambiaba la contraseña de otra cuenta.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { sesionDeAdmin } from '../ayudas/sesion';

const enviarCorreoDeRecuperacion = vi.fn(async (_para: string, _enlace: string) => true);
const enviarCorreoDeActivacion = vi.fn(async (_para: string, _enlace: string) => true);

vi.mock('../../src/shared/correo', () => ({
  enviarCorreoDeRecuperacion: (para: string, enlace: string) => enviarCorreoDeRecuperacion(para, enlace),
  enviarCorreoDeActivacion: (para: string, enlace: string) => enviarCorreoDeActivacion(para, enlace),
}));

let app: Express;

const CORREO = 'ana@ejemplo.com';
const ORIGEN = 'https://tienda.example.test';

const modeloUsuario = async () => import('../../src/users/user.model');

const crearFicha = async () => {
  const { User, UserRole } = await modeloUsuario();
  return User.create({
    username: CORREO,
    email: CORREO,
    role: UserRole.INVITADO,
    profile: {
      firstName: 'Ana',
      lastName: 'López',
      addresses: [
        {
          calle: 'Calle que pudo meter cualquiera',
          ciudad: 'Valencia',
          provincia: 'Valencia',
          codigoPostal: '46001',
          pais: 'España',
          esPredeterminada: true,
        },
      ],
    },
  });
};

const crearCuenta = async (extra: Record<string, unknown> = {}) => {
  const { User } = await modeloUsuario();
  return User.create({
    username: 'cliente',
    email: 'cliente@ejemplo.com',
    password: 'secreta123',
    profile: { firstName: 'C', lastName: 'Liente' },
    ...extra,
  });
};

const pedirEnlace = (email: unknown) =>
  request(app).post('/api/users/forgot-password').set('Origin', ORIGEN).send({ email });

const tokenDelEnlace = (enlace: string): string => new URL(enlace).searchParams.get('token')!;

beforeAll(async () => {
  app = (await import('../../index')).default;
});

beforeEach(() => {
  enviarCorreoDeRecuperacion.mockClear();
  enviarCorreoDeActivacion.mockClear();
});

describe('ficha de invitado · sin contraseña', () => {
  it('se puede guardar sin contraseña', async () => {
    const ficha = await crearFicha();

    expect(ficha._id).toBeDefined();
  });

  it('una cuenta normal sigue necesitándola', async () => {
    const { User } = await modeloUsuario();

    await expect(
      User.create({
        username: 'sinclave',
        email: 'sin@clave.es',
        profile: { firstName: 'A', lastName: 'B' },
      }),
    ).rejects.toThrow(/password/);
  });

  it('no se puede iniciar sesión con ella: 401 como un usuario inexistente, no 500', async () => {
    await crearFicha();

    const respuesta = await request(app)
      .post('/api/users/login')
      .send({ username: CORREO, password: 'cualquier-cosa' });

    expect(respuesta.status).toBe(401);
    expect(respuesta.body.error).toBe('Credenciales inválidas');
  });
});

describe('ficha de invitado · convertirse en cuenta', () => {
  it('«olvidé mi contraseña» le manda un enlace para crear su cuenta, no uno de recuperación', async () => {
    await crearFicha();

    const respuesta = await pedirEnlace(CORREO);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.message).toContain('Si el correo existe');
    expect(enviarCorreoDeActivacion).toHaveBeenCalledTimes(1);
    expect(enviarCorreoDeRecuperacion).not.toHaveBeenCalled();
  });

  it('el enlace la convierte en cuenta, sin heredar las direcciones de la ficha', async () => {
    await crearFicha();
    await pedirEnlace(CORREO);
    const token = tokenDelEnlace(enviarCorreoDeActivacion.mock.calls[0][1]);

    const respuesta = await request(app)
      .post('/api/users/reset-password')
      .send({ token, newPassword: 'mi-clave-nueva' });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.message).toContain('Cuenta creada');

    const { User } = await modeloUsuario();
    const cuenta = await User.findOne({ email: CORREO });
    expect(cuenta!.role).toBe('user');
    expect(cuenta!.status).toBe('activo');
    expect(cuenta!.metadata.emailVerified).toBe(true);
    // Cualquiera pudo comprar escribiendo ese correo: sus direcciones no pasan.
    expect(cuenta!.profile.addresses).toHaveLength(0);

    // Y entra con su correo como usuario.
    const entrada = await request(app)
      .post('/api/users/login')
      .send({ username: CORREO, password: 'mi-clave-nueva' });
    expect(entrada.status).toBe(200);
  });

  it('el token se guarda como huella, no tal cual', async () => {
    await crearFicha();
    await pedirEnlace(CORREO);
    const token = tokenDelEnlace(enviarCorreoDeActivacion.mock.calls[0][1]);

    const { User } = await modeloUsuario();
    const ficha = await User.findOne({ email: CORREO }).select('+metadata.resetPasswordToken');
    expect(ficha!.metadata.resetPasswordToken).toBeDefined();
    expect(ficha!.metadata.resetPasswordToken).not.toBe(token);
  });

  it('una ficha bloqueada por el admin sigue bloqueada al convertirse', async () => {
    const ficha = await crearFicha();
    const { User } = await modeloUsuario();
    await User.updateOne({ _id: ficha._id }, { status: 'baneado' });
    await pedirEnlace(CORREO);
    const token = tokenDelEnlace(enviarCorreoDeActivacion.mock.calls[0][1]);

    await request(app).post('/api/users/reset-password').send({ token, newPassword: 'mi-clave-nueva' });

    const cuenta = await User.findOne({ email: CORREO });
    expect(cuenta!.status).toBe('baneado');
    const entrada = await request(app)
      .post('/api/users/login')
      .send({ username: CORREO, password: 'mi-clave-nueva' });
    expect(entrada.status).toBe(403);
  });

  it('si la ficha tuvo que tomar otro usuario, al convertirse recupera el correo si está libre', async () => {
    const { User } = await modeloUsuario();
    const antigua = await User.create({
      username: CORREO,
      email: 'otra@ejemplo.com',
      password: 'secreta123',
      profile: { firstName: 'Otra', lastName: 'Persona' },
    });
    const { obtenerFichaDeInvitado } = await import('../../src/users/ficha-invitado.service');
    await obtenerFichaDeInvitado({ firstName: 'Ana', lastName: 'López', email: CORREO, phone: '600' });
    // La cuenta antigua que ocupaba el nombre ya no está.
    await User.deleteOne({ _id: antigua._id });
    await pedirEnlace(CORREO);
    const token = tokenDelEnlace(enviarCorreoDeActivacion.mock.calls[0][1]);

    const respuesta = await request(app)
      .post('/api/users/reset-password')
      .send({ token, newPassword: 'mi-clave-nueva' });

    expect(respuesta.body.message).toContain('con tu correo');
    const entrada = await request(app)
      .post('/api/users/login')
      .send({ username: CORREO, password: 'mi-clave-nueva' });
    expect(entrada.status).toBe(200);
  });

  it('si el correo sigue ocupado como usuario, le dice cuál es el suyo', async () => {
    const { User } = await modeloUsuario();
    await User.create({
      username: CORREO,
      email: 'otra@ejemplo.com',
      password: 'secreta123',
      profile: { firstName: 'Otra', lastName: 'Persona' },
    });
    const { obtenerFichaDeInvitado } = await import('../../src/users/ficha-invitado.service');
    await obtenerFichaDeInvitado({ firstName: 'Ana', lastName: 'López', email: CORREO, phone: '600' });
    await pedirEnlace(CORREO);
    const token = tokenDelEnlace(enviarCorreoDeActivacion.mock.calls[0][1]);

    const respuesta = await request(app)
      .post('/api/users/reset-password')
      .send({ token, newPassword: 'mi-clave-nueva' });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.message).toContain(`${CORREO}#`);
  });

  it('un token guardado en claro, de antes, ya no sirve', async () => {
    const ficha = await crearFicha();
    const { User } = await modeloUsuario();
    await User.updateOne(
      { _id: ficha._id },
      {
        'metadata.resetPasswordToken': 'token-antiguo',
        'metadata.resetPasswordExpires': new Date(Date.now() + 60_000),
      },
    );

    const respuesta = await request(app)
      .post('/api/users/reset-password')
      .send({ token: 'token-antiguo', newPassword: 'nueva-clave' });

    expect(respuesta.status).toBe(400);
  });

  it('una cuenta normal recibe el enlace de recuperación de siempre', async () => {
    await crearCuenta();

    await pedirEnlace('cliente@ejemplo.com');

    expect(enviarCorreoDeRecuperacion).toHaveBeenCalledTimes(1);
    expect(enviarCorreoDeActivacion).not.toHaveBeenCalled();
  });
});

describe('acceso · solo texto en las rutas públicas', () => {
  it('un token que es un objeto no cambia la contraseña de nadie', async () => {
    const cuenta = await crearCuenta();
    await pedirEnlace('cliente@ejemplo.com');

    const respuesta = await request(app)
      .post('/api/users/reset-password')
      .send({ token: { $ne: null }, newPassword: 'contraseña-del-atacante' });

    expect(respuesta.status).toBe(400);
    const entrada = await request(app)
      .post('/api/users/login')
      .send({ username: cuenta.username, password: 'secreta123' });
    expect(entrada.status).toBe(200);
  });

  it('un correo que es un objeto no manda ningún enlace', async () => {
    await crearCuenta();

    const respuesta = await pedirEnlace({ $ne: null });

    expect(respuesta.status).toBe(200);
    expect(enviarCorreoDeRecuperacion).not.toHaveBeenCalled();
  });

  it('una contraseña que no es texto se rechaza con 400, no con 500', async () => {
    await crearCuenta();

    const respuesta = await request(app)
      .post('/api/users/login')
      .send({ username: 'cliente', password: { $gt: '' } });

    expect(respuesta.status).toBe(400);
  });

  it('el registro ignora cuota, pagos de cuota, cliente y perfil deportivo', async () => {
    const respuesta = await request(app)
      .post('/api/users/register')
      .send({
        username: 'nuevo',
        email: 'nuevo@ejemplo.com',
        password: 'secreta123',
        profile: { firstName: 'N', lastName: 'Uevo', avatarUrl: 'https://otro.test/x.png' },
        membership: { status: 'active', monthlyFee: 0 },
        membershipPayments: [{ period: '2026-09', amount: 0, status: 'paid', dueDate: '2026-09-01' }],
        customer: { isCustomer: true, origin: 'athlete' },
        sportsProfile: { isAthlete: true, isFederated: false },
        role: 'admin',
      });

    expect(respuesta.status).toBe(201);
    const { User } = await modeloUsuario();
    const creado = await User.findOne({ username: 'nuevo' });
    expect(creado!.role).toBe('user');
    expect(creado!.membership.status).toBe('inactive');
    expect(creado!.membershipPayments).toHaveLength(0);
    expect(creado!.customer.isCustomer).toBe(false);
    expect(creado!.sportsProfile).toBeUndefined();
    expect(creado!.profile.avatarUrl).not.toBe('https://otro.test/x.png');
  });

  it('el registro no admite un nombre de usuario con @', async () => {
    const respuesta = await request(app)
      .post('/api/users/register')
      .send({
        username: 'otra@persona.com',
        email: 'mio@ejemplo.com',
        password: 'secreta123',
        profile: { firstName: 'A', lastName: 'B' },
      });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toContain('@');
  });
});

describe('ficha de invitado · el admin no la convierte a mano', () => {
  const admin = sesionDeAdmin();

  it('no crea fichas a mano', async () => {
    const respuesta = await request(app)
      .post('/api/users')
      .set('Authorization', admin.cabecera)
      .send({
        username: 'ficha',
        email: 'ficha@ejemplo.com',
        password: 'secreta123',
        role: 'invitado',
        profile: { firstName: 'A', lastName: 'B' },
      });

    expect(respuesta.status).toBe(400);
  });

  it('no le cambia el rol a una ficha', async () => {
    const ficha = await crearFicha();

    const respuesta = await request(app)
      .put(`/api/users/${String(ficha._id)}`)
      .set('Authorization', admin.cabecera)
      .send({ role: 'user' });

    expect(respuesta.status).toBe(400);
  });

  it('no convierte en ficha una cuenta de verdad', async () => {
    const cuenta = await crearCuenta();

    const respuesta = await request(app)
      .put(`/api/users/${String(cuenta._id)}`)
      .set('Authorization', admin.cabecera)
      .send({ role: 'invitado' });

    expect(respuesta.status).toBe(400);
  });

  it('no le pone contraseña a una ficha', async () => {
    const ficha = await crearFicha();

    const respuesta = await request(app)
      .patch(`/api/users/${String(ficha._id)}/password`)
      .set('Authorization', admin.cabecera)
      .send({ newPassword: 'puesta-a-mano' });

    expect(respuesta.status).toBe(400);
  });

  it('si corrige el correo de una ficha, el usuario lo sigue', async () => {
    const ficha = await crearFicha();

    const respuesta = await request(app)
      .put(`/api/users/${String(ficha._id)}`)
      .set('Authorization', admin.cabecera)
      .send({ username: CORREO, email: 'Ana.Bien@Ejemplo.com' });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.data.email).toBe('ana.bien@ejemplo.com');
    expect(respuesta.body.data.username).toBe('ana.bien@ejemplo.com');
  });

  it('puede editar el resto de la ficha sin tocar rol ni usuario', async () => {
    const ficha = await crearFicha();

    const respuesta = await request(app)
      .put(`/api/users/${String(ficha._id)}`)
      .set('Authorization', admin.cabecera)
      .send({ username: CORREO, email: CORREO, role: 'invitado', status: 'activo' });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.data.status).toBe('activo');
  });
});
