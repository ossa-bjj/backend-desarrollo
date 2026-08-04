import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import connectDB from './src/shared/db';
import userRouter from './src/users/auth.routes';
import productoRouter from './src/products/producto.routes';
import orderRouter from './src/orders/order.routes';

const app = express();

// --- MIDDLEWARES ---
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
      allowedList.includes(origin) ||
      origin.endsWith('.pages.dev') ||
      origin.endsWith('.workers.dev');

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

// --- SERVIDOR (solo en local) ---
const PORT = Number(process.env.PORT) || 3000;

if (typeof module !== 'undefined' && typeof require !== 'undefined' && require.main === module) {
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

// --- ADAPTADOR FETCH API -> EXPRESS PARA CLOUDFLARE WORKERS ---
async function handleFetch(expressApp: express.Express, request: Request): Promise<Response> {
  const url = new URL(request.url);

  const reqStream = new Readable() as any;
  reqStream._read = () => {};

  reqStream.method = request.method;
  reqStream.url = url.pathname + url.search;
  reqStream.headers = {};
  request.headers.forEach((value, key) => {
    reqStream.headers[key.toLowerCase()] = value;
  });
  reqStream.rawHeaders = Array.from(request.headers.entries()).flat();
  reqStream.socket = new EventEmitter();

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const bodyBuffer = Buffer.from(await request.arrayBuffer());
    reqStream.push(bodyBuffer);
  }
  reqStream.push(null);

  return new Promise<Response>((resolve, reject) => {
    const resHeaders = new Headers();
    let statusCode = 200;
    const chunks: Buffer[] = [];

    const resStream = new EventEmitter() as any;
    resStream.headersSent = false;
    resStream.statusCode = 200;

    resStream.setHeader = (name: string, value: any) => {
      if (Array.isArray(value)) {
        value.forEach((v) => resHeaders.append(name, String(v)));
      } else {
        resHeaders.set(name, String(value));
      }
    };

    resStream.getHeader = (name: string) => resHeaders.get(name);
    resStream.removeHeader = (name: string) => resHeaders.delete(name);

    resStream.writeHead = (code: number, headers?: any) => {
      statusCode = code;
      if (headers) {
        Object.entries(headers).forEach(([k, v]) => {
          if (Array.isArray(v)) {
            v.forEach((val) => resHeaders.append(k, String(val)));
          } else {
            resHeaders.set(k, String(v));
          }
        });
      }
      resStream.headersSent = true;
    };

    resStream.write = (chunk: any) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return true;
    };

    resStream.end = (chunk?: any) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (resStream.statusCode) statusCode = resStream.statusCode;
      const responseBody = Buffer.concat(chunks);
      resolve(
        new Response(responseBody, {
          status: statusCode,
          headers: resHeaders,
        }),
      );
    };

    resStream.on = (_event: string, _listener: any) => {};

    try {
      expressApp(reqStream, resStream);
    } catch (err) {
      reject(err);
    }
  });
}

export { app };
export default app;

