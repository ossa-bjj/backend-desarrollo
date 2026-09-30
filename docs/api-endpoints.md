# Endpoints de la API

Prefijo base: `/api`. Las rutas protegidas requieren `Authorization: Bearer <token>`; las marcadas como **admin** requieren además rol de administrador. Todas las rutas descritas provienen de los routers actuales.

**Forma de la respuesta.** Toda respuesta correcta llega envuelta: `{ success: true, data }` cuando devuelve un recurso o una colección, `{ success: true, message }` cuando solo confirma la operación. Los errores responden `{ error }` en cualquier código 4xx o 5xx. La única excepción es `POST /pedidos/webhook`, cuyo `{ received: true }` lo impone Stripe.

**Errores.** Un fallo no previsto responde `500 { error }` con un mensaje genérico. El detalle se registra en el servidor y no viaja al cliente: los mensajes de Mongoose nombran colecciones, campos e índices, y eso es un mapa gratis de la aplicación.

Un cuerpo al que le falte un campo obligatorio, o que traiga un valor fuera de rango, es una petición mal formada y no un fallo del servidor: responde `400 { error: "Datos no validos: <campos>" }` nombrando qué hay que corregir. Vale para todos los controladores, porque la regla vive en `sendServerError`.

Un cuerpo mal formado o demasiado grande no llega a ningún controlador: lo rechaza `express.json()` y el manejador de errores conserva **su** código (`400`, `413`) en vez de convertirlo en un `500`. Un fallo del cliente no debe mandar a buscar la avería en el servidor.

**Listados paginados.** `GET /productos`, `GET /users` y `GET /pedidos` añaden `meta: { total, pagina, limite }`. `data` es la página; `total` cuenta todo lo que cumple el filtro. Ambos aceptan `?pagina=` (desde 1) y `?limite=` (100 por defecto, 500 como máximo); un valor ilegible cae al valor por defecto en lugar de dar error. **Todo el filtrado se resuelve en el servidor**: el cliente envía criterios y pinta lo que recibe, sin recortarlo.

## Estado y medios

| Método | Ruta          | Acceso  | Descripción                                      |
| ------ | ------------- | ------- | ------------------------------------------------ |
| GET    | `/`           | Público | Estado de la API y de la conexión a MongoDB.     |
| GET    | `/media/*key` | Público | Recupera un archivo almacenado en Cloudflare R2. |

## Usuarios (`/users`)

