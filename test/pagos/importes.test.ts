/**
 * Conversión de importes.
 *
 * Son tres funciones de una línea, y por eso mismo merecen test: el total que se
 * guarda en el pedido y el importe que se manda a cobrar salen de aquí. Si se
 * separan un céntimo, no lo detecta nadie hasta que lo dice un cliente.
 *
 * Los casos elegidos son los que rompen con flotantes: 0,1 + 0,2, los que caen
 * justo en el medio céntimo y los totales largos que salen de multiplicar.
 */

import { describe, expect, it } from 'vitest';
import { aCentimos, comoDecimalDeTexto, redondearEuros } from '../../src/shared/dinero';

describe('aCentimos', () => {
  it('convierte euros a céntimos enteros', () => {
    expect(aCentimos(34.99)).toBe(3499);
    expect(aCentimos(50)).toBe(5000);
    expect(aCentimos(0.05)).toBe(5);
  });

  it('nunca devuelve decimales, que Stripe cobraría mal en silencio', () => {
    for (const euros of [0.1, 1.005, 19.99, 34.989999999999995, 1234.567]) {
      expect(Number.isInteger(aCentimos(euros))).toBe(true);
    }
  });

  it('sobrevive a la suma de flotantes', () => {
    // 0.1 + 0.2 es 0.30000000000000004 en coma flotante.
    expect(aCentimos(0.1 + 0.2)).toBe(30);
    // Lo que sale de 3 × 11,663.
    expect(aCentimos(34.989999999999995)).toBe(3499);
  });

  it('redondea el medio céntimo hacia arriba', () => {
    expect(aCentimos(0.125)).toBe(13);
    expect(aCentimos(10.005)).toBe(1001);
  });

  it('cero es cero', () => {
    expect(aCentimos(0)).toBe(0);
  });
});

describe('redondearEuros', () => {
  it('deja dos decimales', () => {
    expect(redondearEuros(34.989999999999995)).toBe(34.99);
    expect(redondearEuros(0.1 + 0.2)).toBe(0.3);
    expect(redondearEuros(19.999)).toBe(20);
  });

  it('es estable: redondear lo ya redondeado no lo cambia', () => {
    for (const euros of [0.1, 34.99, 1234.56]) {
      expect(redondearEuros(redondearEuros(euros))).toBe(redondearEuros(euros));
    }
  });
});

describe('coherencia entre las dos', () => {
  it('el total que se guarda y el importe que se cobra dicen lo mismo', () => {
    for (const euros of [0.1 + 0.2, 34.989999999999995, 19.995, 3 * 11.663, 1234.567]) {
      expect(aCentimos(euros)).toBe(aCentimos(redondearEuros(euros)));
    }
  });
});

describe('comoDecimalDeTexto', () => {
  it('siempre dos decimales', () => {
    expect(comoDecimalDeTexto(50)).toBe('50.00');
    expect(comoDecimalDeTexto(34.989999999999995)).toBe('34.99');
    expect(comoDecimalDeTexto(0.1 + 0.2)).toBe('0.30');
  });
});
