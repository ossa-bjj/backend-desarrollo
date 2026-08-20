# Arturo Salas Academy — Backend

API de Arturo Salas Academy. Está construida con Express y TypeScript, persiste sus datos en MongoDB y almacena archivos e imágenes en Cloudflare R2. Se despliega como función serverless de Vercel mediante `api/index.ts`.

## Tecnologías

- Node.js + TypeScript + Express 5
- MongoDB + Mongoose
- JWT + bcryptjs
- Multer + Cloudflare R2 (`@aws-sdk/client-s3`)
- Vercel Serverless
- pnpm

## Estructura

```text
backend/
├── api/index.ts          # Entrada serverless de Vercel
├── src/
│   ├── orders/           # Pedidos
│   ├── products/         # Productos y carga de imágenes
│   ├── users/            # Usuarios, perfiles y membresías
│   └── shared/           # DB, JWT, R2 y middleware compartido
├── docs/api-endpoints.md # Referencia de rutas
├── index.ts              # App Express y servidor local
├── seed.ts               # Datos locales de ejemplo
└── vercel.json           # Reescritura hacia la función API
```

## Desarrollo local

```bash
pnpm install
cp .env.example .env
pnpm dev
```

La API queda disponible en `http://localhost:3000`; el prefijo de las rutas es `/api`.

### Variables de entorno

La aplicación valida al arrancar que estén presentes `DB_URL`, `JWT_SECRET` y todas las variables `R2_*`. Copia `.env.example` y completa:

```env
DB_URL=mongodb+srv://...
JWT_SECRET=un-secreto-largo
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=assets
R2_PUBLIC_DOMAIN=http://localhost:3000/api/media
ALLOWED_ORIGINS=http://localhost:5173
```

`PORT` es opcional y por defecto es `3000`. `ALLOWED_ORIGINS` acepta una lista separada por comas.

## Datos de prueba locales

Con una base de datos y R2 de desarrollo configurados, ejecuta:

```bash
pnpm seed
```

El seed crea, entre otros, estos usuarios de desarrollo:

| Usuario | Contraseña | Rol |
| --- | --- | --- |
| `admin` | `Admin1234!` | administrador |
| `cliente_regular` | `Cliente1234!` | usuario |

Estas credenciales son exclusivamente datos de prueba locales; no deben reutilizarse en producción.

## Comandos

```bash
pnpm dev            # Servidor local con recarga
pnpm build          # Compila TypeScript a dist/
pnpm start          # Ejecuta el resultado compilado
pnpm seed           # Carga datos de ejemplo
npx tsc --noEmit    # Verificación de tipos
```

Usa `pnpm` para mantener el lockfile del repositorio.

## Despliegue en Vercel

Vercel carga `api/index.ts`, que reexporta la aplicación Express de `index.ts`. `vercel.json` reescribe las solicitudes hacia esa función. Configura en el proyecto de Vercel las mismas variables obligatorias de producción (`DB_URL`, `JWT_SECRET` y `R2_*`) y define `ALLOWED_ORIGINS` con el origen público del frontend.

El proxy público `GET /api/media/*key` recupera los objetos de R2. Consulta [docs/api-endpoints.md](docs/api-endpoints.md) para las rutas disponibles y sus requisitos de autenticación.
