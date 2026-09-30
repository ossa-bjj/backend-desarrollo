/**
 * Los dos avisos que dispara el cobro: una reclamación del cliente a su banco
 * y un cobro que no se pudo servir entero (sin existencias o sin horario).
 *
 * El módulo de avisos está simulado: aquí se comprueba cuándo se avisa, no
 * cómo sale el mensaje (eso está en `avisos.test.ts`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { crearPedido, crearProducto, lineaDeProducto, releerPedido } from '../ayudas/pedidos';
import type * as ModuloAvisos from '../../src/shared/avisos';

const avisarALaAcademia = vi.hoisted(() => vi.fn(async () => ({ telegram: true, correo: true })));

vi.mock('../../src/shared/avisos', async () => {
  const real = await vi.importActual<typeof ModuloAvisos>('../../src/shared/avisos');
  return { ...real, avisarALaAcademia };
});

const servicio = async () => import('../../src/payments/pago.service');

const titulos = () =>
  (avisarALaAcademia.mock.calls as unknown as Array<[{ titulo: string }]>).map(([a]) => a.titulo);

beforeEach(() => {
  avisarALaAcademia.mockClear();
});

describe('aviso de reclamación', () => {
  const disputa = (estado: string, cerrada = false) => ({
    id: 'dp_1',
    estado,
    motivo: 'fraudulent',
    importeEnCentimos: 5000,
    cerrada,
  });

  it('avisa al abrirse y al cerrarse, no en los cambios intermedios', async () => {
    const { registrarDisputa } = await servicio();
    const pedido = await crearPedido({ user: new Types.ObjectId() });

    await registrarDisputa(pedido, disputa('needs_response'));
    await registrarDisputa(await releerPedido(pedido._id), disputa('under_review'));
    await registrarDisputa(await releerPedido(pedido._id), disputa('lost', true));

    expect(titulos()).toHaveLength(2);
    expect(titulos()[0]).toContain('Reclamación abierta');
    expect(titulos()[1]).toContain('Reclamación cerrada (lost)');
  });

  it('un aviso repetido de Stripe no avisa dos veces', async () => {
    const { registrarDisputa } = await servicio();
    const pedido = await crearPedido({ user: new Types.ObjectId() });

    await registrarDisputa(pedido, disputa('needs_response'));
    await registrarDisputa(await releerPedido(pedido._id), disputa('needs_response'));

    expect(avisarALaAcademia).toHaveBeenCalledTimes(1);
  });
});

describe('aviso de cobro que no se pudo servir', () => {
  it('avisa si se cobró sin existencias', async () => {
    const { marcarPagado } = await servicio();
    await crearProducto({ tallas: [{ talla: 'M', stock: 0 }] });
    const pedido = await crearPedido({ items: [lineaDeProducto({ talla: 'M' })] });

    await marcarPagado(String(pedido._id), { referencia: 'pi_x', estado: 'succeeded', proveedor: 'stripe' });

    expect(titulos()).toHaveLength(1);
    expect(titulos()[0]).toContain('cobrado sin poder servirse entero');
  });

  it('un cobro normal no avisa', async () => {
    const { marcarPagado } = await servicio();
    await crearProducto({ tallas: [{ talla: 'M', stock: 3 }] });
    const pedido = await crearPedido({ items: [lineaDeProducto({ talla: 'M' })] });

    await marcarPagado(String(pedido._id), { referencia: 'pi_x', estado: 'succeeded', proveedor: 'stripe' });

    expect(avisarALaAcademia).not.toHaveBeenCalled();
  });
});
