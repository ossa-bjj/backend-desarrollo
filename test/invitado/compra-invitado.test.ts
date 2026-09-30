/**
 * Compra sin cuenta: `POST /api/pedidos/invitado` y las rutas que abre su clave.
 *
 * Tres cosas que comprobar. Una, que el pedido queda a nombre de una ficha de
 * invitado —un `User` sin contraseña— y que una segunda compra con el mismo
 * correo reutiliza esa ficha sin dejar que una petición anónima la reescriba.
 * Dos, que un correo con cuenta de verdad no se cuela por aquí. Y tres, que la
 * clave del pedido es lo único que lo abre, y que con ella se cobra igual que un
 * cliente con cuenta.
 *
 * El SDK de Stripe está simulado: aquí no se crean cobros de verdad.
 */

import crypto from 'crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { OrderStatus } from '../../src/orders/order.model';
import { crearPedido, crearProducto, releerPedido } from '../ayudas/pedidos';
import { reiniciarStripeSimulado, stripeSimulado } from '../ayudas/stripe-simulado';
import type * as ModuloPayPal from '../../src/payments/paypal.utils';

vi.mock('../../src/payments/stripe.utils', async () => {
  const { moduloStripeSimulado } = await import('../ayudas/stripe-simulado');
  return moduloStripeSimulado();
});

// PayPal simulado: la captura dice que cobró, con el pedido que se le pida.
const paypalSimulado = vi.hoisted(() => ({
  crearOrdenPayPal: vi.fn(async (pedidoId: string) => ({
    id: `orden-${pedidoId}`,
    approveUrl: 'https://paypal.test/ok',
  })),
  capturarOrdenPayPal: vi.fn(async (_ordenId: string) => ({
    completada: true,
    estado: 'COMPLETED',
    pedidoId: undefined as string | undefined,
    capturaId: 'captura-de-prueba',
  })),
}));

vi.mock('../../src/payments/paypal.utils', async () => {
  const real = await vi.importActual<typeof ModuloPayPal>('../../src/payments/paypal.utils');
  return { ...real, ...paypalSimulado };
});

let app: Express;

const comprador = {
  firstName: 'Ana',
  lastName: 'López',
  // Con mayúsculas y espacios: la ficha tiene que quedar con el correo normalizado.
  email: '  Ana@Ejemplo.com ',
  phone: '600111222',
};

const direccion = {
  calle: 'Calle Mayor 1',
  ciudad: 'Valencia',
  provincia: 'Valencia',
  codigoPostal: '46001',
  pais: 'España',
};

const lineaCamiseta = { codigoArticulo: 1011, quantity: 2, talla: 'M' };

const alta = (cuerpo: Record<string, unknown>) => request(app).post('/api/pedidos/invitado').send(cuerpo);

const altaCompleta = (extra: Record<string, unknown> = {}) =>
  alta({ invitado: comprador, shippingAddress: direccion, items: [lineaCamiseta], ...extra });

const modelos = async () => {
  const { User } = await import('../../src/users/user.model');
  const { Order } = await import('../../src/orders/order.model');
  return { User, Order };
};

const crearServicio = async (
  opciones: { requiereConfirmacion?: boolean; requiereReserva?: boolean } = {},
) => {
  const { ServicioModelo } = await import('../../src/services/servicio.model');
  return ServicioModelo.create({
    codigoArticulo: 6001,
    nombre: 'Revisión de vídeo',
    precio: 40,
    subcategoria: 'Online',
    descripcionCorta: 'Revisión de un combate',
    descripcionCompleta: 'Revisión de un combate grabado',
    duracion: 60,
    requiereReserva: opciones.requiereReserva ?? false,
    requiereConfirmacion: opciones.requiereConfirmacion ?? false,
  });
};

beforeAll(async () => {
  app = (await import('../../index')).default;
});

beforeEach(async () => {
  reiniciarStripeSimulado();
  await crearProducto({ tallas: [{ talla: 'M', stock: 10 }] });
});

