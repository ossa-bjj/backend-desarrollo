# Arturo Salas Academy — Backend

API de Arturo Salas Academy. Está construida con Express y TypeScript, persiste sus datos en MongoDB, almacena archivos e imágenes en Cloudflare R2 y cobra con Stripe. Se despliega como función serverless de Vercel mediante `api/index.ts`.

## Tecnologías

- Node.js + TypeScript + Express 5
- MongoDB + Mongoose
- JWT + bcryptjs
- Multer + Cloudflare R2 (`@aws-sdk/client-s3`)
- Stripe (PaymentIntent + webhook)
- Vercel Serverless
- pnpm

## Estructura

```text
backend/
├── api/index.ts          # Entrada serverless de Vercel
├── src/
│   ├── availability/     # Huecos reservables y retención de horarios
│   ├── orders/           # Pedidos y confirmación de presupuestos
│   ├── payments/         # Stripe: PaymentIntent y webhook
│   ├── products/         # Productos y carga de imágenes
│   ├── services/         # Servicios vendibles (códigos 60XX)
│   ├── users/            # Usuarios, perfiles y membresías
│   └── shared/           # DB, JWT, R2 y middleware compartido
├── docs/api-endpoints.md # Referencia de rutas
├── index.ts              # App Express y servidor local
├── seed.ts               # Datos locales de ejemplo
└── vercel.json           # Reescritura hacia la función API
```

## Convenciones

Estas dos reglas se decidieron al unificar el código; respétalas al añadir un módulo o un endpoint.

### Forma de la respuesta

Todos los endpoints responden con el mismo envoltorio. No hay excepciones salvo el webhook de Stripe, que devuelve `{ received: true }` porque el formato lo impone Stripe.

```jsonc
// Devuelve un recurso o una colección
{ "success": true, "data": { } }

// Solo confirma una operación (borrados, cambios de contraseña)
{ "success": true, "message": "Producto eliminado" }

// Error, en cualquier código 4xx o 5xx
{ "error": "Producto no encontrado" }
```

Gracias a esto el frontend tiene un único parser (`readData` en `apiClient.ts`). Romper el envoltorio en un endpoint obliga a añadir un caso especial allí, así que no lo hagas.

### Idioma de los identificadores

**El idioma de un módulo sigue al de su modelo de dominio.** No se mezclan dentro de un mismo fichero.

| Módulo | Modelo | Identificadores |
| --- | --- | --- |
| `products/`, `services/`, `availability/` | `ProductoModelo`, `ServicioModelo`, `DisponibilidadModelo` | Castellano: `crearProducto`, `actualizarServicio`, `eliminarDisponibilidad` |
| `orders/`, `users/` | `Order`, `User` | Inglés: `createOrder`, `updateUser`, `addAddress` |

Única excepción admitida: el prefijo `get` en los lectores (`getProductos`, `getServicios`, `getDisponibilidad`), que ya era universal en el proyecto.

Los nombres de campo persistidos y las rutas HTTP **no** siguen esta regla: son contrato con el frontend y con la base de datos, y se quedan como están.

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
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

`PORT` es opcional y por defecto es `3000`. `ALLOWED_ORIGINS` acepta una lista separada por comas.

Las dos variables `STRIPE_*` no se validan al arrancar: el cliente de Stripe se crea bajo
demanda, así que el servidor y el seed funcionan sin ellas. Lo que falla, con un mensaje
explícito, es cualquier intento de cobrar.

## Pasarela de pago

En local, el webhook necesita que la CLI de Stripe reenvíe los eventos a tu máquina:

```bash
stripe listen --forward-to localhost:3000/api/pedidos/webhook
```

Ese comando imprime el `whsec_` de la sesión, que es el valor de `STRIPE_WEBHOOK_SECRET`.
Sin él los eventos nunca llegan y los pedidos se quedan sin marcar como pagados aunque
Stripe acepte la tarjeta. Para las pruebas, la tarjeta `4242 4242 4242 4242` con cualquier
fecha futura y cualquier CVC.

En producción el endpoint se da de alta en el panel de Stripe apuntando a
`https://<dominio>/api/pedidos/webhook`. **El `whsec_` de producción es distinto del que
imprime `stripe listen`**; copiar el de la CLI hace que la verificación de firma falle en
silencio.

La clave **secreta** vive solo aquí. El frontend usa únicamente la publicable
(`pk_`), porque Vite incrusta sus variables en el bundle que descarga el navegador.

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
