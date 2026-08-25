# Arturo Salas Academy — Backend

API HTTP de la academia: tienda de productos, catálogo de servicios con reserva de
horario, pedidos con cobro por Stripe y noticias del club.

Express 5 + TypeScript sobre MongoDB, desplegado como función serverless en Vercel.
Los archivos e imágenes viven en Cloudflare R2 y se sirven por un proxy propio.

El frontend está en un repositorio aparte: [`ossa-bjj/frontend`](https://github.com/ossa-bjj/frontend).

> **La documentación completa está en
> [`docs/project_documentation.md`](docs/project_documentation.md)**: arquitectura,
> lógica de negocio, modelo de datos, despliegue y qué queda pendiente.
> La referencia de rutas, en [`docs/api-endpoints.md`](docs/api-endpoints.md).

---

## Arranque rápido

```bash
pnpm install
cp .env.example .env     # completar con valores reales
pnpm dev                 # http://localhost:3000, rutas bajo /api
```

### Variables de entorno

La aplicación **valida al arrancar** que estén `DB_URL`, `JWT_SECRET` y todas las
`R2_*`; si falta alguna, aborta con el nombre de la que falta.

```env
DB_URL=<database-url>
JWT_SECRET=<secret>
R2_ACCOUNT_ID=<account-id>
R2_ACCESS_KEY_ID=<access-key>
R2_SECRET_ACCESS_KEY=<secret-key>
R2_BUCKET_NAME=assets
R2_PUBLIC_DOMAIN=http://localhost:3000/api/media
ALLOWED_ORIGINS=http://localhost:5173
STRIPE_SECRET_KEY=<stripe-secret-key>
STRIPE_WEBHOOK_SECRET=<stripe-webhook-secret>
```

`PORT` es opcional (3000 por defecto). `ALLOWED_ORIGINS` acepta lista separada por
comas.

Las dos `STRIPE_*` **no se validan al arrancar**: el cliente de Stripe se crea bajo
demanda, así que el servidor y el seed funcionan sin ellas. Lo que falla, con un
mensaje explícito, es cualquier intento de cobrar.

Detalle de cada variable en el
[manual](docs/project_documentation.md#8-configuración).

---

## Comandos

```bash
pnpm dev            # servidor local con recarga
pnpm build          # compila a dist/
pnpm start          # ejecuta dist/index.js
pnpm seed           # datos de prueba (BORRA usuarios, productos y servicios)
npx tsc --noEmit    # comprobación de tipos
```

### Datos de prueba

`pnpm seed` inserta 5 usuarios, 25 productos y 5 servicios. **Vacía esas tres
colecciones antes**: no lo ejecutes sobre datos que importen.

| Usuario | Contraseña | Rol |
| --- | --- | --- |
| `admin` | `Admin1234!` | administrador |
| `cliente_regular` | `Cliente1234!` | usuario |

Credenciales de desarrollo local: no deben reutilizarse en producción.

---

## Pasarela de pago en local

El webhook necesita que la CLI de Stripe reenvíe los eventos a tu máquina:

```bash
stripe listen --forward-to localhost:3000/api/pedidos/webhook
```

Ese comando imprime el `whsec_` de la sesión, que es el valor de
`STRIPE_WEBHOOK_SECRET`. **Sin él los eventos nunca llegan y los pedidos se quedan sin
marcar como pagados aunque Stripe acepte la tarjeta**, porque quien los marca es el
webhook y no el navegador.

Para las pruebas, la tarjeta `4242 4242 4242 4242` con cualquier fecha futura y
cualquier CVC.

En producción el endpoint se da de alta en el panel de Stripe apuntando a
`https://<dominio>/api/pedidos/webhook`. **El `whsec_` de producción es distinto del
que imprime `stripe listen`**; copiar el de la CLI hace que la verificación de firma
falle en silencio.

La clave **secreta** vive solo aquí. El frontend usa únicamente la publicable (`pk_`),
porque Vite incrusta sus variables en el bundle que descarga el navegador.

---

## Convenciones

Toda la API responde con el mismo envoltorio:

```json
{ "success": true, "data": { } }
```

y los errores como `{ "error": "…", "detail": "…" }`. Los errores de servidor pasan
todos por `sendServerError`, y la regla de permisos (admin o dueño del recurso) está
implementada una sola vez, en `src/shared/controller.utils.ts`.

Los identificadores van en **castellano** en `products/`, `services/`, `availability/`
y `news/`; en **inglés** en `orders/` y `users/`, porque sus modelos se llaman `Order`
y `User`. Los nombres de campo de la API no cambian de idioma: son contrato con el
frontend.

Más detalle en el [manual](docs/project_documentation.md#5-lógica-de-negocio).

---

## Despliegue

Vercel. `vercel.json` reescribe todo el tráfico hacia `/api`, y `api/index.ts` es la
función que reexporta la app.

**Backend primero, frontend después**: el envoltorio `{ success, data }` es un
contrato, y el frontend nuevo contra un backend anterior rompe el login.

Procedimiento completo en el
[manual](docs/project_documentation.md#13-despliegue).
