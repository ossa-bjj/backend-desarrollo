# Endpoints de la API

Prefijo base: `/api`. Las rutas protegidas requieren `Authorization: Bearer <token>`; las marcadas como **admin** requieren además rol de administrador. Todas las rutas descritas provienen de los routers actuales.

**Forma de la respuesta.** Toda respuesta correcta llega envuelta: `{ success: true, data }` cuando devuelve un recurso o una colección, `{ success: true, message }` cuando solo confirma la operación. Los errores responden `{ error }` en cualquier código 4xx o 5xx. La única excepción es `POST /pedidos/webhook`, cuyo `{ received: true }` lo impone Stripe.

**Errores.** Un fallo no previsto responde `500 { error }` con un mensaje genérico. El detalle se registra en el servidor y no viaja al cliente: los mensajes de Mongoose nombran colecciones, campos e índices, y eso es un mapa gratis de la aplicación.

Un cuerpo mal formado o demasiado grande no llega a ningún controlador: lo rechaza `express.json()` y el manejador de errores conserva **su** código (`400`, `413`) en vez de convertirlo en un `500`. Un fallo del cliente no debe mandar a buscar la avería en el servidor.

**Listados paginados.** `GET /productos`, `GET /users` y `GET /pedidos` añaden `meta: { total, pagina, limite }`. `data` es la página; `total` cuenta todo lo que cumple el filtro. Ambos aceptan `?pagina=` (desde 1) y `?limite=` (100 por defecto, 500 como máximo); un valor ilegible cae al valor por defecto en lugar de dar error. **Todo el filtrado se resuelve en el servidor**: el cliente envía criterios y pinta lo que recibe, sin recortarlo.

## Estado y medios

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| GET | `/` | Público | Estado de la API y de la conexión a MongoDB. |
| GET | `/media/*key` | Público | Recupera un archivo almacenado en Cloudflare R2. |

## Usuarios (`/users`)

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| POST | `/register` | Público | Registra un usuario. |
| POST | `/login` | Público | Inicia sesión y obtiene token. Devuelve `403` si la cuenta está bloqueada y `429` con `Retry-After` tras 5 intentos fallidos. El freno cuenta dos claves a la vez, usuario e IP, y se guarda en Mongo con caducidad automática: en serverless un contador en memoria no cuenta nada. |
| POST | `/forgot-password` | Público | Inicia la recuperación de contraseña. Envía al correo un enlace a `<origen>/recuperar?token=`, válido una hora; el origen sale de la cabecera `Origin` validada contra `ALLOWED_ORIGINS`. Responde siempre lo mismo exista o no el correo, para no convertirse en un censo de usuarios. Sin `RESEND_API_KEY` el correo no sale y queda avisado en el log. |
| POST | `/reset-password` | Público | Restablece una contraseña con el flujo de recuperación. |
| GET | `/me` | Autenticado | Devuelve el usuario de la sesión. |
| POST | `/` | Admin | Crea un usuario. |
| GET | `/` | Admin | Lista personas. Filtros combinables: `?q=` (usuario, email, nombre o apellido), `?username=`, `?email=`, `?role=`, `?status=`, `?customer=true\|false`, `?license=`. Sin filtros devuelve la primera página de todas. Orden: `?orden=` (`nombre`, `username`, `email`, `role`, `status`, `cliente`, `licencia`, `alta`) y `?direccion=asc\|desc`; por defecto `nombre` ascendente. `role` y `status` fuera de su enumeración devuelven `400`; una columna de orden desconocida cae al orden por defecto. |
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

Los dos primeros dígitos del `codigoArticulo` declaran la categoría: `10` ropa de
entrenamiento, `20` protecciones, `30` ropa de calle, `40` accesorios, `50` calzado. El rango
`6000`–`6999` pertenece a los servicios. El servidor hace cumplir la correspondencia entre
código y categoría al crear y al actualizar.

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| GET | `/` | Público | Lista productos. Filtros combinables: `?categoria=`, `?codigo=` (fragmento, 1 a 4 dígitos), `?nombre=`, `?marca=`, `?q=` (texto completo), `?destacado=true\|false`. Sin filtros devuelve la primera página del catálogo. Una categoría o un código no válidos devuelven `400`. |
| GET | `/siguiente-codigo` | Admin | `?categoria=`. Primer código libre de la serie. `409` si los cien códigos de la categoría están ocupados. |
| GET | `/:codigoArticulo` | Público | Obtiene un producto por código de artículo. |
| POST | `/` | Admin | Crea un producto. `400` si el código no cuadra con el prefijo de su categoría. |
| PUT | `/:codigoArticulo` | Admin | Actualiza un producto. El código no se reasigna, así que cambiar `category` a una que no case con el código devuelve `400`. |
| PATCH | `/:codigoArticulo/stock` | Admin | Actualiza el stock. |
| POST | `/:codigoArticulo/imagenes` | Admin | Sube hasta diez archivos en el campo multipart `imagenes`. |
| DELETE | `/:codigoArticulo/imagenes` | Admin | Elimina una imagen del producto. |
| DELETE | `/:codigoArticulo` | Admin | Elimina un producto. |

