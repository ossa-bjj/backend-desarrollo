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
import { getFromR2 } from './src/shared/r2.utils';
import { validateEnvironment } from './src/shared/env';

validateEnvironment();

const app = express();

// --- MIDDLEWARES ---
// Stripe firma el cuerpo tal cual lo envia, asi que el webhook necesita el
// Buffer sin parsear. express.json() detecta que el cuerpo ya se leyo y lo
// respeta, por eso este orden importa.
app.use('/api/pedidos/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// --- CORS ---
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const originsEnv = process.env.ALLOWED_ORIGINS || '';
    const configuredOrigins = originsEnv
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    const allowedList = configuredOrigins.length > 0
      ? configuredOrigins
      : ['http://localhost:5173', 'http://localhost:3000'];

    const isAllowed =
      allowedList.includes('*') ||
      allowedList.includes(origin);

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`CORS bloqueado para el origen: ${origin}`);
      callback(new Error(`CORS: origen no permitido → ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
}));

// --- CONEXION A DB (lazy, cacheada entre invocaciones serverless) ---
app.use(async (_req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error: any) {
    console.error('Error de conexion a la DB:', error);
    res.status(503).json({
      error: 'Servicio no disponible: fallo de conexion a la base de datos',
      details: error?.message || String(error),
    });
  }
});

// --- RUTAS ---
app.use('/api/users',    userRouter);
app.use('/api/productos', productoRouter);
app.use('/api/pedidos',  orderRouter);
app.use('/api/servicios', servicioRouter);
app.use('/api/disponibilidad', disponibilidadRouter);

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
  } catch (err: any) {
    if (err.name === 'NoSuchKey') return res.status(404).json({ error: 'Archivo no encontrado' });
    console.error('Error al obtener archivo de R2:', err.message);
    res.status(500).json({ error: 'Error al obtener archivo' });
  }
});

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    api: mongoose.connection.readyState === 1 ? 'conectado' : 'desconectado',
  });
});

// --- CONTROL DE ERRORES ---
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
