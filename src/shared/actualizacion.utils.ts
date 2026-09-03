/**
 * Filtrado del cuerpo de una actualizacion.
 *
 * Pasar `req.body` tal cual a `findOneAndUpdate` es una via de escritura
 * abierta: Mongoose interpreta como operadores las claves que empiezan por `$`,
 * asi que un cuerpo con `{"$unset": {"price": ""}}` deja el documento sin ese
 * campo saltandose el `required` del esquema, porque `runValidators` solo
 * comprueba los campos que se asignan, no los que se borran.
 *
 * Cada dominio declara que campos admite y todo lo demas se descarta en
 * silencio: un cliente que envia de mas no merece un error, merece que se le
 * ignore lo que no le corresponde.
 */
export const soloCampos = <T>(cuerpo: unknown, campos: readonly string[]): Partial<T> => {
  // Un cuerpo ausente, nulo o que no sea un objeto plano no aporta ningun
  // campo. Indexarlo sin comprobarlo reventaria antes de llegar a la consulta.
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) return {};

  const entrada = cuerpo as Record<string, unknown>;
  const cambios: Record<string, unknown> = {};

  for (const campo of campos) {
    if (entrada[campo] !== undefined) cambios[campo] = entrada[campo];
  }

  return cambios as Partial<T>;
};