| Método | Ruta                                  | Acceso      | Descripción                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/register`                           | Público     | Registra un usuario. Además de `username`, `email` y `password` —los tres, texto— exige **`profile`**, con el nombre y los apellidos dentro; sin él responde `400 Datos no validos: profile`. **Solo admite eso**: del perfil, nombre, apellidos, teléfono y direcciones; cliente, perfil deportivo, cuota, pagos de cuota y rol se ignoran, porque los fija el admin. El `username` no puede llevar `@`: ese formato queda para las fichas de invitado, cuyo usuario es su correo. Un correo que ya es de una ficha de invitado responde el mismo `400 Usuario o email ya registrado`; esa persona crea su cuenta por `/forgot-password`. |
| POST   | `/login`                              | Público     | Inicia sesión y obtiene token. `username` y `password` tienen que ser texto (`400` si no). Devuelve `403` si la cuenta está bloqueada y `429` con `Retry-After` tras 5 intentos fallidos. El freno cuenta dos claves a la vez, usuario e IP, y se guarda en Mongo con caducidad automática: en serverless un contador en memoria no cuenta nada. Una ficha de invitado no puede entrar: responde el mismo `401` que un usuario inexistente.                                                                                                                                                                                                |
| POST   | `/forgot-password`                    | Público     | Inicia la recuperación de contraseña. Envía al correo un enlace a `<origen>/recuperar?token=`, válido una hora; el origen sale de la cabecera `Origin` validada contra `ALLOWED_ORIGINS`. Responde siempre lo mismo exista o no el correo —o aunque no sea texto—, para no convertirse en un censo de usuarios. **A una ficha de invitado le envía el correo de «Crea tu cuenta»** con el mismo tipo de enlace. El token se guarda como huella SHA-256, no tal cual. Sin `RESEND_API_KEY` el correo no sale y queda avisado en el log.                                                                                                     |
| POST   | `/reset-password`                     | Público     | Restablece una contraseña con el token del enlace (texto; cualquier otra cosa es `400`). Si la cuenta era una **ficha de invitado**, la convierte en cuenta: `role: user`, `status: activo` (salvo que el admin la hubiera bloqueado: el bloqueo se conserva), correo verificado y **sin las direcciones de la ficha**, que pudo escribir cualquiera que usara ese correo. El mensaje de la respuesta dice con qué usuario se entra.                                                                                                                                                                                                       |
| GET    | `/me`                                 | Autenticado | Devuelve el usuario de la sesión.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| POST   | `/`                                   | Admin       | Crea un usuario. No admite `role: invitado` (`400`): esas fichas solo las crea la compra sin cuenta. Mismas reglas de `username` que `/register`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| GET    | `/`                                   | Admin       | Lista personas. Filtros combinables: `?q=` (usuario, email, nombre o apellido), `?username=`, `?email=`, `?role=`, `?status=`, `?customer=true\|false`, `?license=`. Sin filtros devuelve la primera página de todas. Orden: `?orden=` (`nombre`, `username`, `email`, `role`, `status`, `cliente`, `licencia`, `alta`) y `?direccion=asc\|desc`; por defecto `nombre` ascendente. `role` y `status` fuera de su enumeración devuelven `400`; una columna de orden desconocida cae al orden por defecto.                                                                                                                                   |
| GET    | `/:id`                                | Admin       | Obtiene un usuario por identificador.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| PUT    | `/:id`                                | Autenticado | Actualiza un usuario. Nadie, ni un admin, cambia un rol **desde o hacia** `invitado` (`400`). En una ficha de invitado el usuario sigue al correo: si cambia el email, cambia el `username`. Un `username` nuevo con `@` se rechaza; conservar el que ya se tenía siempre se admite.                                                                                                                                                                                                                                                                                                                                                       |
| PATCH  | `/:id/password`                       | Autenticado | Cambia la contraseña. Sobre una ficha de invitado responde `400`, también para un admin: ponerle contraseña sería crear la cuenta de alguien sin que haya demostrado que el correo es suyo.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| PATCH  | `/:id/status`                         | Admin       | Cambia el estado del usuario.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| PATCH  | `/:id/customer`                       | Admin       | Actualiza datos de cliente.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| PATCH  | `/:id/sports-profile`                 | Admin       | Actualiza el perfil deportivo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| DELETE | `/:id/sports-profile`                 | Admin       | Elimina el perfil deportivo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| PATCH  | `/:id/membership`                     | Admin       | Actualiza la membresía.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| POST   | `/:id/addresses`                      | Autenticado | Añade una dirección.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| PATCH  | `/:id/addresses/:addressId`           | Autenticado | Actualiza una dirección.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| DELETE | `/:id/addresses/:addressId`           | Autenticado | Elimina una dirección.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| GET    | `/:id/membership-payments`            | Admin       | Lista pagos de membresía.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| POST   | `/:id/membership-payments`            | Admin       | Registra un pago de membresía.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| PATCH  | `/:id/membership-payments/:paymentId` | Admin       | Actualiza un pago de membresía.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| DELETE | `/:id/membership-payments/:paymentId` | Admin       | Elimina un pago de membresía.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| DELETE | `/:id`                                | Admin       | Elimina un usuario.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Productos (`/productos`)

Los dos primeros dígitos del `codigoArticulo` declaran la categoría: `10` ropa de
entrenamiento, `20` protecciones, `30` ropa de calle, `40` accesorios, `50` calzado. El rango
`6000`–`6999` pertenece a los servicios. El servidor hace cumplir la correspondencia entre
código y categoría al crear y al actualizar.

| Método | Ruta                                  | Acceso          | Descripción                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/`                                   | Público / Admin | Lista productos. Filtros combinables: `?categoria=`, `?codigo=` (fragmento, 1 a 4 dígitos), `?nombre=`, `?marca=`, `?q=` (texto completo), `?destacado=true\|false`. Sin sesión de admin siempre devuelve solo los activos (`activo !== false`); con sesión de admin, además, `?activo=true\|false` fija el estado exacto a listar y `?soloActivos=true` excluye los inactivos del listado (que por defecto, para el admin, los incluye). `?activo=` y `?soloActivos=` se ignoran sin sesión de admin. |
| GET    | `/siguiente-codigo`                   | Admin           | `?categoria=`. Primer código libre de la serie. `409` si los cien códigos de la categoría están ocupados.                                                                                                                                                                                                                                                                                                                                                                                              |
| GET    | `/:codigoArticulo`                    | Público / Admin | Obtiene un producto por código de artículo. Si el producto está inactivo (`activo === false`) y quien consulta no es admin, devuelve `404`.                                                                                                                                                                                                                                                                                                                                                            |
| POST   | `/`                                   | Admin           | Crea un producto (`activo` por defecto `true`). `400` si el código no cuadra con el prefijo de su categoría.                                                                                                                                                                                                                                                                                                                                                                                           |
| PUT    | `/:codigoArticulo`                    | Admin           | Actualiza un producto (permite actualizar `activo`). El código no se reasigna, así que cambiar `category` a una que no case con el código devuelve `400`.                                                                                                                                                                                                                                                                                                                                              |
| PATCH  | `/:codigoArticulo/stock`              | Admin           | Actualiza el stock por tallas.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| PATCH  | `/:codigoArticulo/activo`             | Admin           | Alterna o fija la visibilidad del producto en la tienda pública (`{ activo: boolean }`).                                                                                                                                                                                                                                                                                                                                                                                                               |
| PATCH  | `/:codigoArticulo/imagenes/principal` | Admin           | Mueve la imagen indicada (`{ url: string }`) a la posición 0 del array, convirtiéndola en la imagen principal de la tienda.                                                                                                                                                                                                                                                                                                                                                                            |
| POST   | `/:codigoArticulo/imagenes/presign`   | Admin           | Genera URLs prefirmadas PUT temporales para subida directa de blobs optimizados a Cloudflare R2. Máximo 10 archivos.                                                                                                                                                                                                                                                                                                                                                                                   |
| POST   | `/:codigoArticulo/imagenes/confirmar` | Admin           | Registra las keys de R2 subidas directamente en la lista de imágenes del producto.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| POST   | `/:codigoArticulo/imagenes`           | Admin           | Sube hasta diez archivos en el campo multipart `imagenes` (soporta fallback en caso de bloqueo directo).                                                                                                                                                                                                                                                                                                                                                                                               |
| DELETE | `/:codigoArticulo/imagenes`           | Admin           | Elimina una imagen del producto.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DELETE | `/:codigoArticulo`                    | Admin           | Elimina un producto.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Pedidos (`/pedidos`)

