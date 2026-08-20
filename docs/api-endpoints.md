# Endpoints de la API

Prefijo base: `/api`. Las rutas protegidas requieren `Authorization: Bearer <token>`; las marcadas como **admin** requieren además rol de administrador. Todas las rutas descritas provienen de los routers actuales.

## Estado y medios

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| GET | `/` | Público | Estado de la API y de la conexión a MongoDB. |
| GET | `/media/*key` | Público | Recupera un archivo almacenado en Cloudflare R2. |

## Usuarios (`/users`)

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| POST | `/register` | Público | Registra un usuario. |
| POST | `/login` | Público | Inicia sesión y obtiene token. |
| POST | `/forgot-password` | Público | Inicia la recuperación de contraseña. |
| POST | `/reset-password` | Público | Restablece una contraseña con el flujo de recuperación. |
| GET | `/me` | Autenticado | Devuelve el usuario de la sesión. |
| POST | `/` | Admin | Crea un usuario. |
| GET | `/` | Admin | Lista usuarios. |
| GET | `/:id` | Admin | Obtiene un usuario por identificador. |
| PUT | `/:id` | Autenticado | Actualiza un usuario. |
| PATCH | `/:id/password` | Autenticado | Cambia la contraseña. |
| PATCH | `/:id/status` | Admin | Cambia el estado del usuario. |
| PATCH | `/:id/customer` | Admin | Actualiza datos de cliente. |
| PATCH | `/:id/sports-profile` | Admin | Actualiza el perfil deportivo. |
| DELETE | `/:id/sports-profile` | Admin | Elimina el perfil deportivo. |
| PATCH | `/:id/membership` | Admin | Actualiza la membresía. |
| POST | `/:id/addresses` | Autenticado | Añade una dirección. |
| PATCH | `/:id/addresses/:addressId` | Autenticado | Actualiza una dirección. |
| DELETE | `/:id/addresses/:addressId` | Autenticado | Elimina una dirección. |
| GET | `/:id/membership-payments` | Admin | Lista pagos de membresía. |
| POST | `/:id/membership-payments` | Admin | Registra un pago de membresía. |
| PATCH | `/:id/membership-payments/:paymentId` | Admin | Actualiza un pago de membresía. |
| DELETE | `/:id/membership-payments/:paymentId` | Admin | Elimina un pago de membresía. |
| DELETE | `/:id` | Admin | Elimina un usuario. |

## Productos (`/productos`)

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| GET | `/` | Público | Lista productos. |
| GET | `/search` | Público | Busca productos. |
| GET | `/destacados` | Público | Lista productos destacados. |
| GET | `/categoria/:categoria` | Público | Lista productos de una categoría. |
| GET | `/marca/:marca` | Público | Lista productos de una marca. |
| GET | `/:codigoArticulo` | Público | Obtiene un producto por código de artículo. |
| POST | `/` | Admin | Crea un producto. |
| PUT | `/:codigoArticulo` | Admin | Actualiza un producto. |
| PATCH | `/:codigoArticulo/stock` | Admin | Actualiza el stock. |
| POST | `/:codigoArticulo/imagenes` | Admin | Sube hasta diez archivos en el campo multipart `imagenes`. |
| DELETE | `/:codigoArticulo/imagenes` | Admin | Elimina una imagen del producto. |
| DELETE | `/:codigoArticulo` | Admin | Elimina un producto. |

## Pedidos (`/pedidos`)

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| GET | `/` | Autenticado | Lista pedidos según el usuario autenticado. Un admin ve todos. |
| POST | `/` | Autenticado | Crea un pedido. El cuerpo solo lleva `items: [{ codigoArticulo, quantity, slotId?, slotLabel? }]` y `shippingAddress?`: nombre, precio y total se resuelven en el servidor contra el catálogo. |
| GET | `/:id` | Autenticado | Obtiene un pedido por identificador. |
| PATCH | `/:id/confirmar` | Admin | Cierra el presupuesto. Cuerpo: `ajustes: [{ codigoArticulo, slotOriginalId?, price?, quantity?, motivoAjuste?, slotId?, slotLabel? }]`. Recalcula y congela el total, y deja el pedido pagable. |
| PATCH | `/:id/rechazar` | Admin | Rechaza un pedido pendiente de confirmación. Cuerpo: `motivo`. Libera los horarios retenidos. |
| PATCH | `/:id/status` | Admin | Cambia el estado de un pedido. |
| DELETE | `/:id` | Admin | Elimina un pedido y libera sus horarios. |

### Estados de un pedido

