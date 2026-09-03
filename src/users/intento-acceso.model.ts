import { Schema, model } from 'mongoose';

/**
 * Contador de intentos de acceso fallidos.
 *
 * Vive en la base de datos y no en memoria a proposito: el backend se despliega
 * en serverless, donde cada invocacion puede caer en una instancia distinta y
 * un contador en memoria no cuenta nada. Compartirlo en Mongo es lo que hace
 * que el bloqueo signifique algo.
 *
 * Los documentos caducan solos por indice TTL: la coleccion no crece, y un
 * intento viejo deja de pesar sin necesidad de limpiarlo a mano.
 */
export interface IIntentoAcceso {
  /** `usuario:<nombre>` o `ip:<direccion>`. Ver acceso.service.ts. */
  clave: string;
  intentos: number;
  bloqueadoHasta?: Date;
  expiraEn: Date;
}

const IntentoAccesoSchema = new Schema<IIntentoAcceso>(
  {
    clave:          { type: String, required: true, unique: true },
    intentos:       { type: Number, required: true, default: 0 },
    bloqueadoHasta: { type: Date },
    expiraEn:       { type: Date, required: true },
  },
  { versionKey: false },
);

// TTL: Mongo borra el documento cuando `expiraEn` queda atras.
IntentoAccesoSchema.index({ expiraEn: 1 }, { expireAfterSeconds: 0 });

export const IntentoAcceso = model<IIntentoAcceso>('IntentoAcceso', IntentoAccesoSchema);