// Hueco de agenda de pruebas y utilidades, compartidas por los bloques de horarios.
const crearHuecoDePrueba = async (extra: Record<string, unknown> = {}) => {
  const { DisponibilidadModelo } = await import('../../src/availability/disponibilidad.model');
  return DisponibilidadModelo.create({
    servicio: 6001,
    fecha: new Date('2030-01-10T00:00:00.000Z'),
    horaInicio: '10:00',
    horaFin: '11:00',
    duracion: 60,
    ...extra,
  });
};

const releerHuecoDePrueba = async (id: unknown) => {
  const { DisponibilidadModelo } = await import('../../src/availability/disponibilidad.model');
  return DisponibilidadModelo.findById(id);
};

describe('compra sin cuenta · alta del pedido', () => {
  it('crea el pedido a nombre de una ficha de invitado nueva, sin contraseña', async () => {
    const respuesta = await altaCompleta();

    expect(respuesta.status).toBe(201);

    const { User } = await modelos();
    const ficha = await User.findOne({ email: 'ana@ejemplo.com' }).select('+password');
    expect(ficha).not.toBeNull();
    expect(ficha!.role).toBe('invitado');
    expect(ficha!.username).toBe('ana@ejemplo.com');
    expect(ficha!.password).toBeUndefined();
    expect(ficha!.profile.firstName).toBe('Ana');
    expect(ficha!.profile.phone).toBe('600111222');
    expect(ficha!.profile.addresses).toHaveLength(1);
    expect(ficha!.profile.addresses[0].esPredeterminada).toBe(true);

    const pedido = await releerPedido(respuesta.body.data.pedido._id);
    expect(String(pedido.user)).toBe(String(ficha!._id));
    expect(pedido.status).toBe(OrderStatus.PENDIENTE);
    // El pedido guarda su propia copia del contacto y del envío.
    expect(pedido.invitado).toMatchObject({ firstName: 'Ana', email: 'ana@ejemplo.com' });
    expect(pedido.shippingAddress).toMatchObject({ calle: 'Calle Mayor 1', codigoPostal: '46001' });
  });

  it('el importe sale del catálogo, no de la petición', async () => {
    const respuesta = await altaCompleta({ items: [{ ...lineaCamiseta, price: 0.01 }] });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.data.pedido.total).toBe(100);
  });

  it('entrega la clave una vez y solo guarda su huella', async () => {
    const respuesta = await altaCompleta();
    const clave: string = respuesta.body.data.claveAcceso;

    expect(clave).toMatch(/^[0-9a-f]{64}$/);
    // La huella no viaja nunca en una respuesta.
    expect(respuesta.body.data.pedido).not.toHaveProperty('accesoInvitado');

    const { Order } = await modelos();
    const guardado = await Order.findById(respuesta.body.data.pedido._id).select('+accesoInvitado');
    expect(guardado!.accesoInvitado).toBe(crypto.createHash('sha256').update(clave).digest('hex'));
    expect(guardado!.accesoInvitado).not.toBe(clave);
  });

  it('una segunda compra con el mismo correo reutiliza la ficha y no la reescribe', async () => {
    await altaCompleta();

    const otraDireccion = { ...direccion, calle: 'Avenida del Puerto 20', codigoPostal: '46023' };
    const segunda = await alta({
      invitado: { ...comprador, firstName: 'Otro nombre', phone: '699999999' },
      shippingAddress: otraDireccion,
      items: [lineaCamiseta],
    });
    expect(segunda.status).toBe(201);

    // La misma dirección otra vez no se duplica.
    const tercera = await alta({
      invitado: comprador,
      shippingAddress: otraDireccion,
      items: [lineaCamiseta],
    });
    expect(tercera.status).toBe(201);

    const { User } = await modelos();
    const fichas = await User.find({ email: 'ana@ejemplo.com' });
    expect(fichas).toHaveLength(1);

    const [ficha] = fichas;
    // Quien conoce un correo no puede cambiar el nombre ni el teléfono de otro.
    expect(ficha.profile.firstName).toBe('Ana');
    expect(ficha.profile.phone).toBe('600111222');
    // Lo único que se añade es la dirección nueva, una sola vez.
    expect(ficha.profile.addresses).toHaveLength(2);
    expect(ficha.profile.addresses[1].esPredeterminada).toBe(false);

    // Y el pedido sí dice lo que se dio al comprar.
    const pedido = await releerPedido(segunda.body.data.pedido._id);
    expect(pedido.invitado?.firstName).toBe('Otro nombre');
    expect(String(pedido.user)).toBe(String(ficha._id));
  });

  it('dos compras simultáneas con el mismo correo dejan una sola ficha', async () => {
    const [una, otra] = await Promise.all([altaCompleta(), altaCompleta()]);

    expect(una.status).toBe(201);
    expect(otra.status).toBe(201);

    const { User } = await modelos();
    expect(await User.countDocuments({ email: 'ana@ejemplo.com' })).toBe(1);
  });

  it('un correo con cuenta de verdad no se usa como invitado', async () => {
    const { User, Order } = await modelos();
    await User.create({
      username: 'ana',
      email: 'ana@ejemplo.com',
      password: 'secreta123',
      profile: { firstName: 'Ana', lastName: 'Cliente' },
    });

    const respuesta = await altaCompleta();

    expect(respuesta.status).toBe(409);
    expect(respuesta.body.error).toContain('ya tiene una cuenta');
    expect(await Order.countDocuments()).toBe(0);
    expect(await User.countDocuments()).toBe(1);
  });

  it('una cuenta antigua llamada como ese correo no bloquea la compra: la ficha toma otro nombre', async () => {
    const { User } = await modelos();
    const antigua = await User.create({
      username: 'ana@ejemplo.com',
      email: 'otra.persona@ejemplo.com',
      password: 'secreta123',
      profile: { firstName: 'Otra', lastName: 'Persona' },
    });

    const respuesta = await altaCompleta();

    expect(respuesta.status).toBe(201);
    const ficha = await User.findOne({ email: 'ana@ejemplo.com' });
    expect(ficha!.role).toBe('invitado');
    expect(ficha!.username).not.toBe('ana@ejemplo.com');
    expect(String(ficha!._id)).not.toBe(String(antigua._id));
  });

  it('una ficha bloqueada por el admin no puede seguir comprando', async () => {
    await altaCompleta();
    const { User, Order } = await modelos();
    await User.updateOne({ email: 'ana@ejemplo.com' }, { status: 'baneado' });

    const respuesta = await altaCompleta();

    expect(respuesta.status).toBe(403);
    // No dice por qué: no hay que darle pistas a nadie.
    expect(respuesta.body.error).not.toContain('bloquead');
    expect(await Order.countDocuments()).toBe(1);
  });

  it('una ficha no guarda más de cinco direcciones', async () => {
    for (let i = 0; i < 7; i += 1) {
      const respuesta = await altaCompleta({ shippingAddress: { ...direccion, calle: `Calle ${i}` } });
      expect(respuesta.status).toBe(201);
    }

    const { User } = await modelos();
    const ficha = await User.findOne({ email: 'ana@ejemplo.com' });
    expect(ficha!.profile.addresses).toHaveLength(5);
    expect(ficha!.profile.addresses.filter((d) => d.esPredeterminada)).toHaveLength(1);
  });

  it('dos compras a la vez con la misma dirección nueva no la duplican', async () => {
    await altaCompleta();
    const nueva = { ...direccion, calle: 'Avenida Nueva 2' };

    await Promise.all([altaCompleta({ shippingAddress: nueva }), altaCompleta({ shippingAddress: nueva })]);

    const { User } = await modelos();
    const ficha = await User.findOne({ email: 'ana@ejemplo.com' });
    expect(ficha!.profile.addresses.map((d) => d.calle)).toEqual(['Calle Mayor 1', 'Avenida Nueva 2']);
  });

  it('un nombre de cien kilobytes no entra', async () => {
    const respuesta = await altaCompleta({ invitado: { ...comprador, firstName: 'x'.repeat(100_000) } });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toContain('firstName');
  });

  it('frena a quien encadena pedidos desde la misma IP', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      estados.push((await altaCompleta()).status);
    }

    expect(estados.slice(0, 10).every((estado) => estado === 201)).toBe(true);
    expect(estados[10]).toBe(429);
  });

  it('un producto sin dirección de envío no se admite, y no deja ficha', async () => {
    const respuesta = await alta({ invitado: comprador, items: [lineaCamiseta] });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toContain('dirección');
    const { User } = await modelos();
    expect(await User.countDocuments()).toBe(0);
  });

  it('una dirección a medias no se admite', async () => {
    const respuesta = await altaCompleta({ shippingAddress: { ...direccion, codigoPostal: '' } });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toContain('codigoPostal');
  });

  it('un servicio se puede comprar sin dirección', async () => {
    await crearServicio();

    const respuesta = await alta({ invitado: comprador, items: [{ codigoArticulo: 6001, quantity: 1 }] });

    expect(respuesta.status).toBe(201);
    const { User } = await modelos();
    const ficha = await User.findOne({ email: 'ana@ejemplo.com' });
    expect(ficha!.profile.addresses).toHaveLength(0);
  });

  it('un servicio que se presupuesta necesita cuenta', async () => {
    await crearServicio({ requiereConfirmacion: true });

    const respuesta = await alta({ invitado: comprador, items: [{ codigoArticulo: 6001, quantity: 1 }] });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toContain('necesitas una cuenta');
  });

  it('faltan datos del comprador: dice cuáles', async () => {
    const respuesta = await altaCompleta({ invitado: { ...comprador, lastName: ' ', phone: '' } });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toContain('lastName');
    expect(respuesta.body.error).toContain('phone');
  });

  it('un correo mal formado se rechaza', async () => {
    const respuesta = await altaCompleta({ invitado: { ...comprador, email: 'no-es-un-correo' } });

    expect(respuesta.status).toBe(400);
  });

  it('un artículo que no existe se rechaza sin crear ficha', async () => {
    const respuesta = await altaCompleta({ items: [{ codigoArticulo: 1999, quantity: 1, talla: 'M' }] });

    expect(respuesta.status).toBe(400);
    const { User } = await modelos();
    expect(await User.countDocuments()).toBe(0);
  });

  it('si otro se ha llevado el horario, responde 409 y no deja pedido', async () => {
    await crearServicio({ requiereReserva: true });
    const { DisponibilidadModelo, EstadoSlot } = await import('../../src/availability/disponibilidad.model');
    const hueco = await DisponibilidadModelo.create({
      servicio: 6001,
      fecha: new Date('2030-01-10T00:00:00.000Z'),
      horaInicio: '10:00',
      horaFin: '11:00',
      duracion: 60,
      estado: EstadoSlot.OCUPADO,
      pedidoId: new Types.ObjectId(),
    });

    const respuesta = await alta({
      invitado: comprador,
      items: [{ codigoArticulo: 6001, quantity: 1, slotId: String(hueco._id) }],
    });

    expect(respuesta.status).toBe(409);
    const { Order } = await modelos();
    expect(await Order.countDocuments()).toBe(0);
  });

  it('una lista de líneas con un null es un 400, no un 500', async () => {
    const respuesta = await altaCompleta({ items: [null] });

    expect(respuesta.status).toBe(400);
  });
});

