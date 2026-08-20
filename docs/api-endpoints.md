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
| GET | `/` | Autenticado | Lista pedidos según el usuario autenticado. |
| POST | `/` | Autenticado | Crea un pedido. |
| GET | `/:id` | Autenticado | Obtiene un pedido por identificador. |
| PATCH | `/:id/status` | Admin | Cambia el estado de un pedido. |
| DELETE | `/:id` | Admin | Elimina un pedido. |

No hay rutas de Stripe, webhooks ni inicio de pago en los routers actuales.