```
pendiente_confirmacion  →  el pedido lleva un servicio que un admin debe tarificar
pendiente               →  confirmado y pagable; el total ya es definitivo
pagado                  →  cobro confirmado por el webhook de Stripe
preparando → enviado → entregado
cancelado / rechazado   →  liberan los horarios retenidos
```

Un pedido nace en `pendiente_confirmacion` si alguna de sus líneas es un servicio con
`requiereConfirmacion`. En caso contrario nace en `pendiente` y se puede pagar de inmediato.
`pendiente_confirmacion`, `cancelado` y `rechazado` no admiten cobro.

La identidad de una línea es **código de artículo más horario**: un pedido puede llevar dos
sesiones del mismo servicio a horas distintas.

## Pagos (`/pedidos`)

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| POST | `/:id/pago/iniciar` | Autenticado | Crea o reutiliza el PaymentIntent de Stripe sobre el total confirmado. Cuerpo: `metodo` (solo `stripe`). Devuelve `{ proveedor, clientSecret, orderId }`. Rechaza los pedidos ya pagados o en estado no pagable. |
| POST | `/webhook` | Público | Recibe los eventos de Stripe. Lo autentica la firma `stripe-signature`, no un token. |

El webhook es la única fuente de verdad del cobro: al recibir `payment_intent.succeeded`
marca el pedido como pagado, consolida los horarios reservados y descuenta el stock de las
líneas de producto. Es idempotente, porque Stripe reintenta hasta recibir un 2xx.

Necesita el cuerpo sin parsear, de ahí el `express.raw` montado sobre esa ruta antes de
`express.json()` en `index.ts`.

## Servicios (`/servicios`)

Los servicios comparten el espacio de `codigoArticulo` con los productos, en el rango
`6000`–`6999`.

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| GET | `/` | Público | Lista los servicios activos, ordenados por `orden` y código. |
| GET | `/search` | Público | Busca servicios activos por texto (`?q=`). |
| GET | `/admin/all` | Admin | Lista todos los servicios, incluidos los desactivados. |
| GET | `/:codigoArticulo` | Público | Obtiene un servicio por código. |
| POST | `/` | Admin | Crea un servicio. |
| PUT | `/:codigoArticulo` | Admin | Actualiza un servicio. El código no se reasigna. |
| PATCH | `/:codigoArticulo/activo` | Admin | Fija `activo`, o lo alterna si no se envía. |
| POST | `/:codigoArticulo/imagenes` | Admin | Sube hasta diez archivos en el campo multipart `imagenes`. |
| DELETE | `/:codigoArticulo/imagenes` | Admin | Elimina una imagen. Cuerpo: `url`. |
| DELETE | `/:codigoArticulo` | Admin | Elimina el servicio y sus imágenes de R2. |

Campos propios: `modalidad` (`presencial` · `online` · `mixta`), `duracion` en minutos,
`plazas` por sesión, `requiereReserva` y `requiereConfirmacion`.

## Disponibilidad (`/disponibilidad`)

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| GET | `/` | Público | `?servicio=&desde=&hasta=` en formato `YYYY-MM-DD`. Sin token devuelve solo los huecos reservables de hoy en adelante; con `?admin=true` y token de admin devuelve también ocupados, bloqueados y fechas pasadas. |
| POST | `/` | Admin | Crea un hueco suelto. |
| POST | `/batch` | Admin | Genera la parrilla. Cuerpo: `servicio`, `desde`, `hasta`, `horaInicio`, `horaFin`, `duracion?`, `diasSemana` (0 = lunes … 6 = domingo), `nota?`. Devuelve `{ creados, omitidos }`. |
| PATCH | `/:id/bloquear` | Admin | Bloquea un hueco. No se puede bloquear uno ya reservado. |
| PATCH | `/:id/desbloquear` | Admin | Devuelve un hueco bloqueado al catálogo. |
| DELETE | `/:id` | Admin | Elimina un hueco. No se puede eliminar uno ya reservado. |

La generación por lotes es idempotente: un índice único por servicio, día y hora de inicio
hace que los huecos existentes se cuenten como omitidos en vez de duplicarse.

Cada hueco tiene tres estados: `disponible`, `ocupado` y `bloqueado`. Un pedido sin confirmar
retiene su hueco durante 48 horas; pasado ese plazo vuelve al catálogo. La limpieza es
perezosa — ocurre al consultar la agenda, sin cron ni proceso de fondo. Al confirmarse el
pedido la retención deja de caducar y la ocupación pasa a ser firme.