describe('compra sin cuenta · horarios', () => {
  const crearHueco = crearHuecoDePrueba;
  const releerHueco = releerHuecoDePrueba;

  const reservar = (slotId: unknown) =>
    alta({ invitado: comprador, items: [{ codigoArticulo: 6001, quantity: 1, slotId: String(slotId) }] });

  it('un pedido de invitado retiene su horario una hora, no dos días', async () => {
    await crearServicio({ requiereReserva: true });
    const hueco = await crearHueco();

    const antes = Date.now();
    const respuesta = await reservar(hueco._id);

    expect(respuesta.status).toBe(201);
    const retenido = await releerHueco(hueco._id);
    const horas = (retenido!.retenidoHasta!.getTime() - antes) / 3_600_000;
    expect(horas).toBeGreaterThan(0.9);
    expect(horas).toBeLessThan(1.1);
  });

  it('al empezar a cobrar se recupera el horario si se había soltado y sigue libre', async () => {
    await crearServicio({ requiereReserva: true });
    const hueco = await crearHueco();
    const respuesta = await reservar(hueco._id);
    const { _id: id } = respuesta.body.data.pedido;

    // La retención caducó y el hueco volvió al catálogo.
    const { DisponibilidadModelo, EstadoSlot } = await import('../../src/availability/disponibilidad.model');
    await DisponibilidadModelo.updateOne(
      { _id: hueco._id },
      { $set: { estado: EstadoSlot.DISPONIBLE }, $unset: { pedidoId: '', retenidoHasta: '' } },
    );

    const cobro = await request(app)
      .post(`/api/pedidos/invitado/${id}/pago/iniciar`)
      .set('X-Clave-Pedido', respuesta.body.data.claveAcceso)
      .send({ metodo: 'stripe' });

    expect(cobro.status).toBe(200);
    const recuperado = await releerHueco(hueco._id);
    expect(String(recuperado!.pedidoId)).toBe(id);
    expect(recuperado!.estado).toBe(EstadoSlot.OCUPADO);
  });

  it('si el horario lo tiene ya otro pedido, no se cobra', async () => {
    await crearServicio({ requiereReserva: true });
    const hueco = await crearHueco();
    const respuesta = await reservar(hueco._id);

    const { DisponibilidadModelo } = await import('../../src/availability/disponibilidad.model');
    await DisponibilidadModelo.updateOne({ _id: hueco._id }, { $set: { pedidoId: new Types.ObjectId() } });

    const cobro = await request(app)
      .post(`/api/pedidos/invitado/${respuesta.body.data.pedido._id}/pago/iniciar`)
      .set('X-Clave-Pedido', respuesta.body.data.claveAcceso)
      .send({ metodo: 'stripe' });

    expect(cobro.status).toBe(409);
    expect(stripeSimulado.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('compra sin cuenta · al pagar', () => {
  it('la ficha pasa a figurar como cliente', async () => {
    const respuesta = await altaCompleta();
    const { marcarPagado } = await import('../../src/payments/pago.service');

    await marcarPagado(respuesta.body.data.pedido._id, {
      referencia: 'pi_de_prueba',
      estado: 'succeeded',
      proveedor: 'stripe',
    });

    const { User } = await modelos();
    const ficha = await User.findOne({ email: 'ana@ejemplo.com' });
    expect(ficha!.customer.isCustomer).toBe(true);
    expect(ficha!.customer.since).toBeInstanceOf(Date);
  });
});

describe('compra sin cuenta · la sesión no abre pedidos de invitado', () => {
  it('ni el listado ni el detalle los enseñan a quien entra con la cuenta de ese correo', async () => {
    const respuesta = await altaCompleta();
    const { User } = await modelos();
    const ficha = await User.findOne({ email: 'ana@ejemplo.com' });
    // Como si la ficha ya se hubiera convertido en cuenta.
    await User.updateOne({ _id: ficha!._id }, { role: 'user' });
    const { sesionDe } = await import('../ayudas/sesion');
    const sesion = sesionDe({ id: ficha!._id });

    const listado = await request(app).get('/api/pedidos').set('Authorization', sesion.cabecera);
    const detalle = await request(app)
      .get(`/api/pedidos/${respuesta.body.data.pedido._id}`)
      .set('Authorization', sesion.cabecera);
    const cobro = await request(app)
      .post(`/api/pedidos/${respuesta.body.data.pedido._id}/pago/iniciar`)
      .set('Authorization', sesion.cabecera)
      .send({});

    expect(listado.status).toBe(200);
    expect(listado.body.data).toHaveLength(0);
    expect(detalle.status).toBe(404);
    expect(cobro.status).toBe(404);
  });

  it('el admin sí los ve', async () => {
    await altaCompleta();
    const { sesionDeAdmin } = await import('../ayudas/sesion');

    const listado = await request(app).get('/api/pedidos').set('Authorization', sesionDeAdmin().cabecera);

    expect(listado.body.data).toHaveLength(1);
    expect(listado.body.data[0].invitado.email).toBe('ana@ejemplo.com');
  });
});

describe('compra sin cuenta · la clave abre el pedido', () => {
  const pedidoConClave = async () => {
    const respuesta = await altaCompleta();
    return { id: respuesta.body.data.pedido._id as string, clave: respuesta.body.data.claveAcceso as string };
  };

  it('con su clave se lee el pedido, sin la huella', async () => {
    const { id, clave } = await pedidoConClave();

    const respuesta = await request(app).get(`/api/pedidos/invitado/${id}`).set('X-Clave-Pedido', clave);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.data._id).toBe(id);
    expect(respuesta.body.data).not.toHaveProperty('accesoInvitado');
  });

  it('sin clave, con una clave ajena o sobre un pedido con cuenta responde 404, nunca 401', async () => {
    const { id } = await pedidoConClave();
    const otro = await pedidoConClave();
    const conCuenta = await crearPedido({ user: new Types.ObjectId() });

    const sinClave = await request(app).get(`/api/pedidos/invitado/${id}`);
    const claveAjena = await request(app)
      .get(`/api/pedidos/invitado/${id}`)
      .set('X-Clave-Pedido', otro.clave);
    const pedidoConCuenta = await request(app)
      .get(`/api/pedidos/invitado/${String(conCuenta._id)}`)
      .set('X-Clave-Pedido', otro.clave);

    // 401 cerraría la sesión en el frontend: aquí no hay sesión que cerrar.
    expect([sinClave.status, claveAjena.status, pedidoConCuenta.status]).toEqual([404, 404, 404]);
  });

  it('con su clave se arranca el cobro, igual que con cuenta', async () => {
    const { id, clave } = await pedidoConClave();

    const respuesta = await request(app)
      .post(`/api/pedidos/invitado/${id}/pago/iniciar`)
      .set('X-Clave-Pedido', clave)
      .send({ metodo: 'stripe' });

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.data.clientSecret).toBe('pi_creado_en_el_test_secret');

    const enviado = stripeSimulado.paymentIntents.create.mock.calls[0][0];
    expect(enviado.amount).toBe(10000);
    expect(enviado.metadata?.orderId).toBe(id);
    // El correo permite reconocer el cobro en el panel de Stripe.
    expect(enviado.metadata?.invitado).toBe('ana@ejemplo.com');
  });

  it('sin clave no se arranca ningún cobro', async () => {
    const { id } = await pedidoConClave();

    const respuesta = await request(app).post(`/api/pedidos/invitado/${id}/pago/iniciar`).send({});

    expect(respuesta.status).toBe(404);
    expect(stripeSimulado.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('la clave no abre las rutas de los clientes con cuenta', async () => {
    const { id, clave } = await pedidoConClave();

    const respuesta = await request(app).get(`/api/pedidos/${id}`).set('X-Clave-Pedido', clave);

    expect(respuesta.status).toBe(401);
  });

  it('el navegador puede mandar la cabecera de la clave (CORS)', async () => {
    const respuesta = await request(app)
      .options('/api/pedidos/invitado')
      .set('Origin', 'https://tienda.example.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-clave-pedido');

    expect(respuesta.status).toBe(204);
    expect(respuesta.headers['access-control-allow-headers']?.toLowerCase()).toContain('x-clave-pedido');
  });
});

// ── Lo que encontró la revisión adversarial ──────────────────────────────────

const RETORNO = 'https://tienda.example.test/checkout?pago=paypal&volver=invitado';

const reservarHueco = async () => {
  await crearServicio({ requiereReserva: true });
  const hueco = await crearHuecoDePrueba();
  const respuesta = await alta({
    invitado: comprador,
    items: [{ codigoArticulo: 6001, quantity: 1, slotId: String(hueco._id) }],
  });
  expect(respuesta.status).toBe(201);
  return {
    hueco,
    id: respuesta.body.data.pedido._id as string,
    clave: respuesta.body.data.claveAcceso as string,
  };
};

const iniciarComoInvitado = (id: string, clave: string, cuerpo: Record<string, unknown>) =>
  request(app).post(`/api/pedidos/invitado/${id}/pago/iniciar`).set('X-Clave-Pedido', clave).send(cuerpo);

const moverHueco = async (id: unknown, cambios: Record<string, unknown>) => {
  const { DisponibilidadModelo } = await import('../../src/availability/disponibilidad.model');
  await DisponibilidadModelo.updateOne({ _id: id }, cambios);
};

/** Envejece el pedido saltándose `timestamps`, que no deja escribir `createdAt`. */
const envejecerPedido = async (id: string, horas: number) => {
  const { Order } = await modelos();
  await Order.collection.updateOne(
    { _id: new Types.ObjectId(id) },
    { $set: { createdAt: new Date(Date.now() - horas * 3_600_000) } },
  );
};

describe('compra sin cuenta · la retención tiene tope', () => {
  it('una llamada que no va a cobrar nada no renueva la retención', async () => {
    const { hueco, id, clave } = await reservarHueco();
    const casiCaducada = new Date(Date.now() + 60_000);
    await moverHueco(hueco._id, { retenidoHasta: casiCaducada });

    const respuesta = await iniciarComoInvitado(id, clave, { metodo: 'paypal' });

    expect(respuesta.status).toBe(400);
    const releido = await releerHuecoDePrueba(hueco._id);
    expect(releido!.retenidoHasta!.getTime()).toBe(casiCaducada.getTime());
  });

  it('pasado el tope desde el alta, ni se renueva ni se recupera: no se cobra', async () => {
    const { hueco, id, clave } = await reservarHueco();
    await envejecerPedido(id, 4);
    const { EstadoSlot } = await import('../../src/availability/disponibilidad.model');
    await moverHueco(hueco._id, {
      $set: { estado: EstadoSlot.DISPONIBLE },
      $unset: { pedidoId: '', retenidoHasta: '' },
    });

    const respuesta = await iniciarComoInvitado(id, clave, { metodo: 'stripe' });

    expect(respuesta.status).toBe(409);
    expect(respuesta.body.error).toContain('plazo');
    expect((await releerHuecoDePrueba(hueco._id))!.estado).toBe(EstadoSlot.DISPONIBLE);
    expect(stripeSimulado.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('renovar no lleva la retención más allá del tope', async () => {
    const { hueco, id, clave } = await reservarHueco();
    await envejecerPedido(id, 2.5);

    const respuesta = await iniciarComoInvitado(id, clave, { metodo: 'stripe' });

    expect(respuesta.status).toBe(200);
    const minutosRestantes =
      ((await releerHuecoDePrueba(hueco._id))!.retenidoHasta!.getTime() - Date.now()) / 60_000;
    // Tope: 3 horas desde el alta, es decir, media hora desde ahora.
    expect(minutosRestantes).toBeLessThan(31);
    expect(minutosRestantes).toBeGreaterThan(28);
  });

  it('frena a quien encadena arranques de cobro desde la misma IP', async () => {
    const respuesta = await altaCompleta();
    const { _id: id } = respuesta.body.data.pedido;
    const clave = respuesta.body.data.claveAcceso;

    let ultimo = 0;
    for (let i = 0; i < 31; i += 1) {
      ultimo = (await iniciarComoInvitado(id, clave, { metodo: 'stripe' })).status;
    }

    expect(ultimo).toBe(429);
  });
});

describe('compra sin cuenta · PayPal', () => {
  beforeEach(() => {
    paypalSimulado.crearOrdenPayPal.mockClear();
    paypalSimulado.capturarOrdenPayPal.mockClear();
  });

  const capturar = (id: string, clave: string) =>
    request(app).post(`/api/pedidos/invitado/${id}/pago/capturar`).set('X-Clave-Pedido', clave);

  it('no captura si el horario ya es de otro pedido: la orden de PayPal caduca sin cobrar', async () => {
    const { hueco, id, clave } = await reservarHueco();
    expect((await iniciarComoInvitado(id, clave, { metodo: 'paypal', returnUrl: RETORNO })).status).toBe(200);
    await moverHueco(hueco._id, { $set: { pedidoId: new Types.ObjectId() } });

    const respuesta = await capturar(id, clave);

    expect(respuesta.status).toBe(409);
    expect(paypalSimulado.capturarOrdenPayPal).not.toHaveBeenCalled();
    expect((await releerPedido(id)).status).toBe(OrderStatus.PENDIENTE);
  });

  it('no captura un pedido cancelado', async () => {
    const alta = await altaCompleta();
    const { _id: id } = alta.body.data.pedido;
    const clave = alta.body.data.claveAcceso;
    await iniciarComoInvitado(id, clave, { metodo: 'paypal', returnUrl: RETORNO });
    await request(app).post(`/api/pedidos/invitado/${id}/cancelar`).set('X-Clave-Pedido', clave);

    const respuesta = await capturar(id, clave);

    expect(respuesta.status).toBe(409);
    expect(paypalSimulado.capturarOrdenPayPal).not.toHaveBeenCalled();
  });
});

describe('compra sin cuenta · un cobro que llega tarde', () => {
  const cobrar = async (id: string) => {
    const { marcarPagado } = await import('../../src/payments/pago.service');
    await marcarPagado(id, { referencia: 'pi_tardio', estado: 'succeeded', proveedor: 'stripe' });
  };

  it('si su horario ya es de otro, el pedido cobrado lo deja anotado', async () => {
    const { hueco, id } = await reservarHueco();
    await moverHueco(hueco._id, { $set: { pedidoId: new Types.ObjectId() } });

    await cobrar(id);

    const pedido = await releerPedido(id);
    expect(pedido.status).toBe(OrderStatus.PAGADO);
    expect(pedido.incidenciasHorario).toHaveLength(1);
    expect(pedido.incidenciasHorario![0].slotId).toBe(String(hueco._id));
  });

  it('si se soltó y sigue libre, lo recupera ya en firme', async () => {
    const { hueco, id } = await reservarHueco();
    const { EstadoSlot } = await import('../../src/availability/disponibilidad.model');
    await moverHueco(hueco._id, {
      $set: { estado: EstadoSlot.DISPONIBLE },
      $unset: { pedidoId: '', retenidoHasta: '' },
    });

    await cobrar(id);

    const releido = await releerHuecoDePrueba(hueco._id);
    expect(String(releido!.pedidoId)).toBe(id);
    expect(releido!.retenidoHasta).toBeUndefined();
    expect((await releerPedido(id)).incidenciasHorario).toHaveLength(0);
  });
});

describe('compra sin cuenta · cancelar el propio pedido', () => {
  const cancelar = (id: string, clave?: string) => {
    const peticion = request(app).post(`/api/pedidos/invitado/${id}/cancelar`);
    return clave ? peticion.set('X-Clave-Pedido', clave) : peticion;
  };

  it('lo cancela y suelta su horario, y repetirlo no falla', async () => {
    const { hueco, id, clave } = await reservarHueco();

    const primera = await cancelar(id, clave);
    const segunda = await cancelar(id, clave);

    expect(primera.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect((await releerPedido(id)).status).toBe(OrderStatus.CANCELADO);
    const { EstadoSlot } = await import('../../src/availability/disponibilidad.model');
    expect((await releerHuecoDePrueba(hueco._id))!.estado).toBe(EstadoSlot.DISPONIBLE);
  });

  it('anula el intento de Stripe que siguiera vivo', async () => {
    const alta = await altaCompleta();
    const { _id: id } = alta.body.data.pedido;
    const clave = alta.body.data.claveAcceso;
    await iniciarComoInvitado(id, clave, { metodo: 'stripe' });

    await cancelar(id, clave);

    expect(stripeSimulado.paymentIntents.cancel).toHaveBeenCalledWith('pi_creado_en_el_test');
  });

  it('no lo cancela si el pago ya está en marcha', async () => {
    const alta = await altaCompleta();
    const { _id: id } = alta.body.data.pedido;
    const clave = alta.body.data.claveAcceso;
    await iniciarComoInvitado(id, clave, { metodo: 'bizum' });
    stripeSimulado.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_creado_en_el_test',
      client_secret: 'x',
      status: 'processing',
      amount: 10000,
    });

    const respuesta = await cancelar(id, clave);

    expect(respuesta.status).toBe(409);
    expect((await releerPedido(id)).status).toBe(OrderStatus.PENDIENTE);
  });

  it('un pedido ya pagado no se cancela por aquí', async () => {
    const alta = await altaCompleta();
    const { _id: id } = alta.body.data.pedido;
    const { marcarPagado } = await import('../../src/payments/pago.service');
    await marcarPagado(id, { referencia: 'pi_x', estado: 'succeeded', proveedor: 'stripe' });

    const respuesta = await cancelar(id, alta.body.data.claveAcceso);

    expect(respuesta.status).toBe(409);
  });

  it('sin clave no se cancela nada', async () => {
    const alta = await altaCompleta();

    const respuesta = await cancelar(alta.body.data.pedido._id);

    expect(respuesta.status).toBe(404);
    expect((await releerPedido(alta.body.data.pedido._id)).status).toBe(OrderStatus.PENDIENTE);
  });
});
