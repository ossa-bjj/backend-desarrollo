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
        if (!origin)
            return callback(null, true);
        const originsEnv = process.env.ALLOWED_ORIGINS || '';
        const configuredOrigins = originsEnv
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean);
        const allowedList = configuredOrigins.length > 0
            ? configuredOrigins
            : ['http://localhost:5173', 'http://localhost:3000'];
        const isAllowed = allowedList.includes('*') ||
            allowedList.includes(origin) ||
            origin.endsWith('.pages.dev') ||
            origin.endsWith('.workers.dev');
        if (isAllowed) {
            callback(null, true);
        }
        else {
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
    }
    catch (error) {
        console.error('Error de conexion a la DB:', error);
        res.status(503).json({
            error: 'Servicio no disponible: fallo de conexion a la base de datos',
            details: error?.message || String(error),
        });
    }
});
// --- RUTAS ---
app.use('/api/users', userRouter);
app.use('/api/productos', productoRouter);
app.use('/api/pedidos', orderRouter);
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
app.use((err, _req, res, _next) => {
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
async function handleFetch(expressApp, request) {
    const url = new URL(request.url);
    const reqStream = new Readable();
    reqStream._read = () => { };
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
    return new Promise((resolve, reject) => {
        const resHeaders = new Headers();
        let statusCode = 200;
        const chunks = [];
        const resStream = new EventEmitter();
        resStream.headersSent = false;
        resStream.statusCode = 200;
        resStream.setHeader = (name, value) => {
            if (Array.isArray(value)) {
                value.forEach((v) => resHeaders.append(name, String(v)));
            }
            else {
                resHeaders.set(name, String(value));
            }
        };
        resStream.getHeader = (name) => resHeaders.get(name);
        resStream.removeHeader = (name) => resHeaders.delete(name);
        resStream.writeHead = (code, headers) => {
            statusCode = code;
            if (headers) {
                Object.entries(headers).forEach(([k, v]) => {
                    if (Array.isArray(v)) {
                        v.forEach((val) => resHeaders.append(k, String(val)));
                    }
                    else {
                        resHeaders.set(k, String(v));
                    }
                });
            }
            resStream.headersSent = true;
        };
        resStream.write = (chunk) => {
            if (chunk) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            return true;
        };
        resStream.end = (chunk) => {
            if (chunk) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            if (resStream.statusCode)
                statusCode = resStream.statusCode;
            const responseBody = Buffer.concat(chunks);
            resolve(new Response(responseBody, {
                status: statusCode,
                headers: resHeaders,
            }));
        };
        resStream.on = (_event, _listener) => { };
        try {
            expressApp(reqStream, resStream);
        }
        catch (err) {
            reject(err);
        }
    });
}
export default {
    async fetch(request, env) {
        try {
            if (env && typeof env === 'object') {
                Object.assign(process.env, env);
            }
            return await handleFetch(app, request);
        }
        catch (err) {
            console.error('Error no capturado en Cloudflare Worker:', err);
            return new Response(JSON.stringify({
                error: 'Error interno en Cloudflare Worker',
                message: err?.message || String(err),
                stack: err?.stack || null,
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    },
};