## Pedidos (`/pedidos`)

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| GET | `/` | Autenticado | Lista pedidos, más recientes primero. Filtros: `?status=`, `?desde=`/`?hasta=` (`YYYY-MM-DD`, ambos inclusive) y, **solo para un admin**, `?usuario=`. A quien no es admin el servidor le impone su propia identidad como dueño, así que `?usuario=` no sirve para leer pedidos ajenos. Paginado (50 por defecto, 200 máximo). |
| POST | `/` | Autenticado | Crea un pedido. El cuerpo solo lleva `items: [{ codigoArticulo, quantity, slotId?, slotLabel? }]` y `shippingAddress?`: nombre, precio y total se resuelven en el servidor contra el catálogo. |
| GET | `/:id` | Autenticado | Obtiene un pedido por identificador. |
| PATCH | `/:id/confirmar` | Admin | Cierra el presupuesto. Cuerpo: `ajustes: [{ codigoArticulo, slotOriginalId?, price?, quantity?, motivoAjuste?, slotId?, slotLabel? }]`. Recalcula y congela el total, y deja el pedido pagable. **O se aplica entera o no se aplica nada**: valida todos los ajustes antes de escribir, y si un cambio de horario falla a mitad (`409`, otro cliente se quedó el hueco) devuelve los ya movidos a su sitio. |
| PATCH | `/:id/rechazar` | Admin | Rechaza un pedido pendiente de confirmación. Cuerpo: `motivo`. Libera los horarios retenidos. |
| PATCH | `/:id/status` | Admin | Cambia el estado de un pedido. |
| DELETE | `/:id` | Admin | Elimina un pedido y libera sus horarios. |

### Estados de un pedido

```
pendiente_confirmacion  →  el pedido lleva un servicio que un admin debe tarificar
pendiente               →  confirmado y pagable; el total ya es definitivo
pagado                  →  cobro confirmado por el webhook (Stripe, Bizum) o por la
                           captura (PayPal)
preparando → enviado → entregado
cancelado / rechazado   →  liberan los horarios retenidos
```

Un pedido nace en `pendiente_confirmacion` si alguna de sus líneas es un servicio con
`requiereConfirmacion`. En caso contrario nace en `pendiente` y se puede pagar de inmediato.
`pendiente_confirmacion`, `cancelado` y `rechazado` no admiten cobro.

La identidad de una línea es **código de artículo más horario**: un pedido puede llevar dos
sesiones del mismo servicio a horas distintas.

## Pagos (`/pedidos`)

Tres métodos, dos caminos. `stripe` (tarjeta) y `bizum` se cobran con Stripe y los cierra
su webhook; `paypal` se cobra fuera del sitio y lo cierra la captura. Bizum no es una
pasarela aparte: es un método de Stripe, y hay que activarlo en su panel.

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| POST | `/:id/pago/iniciar` | Autenticado | Arranca el cobro sobre el total confirmado. Cuerpo: `metodo` (`stripe` · `bizum` · `paypal`) y `returnUrl` (obligatoria en `paypal`). Con Stripe y Bizum crea o reutiliza el PaymentIntent y devuelve `{ proveedor, clientSecret, orderId }`; con PayPal crea la orden y devuelve `{ proveedor, approveUrl, orderId }`. Rechaza los pedidos ya pagados o en estado no pagable. |
| POST | `/:id/pago/capturar` | Autenticado | Cierra un pago de PayPal cuando el cliente vuelve de aprobarlo. Devuelve el pedido. `409` si el pedido no tiene un pago de PayPal pendiente o si PayPal no completó el cobro. Sobre un pedido ya pagado responde `200` sin volver a cobrar. |
| POST | `/webhook` | Público | Recibe los eventos de Stripe. Lo autentica la firma `stripe-signature`, no un token. |
| POST | `/webhook/paypal` | Público | Recibe los eventos de PayPal, suscrito a `CHECKOUT.ORDER.APPROVED`. Cierra el pago del cliente que aprueba y **no vuelve al sitio**. |

