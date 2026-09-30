/**
 * Alta y cancelación de pedidos con cuenta.
 *
 * Dos reglas nuevas: un pedido con productos exige dirección de envío, y su
 * dueño puede cancelar el que no ha pagado, lo que suelta sus horarios. Es lo
 * que permite al carrito rehacer un pedido sin chocar con el anterior.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { OrderStatus } from '../../src/orders/order.model';
import { crearPedido, crearProducto, releerPedido } from '../ayudas/pedidos';
import { sesionDe, sesionDeAdmin } from '../ayudas/sesion';
import { reiniciarStripeSimulado } from '../ayudas/stripe-simulado';

vi.mock('../../src/payments/stripe.utils', async () => {
  const { moduloStripeSimulado } = await import('../ayudas/stripe-simulado');
  return moduloStripeSimulado();
});

let app: Express;
const cliente = sesionDe();

const direccion = {
  calle: 'Calle Mayor 1',
  ciudad: 'Valencia',
  provincia: 'Valencia',
  codigoPostal: '46001',
  pais: 'España',
};

const alta = (cuerpo: Record<string, unknown>) =>
  request(app).post('/api/pedidos').set('Authorization', cliente.cabecera).send(cuerpo);

const cancelar = (id: unknown, cabecera = cliente.cabecera) =>
  request(app)
    .post(`/api/pedidos/${String(id)}/cancelar`)
    .set('Authorization', cabecera);

beforeAll(async () => {
  app = (await import('../../index')).default;
});

beforeEach(async () => {
  reiniciarStripeSimulado();
  await crearProducto({ tallas: [{ talla: 'M', stock: 5 }] });
});

describe('alta con cuenta · dirección de envío', () => {
  const linea = { codigoArticulo: 1011, quantity: 1, talla: 'M' };

  it('un producto sin dirección no se admite', async () => {
    const respuesta = await alta({ items: [linea] });

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toContain('dirección');
  });

  it('una dirección a medias tampoco', async () => {
    const respuesta = await alta({ items: [linea], shippingAddress: { ...direccion, calle: '' } });

    expect(respuesta.status).toBe(400);
  });

  it('con dirección completa se crea', async () => {
    const respuesta = await alta({ items: [linea], shippingAddress: direccion });

    expect(respuesta.status).toBe(201);
    expect(respuesta.body.data.shippingAddress).toMatchObject({ calle: 'Calle Mayor 1' });
  });
});

describe('cancelar el propio pedido sin pagar', () => {
  it('lo cancela y suelta su horario', async () => {
    const { DisponibilidadModelo, EstadoSlot } = await import('../../src/availability/disponibilidad.model');
    const pedido = await crearPedido({ user: cliente.id });
    const hueco = await DisponibilidadModelo.create({
      servicio: 6001,
      fecha: new Date('2030-01-10T00:00:00.000Z'),
      horaInicio: '10:00',
      horaFin: '11:00',
      duracion: 60,
      estado: EstadoSlot.OCUPADO,
      pedidoId: pedido._id,
      retenidoHasta: new Date(Date.now() + 3_600_000),
    });

    const respuesta = await cancelar(pedido._id);

    expect(respuesta.status).toBe(200);
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.CANCELADO);
    expect((await DisponibilidadModelo.findById(hueco._id))!.estado).toBe(EstadoSlot.DISPONIBLE);
  });

  it('también un presupuesto que espera confirmación', async () => {
    const pedido = await crearPedido({ user: cliente.id, estado: OrderStatus.PENDIENTE_CONFIRMACION });

    expect((await cancelar(pedido._id)).status).toBe(200);
  });

  it('un pedido pagado no se cancela por aquí', async () => {
    const pedido = await crearPedido({ user: cliente.id, estado: OrderStatus.PAGADO });

    expect((await cancelar(pedido._id)).status).toBe(409);
  });

  it('nadie cancela el pedido de otro', async () => {
    const pedido = await crearPedido({ user: new Types.ObjectId() });

    expect((await cancelar(pedido._id)).status).toBe(403);
    expect((await releerPedido(pedido._id)).status).toBe(OrderStatus.PENDIENTE);
  });

  it('el admin sí puede', async () => {
    const pedido = await crearPedido({ user: new Types.ObjectId() });

    expect((await cancelar(pedido._id, sesionDeAdmin().cabecera)).status).toBe(200);
  });
});
