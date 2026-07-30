import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import serverless from 'serverless-http';
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
        res.status(503).json({ error: 'Servicio no disponible: fallo de conexion a la base de datos' });
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
const handler = serverless(app);
export default {
    async fetch(request, env, ctx) {
        if (env && typeof env === 'object') {
            Object.assign(process.env, env);
        }
        return handler(request, env);
    }
};