**`returnUrl` se valida contra `ALLOWED_ORIGINS`**, la misma lista que gobierna CORS: la
manda el navegador, y sin esa comprobación el endpoint serviría para mandar a un cliente a
un dominio ajeno con aspecto de vuelta del pago.

El pedido pasa a `pagado` en un único punto del código, venga el aviso del webhook de
Stripe o de la captura de PayPal: ahí se consolidan los horarios reservados y se descuenta
el stock de las líneas de producto. Es idempotente por los dos lados — Stripe reintenta
hasta recibir un 2xx, y el cliente puede recargar la página de retorno de PayPal.

Un intento de Stripe solo se reutiliza si se creó **para el mismo método**: uno de Bizum no
admite tarjeta, y al revés tampoco.

Un pago de PayPal se puede cerrar por dos caminos —la vuelta del cliente y el webhook—, y
pueden llegar los dos, en cualquier orden. Da igual: ambos desembocan en la misma función,
que corta en seco si el pedido ya está pagado, y la captura viaja con un `PayPal-Request-Id`
fijo que hace que PayPal devuelva la que ya hizo en vez de repetirla.

Los dos webhooks se autentican distinto, y por eso quieren el cuerpo distinto:

- **Stripe** firma con un secreto compartido y necesita los bytes **sin parsear**. De ahí el
  `express.raw` sobre esa ruta antes de `express.json()` en `index.ts`, montado con `post`
  y no con `use` — `use` casa por prefijo y le habría robado el cuerpo al de PayPal.
- **PayPal** no firma con un secreto: hay que preguntarle a él si la firma es buena,
  mandándole las cabeceras `paypal-*` junto al evento. Ese cuerpo sí llega parseado.
  Sin `PAYPAL_WEBHOOK_ID` no hay forma de verificar nada, así que el aviso **se rechaza**:
  falla cerrado, nunca abierto.

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

## Noticias (`/noticias`)

Una noticia nace siempre como **borrador**: `publicada` es `false` y no aparece en el
listado público hasta que un admin la publica explícitamente.

Cada cambio deja una entrada en `historial` con la acción, el autor y una foto del
título, el contenido y el estado en ese momento. Es un registro de auditoría: se
añade, nunca se edita.

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| GET | `/` | Público | Lista las noticias publicadas, más recientes primero. Filtros: `?categoria=` y `?q=`. |
| GET | `/admin/all` | Admin | Lista todas las noticias, borradores incluidos. |
| POST | `/` | Admin | Crea una noticia como borrador. |
| PUT | `/:id` | Admin | Actualiza una noticia. Solo cambia los campos enviados. |
| PATCH | `/:id/publicar` | Admin | Alterna entre publicada y borrador. |
| DELETE | `/:id` | Admin | Elimina la noticia, su historial y su portada del bucket. |

### La portada se copia, no se enlaza

`imagenPortada` admite dos cosas: el enlace directo a una imagen, o el de la **página** que la
contiene —el post de Instagram, por ejemplo—, de la que se lee su `og:image`. En ambos casos
la imagen **se descarga y se guarda en R2** al crear o actualizar, y en la base queda la key
del bucket, no el enlace de origen.

No es un capricho: la URL del CDN que hay detrás de un post de Instagram viene firmada y
**caduca en unos días**, así que una portada enlazada se rompería sola. Y la URL de la página
(`instagram.com/p/…`) no es una imagen en absoluto: era lo que dejaba la noticia sin portada
sin avisar de nada.

Si el enlace no lleva a ninguna imagen, la petición responde **`400` con el motivo** en vez de
guardar una noticia con una portada que no se ve. Lo que ya está en el bucket no se vuelve a
copiar, así que reeditar una noticia no duplica su imagen.

**El servidor sale a la red a por esa URL**, de modo que se rechazan los destinos que no sean
`http`/`https` y los que apunten a `localhost`, a IPs privadas o al rango de metadatos
`169.254.x`: sin ese filtro, el campo sería una ventana a la red interna del despliegue.
Límites: 8 MB de imagen, 4 MB de HTML y 15 s de espera.

Categorías admitidas: `EVENTO`, `RESULTADO`, `CLUB`, `PROMOCION`, `GENERAL`. Cualquier
otra devuelve `400`.

Los campos de evento (`fechaEvento`, `horaInicio`, `horaFin`, `lugar`) son opcionales y
solo tienen sentido en la categoría `EVENTO`. Las horas van en formato `HH:MM` de 24
horas y son hora local de la academia, nunca un instante absoluto.

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