| Método | Ruta             | Acceso      | Descripción                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | ---------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/`              | Autenticado | Lista pedidos, más recientes primero. Filtros: `?status=`, `?desde=`/`?hasta=` (`YYYY-MM-DD`, ambos inclusive) y, **solo para un admin**, `?usuario=`. A quien no es admin el servidor le impone su propia identidad como dueño, así que `?usuario=` no sirve para leer pedidos ajenos. **A quien no es admin tampoco le salen los pedidos hechos sin cuenta**, aunque cuelguen de su ficha convertida: se abren con su clave. Paginado (50 por defecto, 200 máximo). |
| POST   | `/`              | Autenticado | Crea un pedido. El cuerpo solo lleva `items: [{ codigoArticulo, quantity, slotId?, slotLabel? }]` y `shippingAddress?`: nombre, precio y total se resuelven en el servidor contra el catálogo.                                                                                                                                                                                                                                                                        |
| GET    | `/:id`           | Autenticado | Obtiene un pedido por identificador. Un pedido hecho sin cuenta responde `404` a quien no es admin.                                                                                                                                                                                                                                                                                                                                                                   |
| PATCH  | `/:id/confirmar` | Admin       | Cierra el presupuesto. Cuerpo: `ajustes: [{ codigoArticulo, slotOriginalId?, price?, quantity?, motivoAjuste?, slotId?, slotLabel? }]`. Recalcula y congela el total, y deja el pedido pagable. **O se aplica entera o no se aplica nada**: valida todos los ajustes antes de escribir, y si un cambio de horario falla a mitad (`409`, otro cliente se quedó el hueco) devuelve los ya movidos a su sitio.                                                           |
| PATCH  | `/:id/rechazar`  | Admin       | Rechaza un pedido pendiente de confirmación. Cuerpo: `motivo`. Libera los horarios retenidos.                                                                                                                                                                                                                                                                                                                                                                         |
| PATCH  | `/:id/status`    | Admin       | Cambia el estado de un pedido.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| DELETE | `/:id`           | Admin       | Elimina un pedido y libera sus horarios.                                                                                                                                                                                                                                                                                                                                                                                                                              |

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

## Compra sin cuenta (`/pedidos/invitado`)

Quien no tiene sesión compra dejando sus datos. Rutas **públicas**: no hay token, así que lo
que demuestra que un pedido es tuyo es una **clave** aleatoria que el servidor entrega una sola
vez, al crearlo, y que después viaja en la cabecera **`X-Clave-Pedido`**. El pedido guarda solo
su huella SHA-256. Ninguna de estas rutas responde `401`: el frontend reserva ese código para
cerrar una sesión caducada.

| Método | Ruta                          | Acceso  | Descripción                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/invitado`                   | Público | Crea el pedido. Cuerpo: `invitado: { firstName, lastName, email, phone }` (todos obligatorios), `items` como en `POST /pedidos` y `shippingAddress` completa si hay algún producto (un servicio no la necesita). Devuelve `201 { pedido, claveAcceso }`. `400` por datos que faltan o sobran de largo, o si el carrito lleva un servicio con presupuesto (`requiereConfirmacion`: necesita cuenta). `409` si el correo es de una cuenta de verdad o si otro se llevó el horario. `403` si la ficha de ese correo está bloqueada. `429` con `Retry-After` pasados 10 pedidos por IP y hora. |
| GET    | `/invitado/:id`               | Clave   | Devuelve el pedido, sin la huella. Sin clave, con una ajena o sobre un pedido con cuenta responde `404`: esta puerta no confirma qué ids existen.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| POST   | `/invitado/:id/pago/iniciar`  | Clave   | Igual que `POST /:id/pago/iniciar`, con la clave en lugar del token. `429` con `Retry-After` pasados 30 arranques por IP y hora.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| POST   | `/invitado/:id/pago/capturar` | Clave   | Igual que `POST /:id/pago/capturar`, con la clave en lugar del token.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/invitado/:id/cancelar`      | Clave   | Cancela el pedido **sin pagar** y suelta sus horarios; si tenía un intento de Stripe vivo, lo cancela también. Es idempotente. `409` si el pedido ya está pagado o su pago está en marcha (un Bizum pendiente de su banco): eso se cancela desde el panel, que devuelve el dinero. Lo usa el frontend cuando el cliente cambia el carrito o sus datos después de crear el pedido, o entra con su cuenta a mitad.                                                                                                                                                                           |

**La ficha del invitado.** El pedido queda a nombre de un `User` con `role: invitado`: una
ficha por correo, con el correo como `username` y **sin contraseña**. No puede iniciar sesión.
La primera compra la crea con el nombre, los apellidos y el teléfono; las siguientes con el
mismo correo **la reutilizan sin sobrescribirla** —quien conoce un correo puede comprar con
él, pero no cambiar los datos de esa persona— y solo le añaden la dirección si es nueva, hasta
cinco. Por eso el pedido guarda además su propia copia del contacto (`invitado`) y del envío:
es la que vale para ese pedido. Al pagarse, la ficha pasa a `customer.isCustomer: true`.

**Un correo de una cuenta de verdad no se usa como invitado**: su dueño vería los datos de
quien se equivocara al escribirlo.

**Convertir la ficha en cuenta** pasa por el correo: `/users/forgot-password` le manda un
enlace de «Crea tu cuenta» y `/users/reset-password` la convierte. Abrir ese enlace es lo
primero que demuestra que el correo es suyo, así que la cuenta nace sin las direcciones de la
ficha, y **los pedidos hechos sin cuenta no pasan a verse con la sesión**: se siguen abriendo
con su clave.

**Horarios.** Un pedido de invitado retiene sus horarios **una hora**, no 48: la ruta es
pública, y con 48 horas bastaría rotar correos para bloquear la agenda sin pagar. Arrancar el
cobro renueva esa hora, pero **nunca más allá de tres horas desde el alta**: sin ese tope,
llamar a «iniciar pago» cada cincuenta minutos mantendría el hueco bloqueado para siempre.

## Pagos (`/pedidos`)

Tres métodos, dos caminos. `stripe` (tarjeta) y `bizum` se cobran con Stripe y los cierra
su webhook; `paypal` se cobra fuera del sitio y lo cierra la captura. Bizum no es una
pasarela aparte: es un método de Stripe, y hay que activarlo en su panel.

| Método | Ruta                 | Acceso      | Descripción                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | -------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/:id/pago/iniciar`  | Autenticado | Arranca el cobro sobre el total confirmado. Cuerpo: `metodo` (`stripe` · `bizum` · `paypal`) y `returnUrl` (obligatoria en `paypal`). Con Stripe y Bizum crea o reutiliza el PaymentIntent y devuelve `{ proveedor, clientSecret, orderId }`; con PayPal crea la orden y devuelve `{ proveedor, approveUrl, orderId }`. Rechaza los pedidos ya pagados o en estado no pagable. Valida método y `returnUrl` **antes** de tocar nada. Después **asegura los horarios**: renueva la retención de los que siguen siendo del pedido, recupera los que se soltaron y siguen libres —sin pasar del tope del pedido: 48 horas desde el alta con cuenta, 3 sin ella— y responde `409` si alguno lo tiene ya otro pedido o se agotó el plazo. Un pedido hecho sin cuenta responde `404` a quien no es admin: se cobra por la ruta de invitado. |
| POST   | `/:id/pago/capturar` | Autenticado | Cierra un pago de PayPal cuando el cliente vuelve de aprobarlo. Devuelve el pedido. `409` si el pedido no tiene un pago de PayPal pendiente, si PayPal no completó el cobro, si el pedido ya no es pagable (cancelado, rechazado) o si **su horario ya no es suyo**: la aprobación puede llegar mucho después de arrancar el cobro, y entonces no se captura —la orden de PayPal caduca sola sin cobrar—. Sobre un pedido ya pagado responde `200` sin volver a cobrar. El webhook de PayPal aplica las mismas comprobaciones.                                                                                                                                                                                                                                                                                                       |
| POST   | `/webhook`           | Público     | Recibe los eventos de Stripe. Lo autentica la firma `stripe-signature`, no un token. Ver la tabla de eventos más abajo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/webhook/paypal`    | Público     | Recibe los eventos de PayPal, suscrito a `CHECKOUT.ORDER.APPROVED`. Cierra el pago del cliente que aprueba y **no vuelve al sitio**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### Eventos de Stripe que se escuchan

> **La URL que hay que registrar en el panel de Stripe es la ruta completa**, con `/pedidos`
> dentro:
>
> ```
> https://<dominio-del-backend>/api/pedidos/webhook
> ```
>
> `/api/webhook` **no existe** y responde `404`. Un endpoint mal escrito no da ningún aviso
> en el panel: se queda con cero entregas y los pedidos nunca pasan a `pagado`. Ya ocurrió
> una vez. Después de registrarlo, comprueba en _Entregas de eventos_ que el contador sube.

| Evento                          | Qué hace                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `payment_intent.succeeded`      | Marca el pedido como **pagado**, consolida los horarios y descuenta stock. Es el único que cierra un cobro.                   |
| `payment_intent.processing`     | Pago asíncrono en marcha (Bizum). Anota el estado; el pedido **no** pasa a pagado ni se toca el stock hasta el desenlace.     |
| `payment_intent.payment_failed` | Anota el estado. El pedido sigue pendiente y pagable: el cliente puede reintentar.                                            |
| `payment_intent.canceled`       | El intento caducó o se canceló desde el panel. Anota el estado para que no se reutilice un intento muerto al volver a pagar.  |
| `charge.refunded`               | Devolución hecha **desde el panel de Stripe**. Anota el reembolso; si es completa, cancela el pedido y devuelve las unidades. |
| `charge.dispute.created`        | El cliente reclama el cobro a su banco. Lo anota en el pedido y lo deja en el log como error. No cambia el estado del pedido. |
| `charge.dispute.closed`         | Desenlace de la reclamación (`won`, `lost`...). Actualiza lo anotado y marca cuándo se cerró.                                 |

Cualquier otro evento se acepta con `200` sin hacer nada: Stripe reintenta lo que no
recibe un 2xx, y un aviso que no nos interesa no mejora por repetirse. En particular,
**los eventos `checkout.session.*` no pintan nada aquí**: son de Stripe Checkout, la
pasarela alojada, y este proyecto cobra con PaymentIntents en un formulario propio.

**Una reclamación no cancela el pedido ni devuelve stock por su cuenta.** Stripe retiene el
importe y abre un plazo para responder con pruebas, pero se puede ganar, y la mercancía
puede estar ya enviada: qué hacer con el pedido lo decide una persona. El webhook solo deja
constancia, en `pago.disputa`, para que se vea donde se miran los pedidos y no solo en el
panel de Stripe.

Los avisos que no son el cobro **nunca tocan un pedido ya pagado**. Stripe no garantiza el
orden de entrega y reintenta durante horas: un `payment_failed` que llega tarde no puede
pisar el estado de un cobro que sí entró.

El pedido al que se refiere un aviso se busca primero por `metadata.orderId`, que se graba
al crear el intento, y si no, por el id del intento, que el pedido guarda indexado.

**`returnUrl` se valida contra `ALLOWED_ORIGINS`**, la misma lista que gobierna CORS: la
manda el navegador, y sin esa comprobación el endpoint serviría para mandar a un cliente a
un dominio ajeno con aspecto de vuelta del pago.

El pedido pasa a `pagado` en un único punto del código, venga el aviso del webhook de
Stripe o de la captura de PayPal: ahí se consolidan los horarios reservados y se descuenta
el stock de las líneas de producto. Es idempotente por los dos lados — Stripe reintenta
hasta recibir un 2xx, y el cliente puede recargar la página de retorno de PayPal.

Si el cobro llega **después** de caducar la retención, ese punto recupera en firme los huecos
que se soltaron y siguen libres, y **anota en `incidenciasHorario`** los que ya tiene otro
pedido. Igual que `incidenciasStock`: el dinero está cobrado y el horario no, y el panel lo
enseña para que alguien recoloque al cliente o devuelva el importe.

Un intento de Stripe solo se reutiliza si se creó **para el mismo método**: uno de Bizum no
admite tarjeta, y al revés tampoco.

Un pago de PayPal se puede cerrar por dos caminos —la vuelta del cliente y el webhook—, y
pueden llegar los dos, en cualquier orden. Da igual: ambos desembocan en la misma función,
que corta en seco si el pedido ya está pagado, y la captura viaja con un `PayPal-Request-Id`
fijo que hace que PayPal devuelva la que ya hizo en vez de repetirla.

Los dos webhooks se autentican distinto, y por eso quieren el cuerpo distinto:

- **Stripe** firma con un secreto compartido y necesita los bytes **sin parsear**. De ahí el
  middleware `cuerpoCrudo` sobre esa ruta antes de `express.json()` en `index.ts`, montado
  con `post` y no con `use` — `use` casa por prefijo y le habría robado el cuerpo al de
  PayPal. **No es `express.raw`**: detrás de Vercel no lee nada, porque Vercel se lee el
  cuerpo antes y body-parser 2 da la petición por leída. Con `express.raw` se rechazaban
  todas las firmas en producción.
- **PayPal** no firma con un secreto: hay que preguntarle a él si la firma es buena,
  mandándole las cabeceras `paypal-*` junto al evento. Ese cuerpo sí llega parseado.
  Sin `PAYPAL_WEBHOOK_ID` no hay forma de verificar nada, así que el aviso **se rechaza**:
  falla cerrado, nunca abierto.

## Servicios (`/servicios`)

Los servicios comparten el espacio de `codigoArticulo` con los productos, en el rango
`6000`–`6999`.

| Método | Ruta                                  | Acceso  | Descripción                                                                                           |
| ------ | ------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| GET    | `/`                                   | Público | Lista los servicios activos, ordenados por `orden` y código.                                          |
| GET    | `/search`                             | Público | Busca servicios activos por texto (`?q=`).                                                            |
| GET    | `/admin/all`                          | Admin   | Lista todos los servicios, incluidos los desactivados.                                                |
| GET    | `/:codigoArticulo`                    | Público | Obtiene un servicio por código.                                                                       |
| POST   | `/`                                   | Admin   | Crea un servicio.                                                                                     |
| PUT    | `/:codigoArticulo`                    | Admin   | Actualiza un servicio. El código no se reasigna.                                                      |
| PATCH  | `/:codigoArticulo/activo`             | Admin   | Fija `activo`, o lo alterna si no se envía.                                                           |
| POST   | `/:codigoArticulo/imagenes`           | Admin   | Sube archivos multipart `imagenes` o asocia existentes vía JSON `{ url }` / `{ urls: [...] }`.        |
| PATCH  | `/:codigoArticulo/imagenes/principal` | Admin   | Fija la imagen indicada (`{ url }`) como principal del servicio (índice 0).                           |
| DELETE | `/:codigoArticulo/imagenes`           | Admin   | Quita una imagen del servicio. Solo borra el archivo de R2 si ningún otro servicio o producto la usa. |
| DELETE | `/:codigoArticulo`                    | Admin   | Elimina el servicio y sus imágenes de R2 (solo las que no estén en uso por otras entidades).          |

Campos propios: `modalidad` (`presencial` · `online` · `mixta`), `duracion` en minutos,
`plazas` por sesión, `requiereReserva` y `requiereConfirmacion`.

## Noticias (`/noticias`)

Una noticia nace siempre como **borrador**: `publicada` es `false` y no aparece en el
listado público hasta que un admin la publica explícitamente.

Cada cambio deja una entrada en `historial` con la acción, el autor y una foto del
título, el contenido y el estado en ese momento. Es un registro de auditoría: se
añade, nunca se edita.

| Método | Ruta            | Acceso  | Descripción                                                                           |
| ------ | --------------- | ------- | ------------------------------------------------------------------------------------- |
| GET    | `/`             | Público | Lista las noticias publicadas, más recientes primero. Filtros: `?categoria=` y `?q=`. |
| GET    | `/admin/all`    | Admin   | Lista todas las noticias, borradores incluidos.                                       |
| POST   | `/`             | Admin   | Crea una noticia como borrador.                                                       |
| PUT    | `/:id`          | Admin   | Actualiza una noticia. Solo cambia los campos enviados.                               |
| PATCH  | `/:id/publicar` | Admin   | Alterna entre publicada y borrador.                                                   |
| DELETE | `/:id`          | Admin   | Elimina la noticia, su historial y su portada del bucket.                             |

### Cómo se ilustra una noticia

El campo del formulario es siempre `imagenPortada`, pero el servidor mira lo que llega y lo
reparte entre dos campos **excluyentes**:

| Lo que se envía en `imagenPortada`                                                                    | Qué se guarda                                                        |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| El código de inserción de una publicación de Instagram, o su enlace (`/p/…` o `/reel/…`)              | El permalink normalizado en `instagramPost`, y `imagenPortada` vacío |
| Una referencia que ya está en el bucket                                                               | Su key en `imagenPortada`                                            |
| Cualquier otro enlace a una imagen, o a la **página** que la contiene, de la que se lee su `og:image` | La imagen **descargada y copiada a R2**, y su key en `imagenPortada` |

Una noticia se ilustra con una publicación insertada o con una imagen propia, nunca con las
dos.

Instagram va por su propio camino porque su imagen no se puede guardar: la URL del CDN viene
firmada y **caduca en unos días**, y la que se puede leer de la página llega ya recortada.
Insertando la publicación la sirve Instagram y no se rompe sola. El resto de enlaces se copian
por el motivo simétrico: una imagen ajena puede desaparecer.

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

| Método | Ruta               | Acceso  | Descripción                                                                                                                                                                                                       |
| ------ | ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/`                | Público | `?servicio=&desde=&hasta=` en formato `YYYY-MM-DD`. Sin token devuelve solo los huecos reservables de hoy en adelante; con `?admin=true` y token de admin devuelve también ocupados, bloqueados y fechas pasadas. |
| POST   | `/`                | Admin   | Crea un hueco suelto.                                                                                                                                                                                             |
| POST   | `/batch`           | Admin   | Genera la parrilla. Cuerpo: `servicio`, `desde`, `hasta`, `horaInicio`, `horaFin`, `duracion?`, `diasSemana` (0 = lunes … 6 = domingo), `nota?`. Devuelve `{ creados, omitidos }`.                                |
| PATCH  | `/:id/bloquear`    | Admin   | Bloquea un hueco. No se puede bloquear uno ya reservado.                                                                                                                                                          |
| PATCH  | `/:id/desbloquear` | Admin   | Devuelve un hueco bloqueado al catálogo.                                                                                                                                                                          |
| DELETE | `/:id`             | Admin   | Elimina un hueco. No se puede eliminar uno ya reservado.                                                                                                                                                          |

La generación por lotes es idempotente: un índice único por servicio, día y hora de inicio
hace que los huecos existentes se cuenten como omitidos en vez de duplicarse.

Cada hueco tiene tres estados: `disponible`, `ocupado` y `bloqueado`. Un pedido sin confirmar
retiene su hueco durante 48 horas; pasado ese plazo vuelve al catálogo. La limpieza es
perezosa — ocurre al consultar la agenda, sin cron ni proceso de fondo. Al confirmarse el
pedido la retención deja de caducar y la ocupación pasa a ser firme.
