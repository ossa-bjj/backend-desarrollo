import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import connectDB from './src/shared/db';
import userRouter from './src/users/user.routes';
import productoRouter from './src/products/producto.routes';
import orderRouter from './src/orders/order.routes';
import servicioRouter from './src/services/servicio.routes';
import disponibilidadRouter from './src/availability/disponibilidad.routes';
import noticiaRouter from './src/news/noticia.routes';
import { getFromR2 } from './src/shared/r2.utils';
import { validateEnvironment } from './src/shared/env';
import { corsOptions, esOrigenPermitido, registrarEstadoCors } from './src/shared/cors';

validateEnvironment();

const app = express();

// Detras del proxy de Vercel, `req.ip` sin esto es la IP del propio proxy: el
// freno por IP del login estaria contando a todo el mundo como el mismo
// visitante. Un solo salto de confianza, para que la cabecera reenviada no la
// pueda falsear el cliente.
app.set('trust proxy', 1);

// --- MIDDLEWARES ---
// Stripe firma el cuerpo tal cual lo envia, asi que su webhook necesita el
// Buffer sin parsear. express.json() detecta que el cuerpo ya se leyo y lo
// respeta, por eso este orden importa.
//
// Se monta con `post` y no con `use` a proposito: `use` casa por prefijo, y
// entonces el webhook de PayPal —que cuelga de /webhook/paypal y si quiere el
// cuerpo parseado— recibiria tambien un Buffer.
app.post('/api/pedidos/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// --- CORS ---
// La politica vive en src/shared/cors.ts. Un origen no permitido se rechaza
// sin cabeceras CORS, no con un error: asi el resto de la API sigue en pie.
app.use(cors(corsOptions));
registrarEstadoCors();

// --- CONEXION A DB (lazy, cacheada entre invocaciones serverless) ---
app.use(async (_req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('Error de conexion a la DB:', error);
    res.status(503).json({
      error: 'Servicio no disponible: fallo de conexion a la base de datos',
      details: (error as Error).message,
    });
  }
});

// --- RUTAS ---
app.use('/api/users',    userRouter);
app.use('/api/productos', productoRouter);
app.use('/api/pedidos',  orderRouter);
app.use('/api/servicios', servicioRouter);
app.use('/api/disponibilidad', disponibilidadRouter);
app.use('/api/noticias', noticiaRouter);

// --- PROXY DE IMÁGENES R2 (público, sin auth) ---
app.get('/api/media/*key', async (req, res) => {
  const segments = req.params.key;
  const key = Array.isArray(segments) ? segments.join('/') : segments;
  if (!key) return res.status(400).json({ error: 'Falta la clave del archivo' });

  try {
    const { stream, contentType } = await getFromR2(key);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    stream.pipe(res);
  } catch (error) {
    // R2 (compatible con S3) responde NoSuchKey cuando el objeto no existe.
    if ((error as Error).name === 'NoSuchKey') {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    console.error('Error al obtener archivo de R2:', (error as Error).message);
    res.status(500).json({ error: 'Error al obtener archivo' });
  }
});

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    api: mongoose.connection.readyState === 1 ? 'conectado' : 'desconectado',
  });
});

// Diagnostico de CORS: responde si el origen que llama esta admitido. No
// revela la lista, solo el veredicto para quien pregunta, que es lo mismo que
// ya deduce del ACAO de cualquier respuesta. Convierte el "no conecta y no se
// por que" en una comprobacion de un segundo desde la consola del navegador.
app.get('/api/cors-check', (req, res) => {
  const origen = req.headers.origin;
  res.json({
    origen: origen ?? null,
    permitido: origen ? esOrigenPermitido(origen) : true,
  });
});

// --- CONTROL DE ERRORES ---
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // express.json() rechaza los cuerpos mal formados o demasiado grandes con un
  // error que ya trae su propio codigo 4xx. Devolver 500 en esos casos culpa al
  // servidor de un fallo del cliente, y manda a buscar la averia donde no esta.
  const { status, statusCode } = err as Error & { status?: number; statusCode?: number };
  const codigoDelCliente = status ?? statusCode;

  if (codigoDelCliente && codigoDelCliente >= 400 && codigoDelCliente < 500) {
    console.warn(`Peticion rechazada (${codigoDelCliente}): ${err.message}`);
    res.status(codigoDelCliente).json({ error: 'Peticion mal formada' });
    return;
  }

  console.error(err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// --- SERVIDOR (solo en local, en Vercel se usa api/index.ts) ---
if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  connectDB()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Servidor levantado en http://localhost:${PORT}`);
      });
    })
    .catch((error) => {
      console.error('No se pudo iniciar la aplicacion por error de DB:', error);
      process.exit(1);
    });
}

export default app;
