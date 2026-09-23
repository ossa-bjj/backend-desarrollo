# Documentación del proyecto — Backend de Arturo Salas Academy

## Índice

1. [Estado documentado](#1-estado-documentado)
2. [Qué es el proyecto](#2-qué-es-el-proyecto)
3. [Arquitectura](#3-arquitectura)
4. [Estructura del repositorio](#4-estructura-del-repositorio)
5. [Lógica de negocio](#5-lógica-de-negocio)
6. [Modelo de datos](#6-modelo-de-datos)
7. [Tecnologías](#7-tecnologías)
8. [Configuración](#8-configuración)
9. [Instalación](#9-instalación)
10. [Ejecución](#10-ejecución)
11. [Tests](#11-tests)
12. [API](#12-api)
13. [Despliegue](#13-despliegue)
14. [Visita guiada](#14-visita-guiada)
15. [Estado actual](#15-estado-actual)
    15b. [Decisiones deliberadas](#15b-decisiones-deliberadas)
16. [Mantenimiento de esta documentación](#16-mantenimiento-de-esta-documentación)
17. [Checklist de pendientes](#17-checklist-de-pendientes)

---

## 1. Estado documentado

|            |                                  |
| ---------- | -------------------------------- |
| **Rama**   | `desarrollo`                     |
| **Commit** | `627ec70` **+ árbol de trabajo** |
| **Fecha**  | 2026-09-08                       |

Esta documentación describe el backend tal y como está **hoy en el árbol de trabajo**, no
solo en el último commit: sobre `627ec70` hay cambios sin commitear que sí forman parte del
estado descrito (capa de servicio en todos los dominios, módulo de importes, ESLint y
Prettier). Se dice explícitamente porque un `git checkout 627ec70` **no** reproduce lo que
aquí se documenta.

Todo lo que afirma se ha comprobado leyendo el código y la configuración; donde algo no se
ha podido confirmar, se dice.

---

## 2. Qué es el proyecto

API HTTP de la academia de BJJ y Grappling de Arturo Salas. Cubre cuatro cosas:

- **Tienda** — catálogo de productos físicos (guantes, ropa, calzado) con carga de
  imágenes.
- **Servicios** — sesiones de coaching, mentorías y seminarios, con reserva de horario.
- **Pedidos y cobro** — carrito mixto de productos y servicios, con confirmación
  administrativa cuando hace falta tarificar, y cobro con tarjeta, Bizum o PayPal.
- **Contenido** — noticias del club con historial de cambios.

Sirve a un frontend React que vive en un repositorio separado (`ossa-bjj/frontend`).

---

## 3. Arquitectura

Express sobre MongoDB, desplegado como función serverless en Vercel. **Los siete dominios
siguen el mismo reparto en cuatro piezas**: modelo, rutas, controlador y servicio. El
controlador lee la petición, llama al servicio y traduce el resultado a HTTP; el servicio
tiene las reglas y las consultas, y no conoce `Request` ni `Response`.

```text
Cliente (frontend React)
  ↓ HTTP
index.ts                    validación de entorno, CORS, conexión perezosa a Mongo
  ↓
router del dominio          /api/users · /api/productos · /api/pedidos ·
  ↓                         /api/servicios · /api/disponibilidad · /api/noticias
controlador                 lee la petición y traduce la respuesta { success, data }
  ↓
servicio                    reglas de negocio y consultas
  ↓
modelo Mongoose
  ↓
MongoDB Atlas
```

`users/` es el único con matiz: su lógica se reparte entre `user.service.ts` y
`acceso.service.ts`, y tiene cuatro controladores en vez de uno (ver
[Decisiones deliberadas](#15b-decisiones-deliberadas)).

Cuatro integraciones externas: **Cloudflare R2** para archivos e imágenes (a través de un
proxy propio, ver [Visita guiada](#14-visita-guiada)), **Stripe** para el cobro con
tarjeta y con Bizum, **PayPal** para el suyo, y **Resend** para el correo de recuperación
de contraseña. Las tres últimas se hablan por REST; solo Stripe usa SDK.

### Dependencias entre dominios

Comprobadas leyendo los `import` reales. Ningún dominio importa a `users`, y `shared/`
no importa a nadie: la dirección es correcta.

```text
users          → shared
services       → shared
news           → shared
products       → services, shared
availability   → services, shared
orders         → availability, payments, products, services, shared
payments       → availability, orders, products, shared
```

`orders` y `payments` son los dos nudos: un pedido toca catálogo, horarios y cobro.

---

## 4. Estructura del repositorio

```text
backend/
├── api/index.ts              Entrada serverless de Vercel (reexporta index.ts)
├── index.ts                  App Express: middlewares, CORS, rutas, arranque local
├── src/
│   ├── availability/         Huecos reservables y retención de horarios
│   ├── news/                 Noticias con historial de cambios
│   ├── orders/               Pedidos y confirmación de presupuestos
│   ├── payments/             Cobro: Stripe (tarjeta y Bizum) y PayPal
│   ├── products/             Productos y carga de imágenes
│   ├── services/             Servicios vendibles (códigos 60XX)
│   ├── users/                Usuarios, perfiles y membresías
│   └── shared/               DB, JWT, R2, CORS, correo, importes, entorno
├── docs/
│   ├── api-endpoints.md      Referencia de rutas
│   └── project_documentation.md   Este documento
├── eslint.config.mjs         Reglas de linter
├── .prettierrc.json          Formato
├── vercel.json               Reescritura de todo el tráfico hacia /api
└── .env.example              Plantilla de variables
```

Cada carpeta de `src/` sigue el mismo patrón: `<dominio>.model.ts`,
`<dominio>.routes.ts`, `<dominio>.controller.ts` y `<dominio>.service.ts`. Quien conoce
uno se orienta en los demás.

`payments/` es el que más se separa de esa forma, y con motivo: no tiene modelo propio
—el cobro vive dentro del pedido— ni rutas propias —cuelgan de `/api/pedidos`—. Sí tiene
`pago.service.ts` (reglas del cobro), `reembolso.service.ts` (devoluciones) y dos clientes
externos, `stripe.utils.ts` y `paypal.utils.ts`.

`shared/` contiene lo transversal: `db.ts` (conexión cacheada), `token.utils.ts` (JWT
y la declaración global de `Request.user`), `auth.middleware.ts` (`isAuth`, `isAdmin`,
`optionalAuth`), `r2.utils.ts` (Cloudflare R2), `env.ts` (validación de arranque),
`file.middleware.ts` (Multer en memoria), `dinero.ts` (redondeo de importes) y
`controller.utils.ts` (errores, permisos y respuestas corrientes).

---

## 5. Lógica de negocio

### 5.1 Códigos de artículo

Productos y servicios **comparten el espacio de `codigoArticulo`**, un entero de cuatro
dígitos cuyo prefijo indica la categoría:

| Prefijo | Categoría                                               |
| ------- | ------------------------------------------------------- |
| `10XX`  | Ropa de entrenamiento                                   |
| `20XX`  | Protecciones                                            |
| `30XX`  | Ropa de calle                                           |
| `40XX`  | Accesorios                                              |
| `50XX`  | Calzado                                                 |
| `60XX`  | **Servicios** (rango 6000–6999, validado en el esquema) |

Un pedido puede llevar productos y servicios mezclados, y el código dice de cuál se
trata.

### 5.2 Ciclo de vida de un pedido

Ocho estados, definidos en `src/orders/order.model.ts`:

```text
                    ┌─ pendiente_confirmacion ─┐   lleva servicios que un
                    │                          │   admin debe tarificar
crear pedido ───────┤                          ├──→ rechazado (libera horarios)
                    │                          │
                    └─ pendiente ──────────────┘   confirmado y pagable
                            ↓ webhook de Stripe, o captura de PayPal
                         pagado → preparando → enviado → entregado
                            ↓
                        cancelado  (si estaba pagado, devuelve el importe)
```

**Un pedido nace en uno de dos estados**, según lleve o no algún servicio marcado con
`requiereConfirmacion`:

- Sin servicios que confirmar → nace `pendiente`, ya es pagable.
- Con alguno → nace `pendiente_confirmacion`. El total del catálogo es orientativo; un
  admin lo revisa, ajusta precios línea a línea y lo confirma o lo rechaza.

`ESTADOS_NO_PAGABLES` (`pendiente_confirmacion`, `cancelado`, `rechazado`) es la lista
que consulta `pago.controller.ts` antes de arrancar cualquier cobro: un intento de pagar
en esos estados devuelve `409`, sea cual sea el método.

**El total lo calcula siempre el servidor** con los precios vigentes en el momento de
crear el pedido. Lo que envíe el cliente no se usa.

**Cancelar un pedido ya cobrado devuelve el dinero.** No hay una acción de reembolso
aparte: pasar a `cancelado` un pedido en `pagado` dispara la devolución en la pasarela
—`refunds.create` en Stripe, `/refund` sobre la captura en PayPal— **antes** de cambiar el
estado. Si la devolución falla, el pedido se queda como estaba y responde `409`; nunca
figura cancelado con el importe retenido. La referencia y la fecha quedan guardadas en
`pago.reembolsoId` y `pago.reembolsadoEn`. Vive en `src/payments/reembolso.service.ts`.

Un pedido **no se borra desde la aplicación**: es el registro de un cobro, y cancelar es la
forma de retirarlo. La ruta `DELETE /api/pedidos/:id` existe y es solo de admin, pero el
panel no la ofrece.

### 5.3 Reserva de horarios

Un servicio con `requiereReserva` consume huecos de la colección `Disponibilidad`. El
mecanismo tiene tres fases y está en `src/availability/disponibilidad.service.ts`:

1. **Retener** (`retenerSlots`) — al crear el pedido, los huecos pasan a `ocupado` con
   un `retenidoHasta` y el `pedidoId`. Es una retención con caducidad.
2. **Consolidar** (`consolidarSlotsDePedido`) — cuando se confirma el cobro, se quita la
   caducidad. A partir de ahí el horario solo se libera cancelando.
3. **Liberar** (`liberarSlotsDePedido`) — al cancelar o rechazar, los huecos vuelven a
   `disponible`.

Ver [Visita guiada](#14-visita-guiada) para cómo se resuelve la competencia entre dos
clientes por el mismo hueco.

### 5.4 Días de la semana

**Convención del proyecto: lunes = 0, domingo = 6.** La impone
`diaSemanaLunesCero()` en `disponibilidad.controller.ts`, que convierte desde
`Date.getUTCDay()` (donde 0 es domingo) con `(getUTCDay() + 6) % 7`.

Confundir las dos convenciones corre la parrilla un día entero. El frontend tiene su
propia implementación en `utils/fechasUtc.ts` y **debe coincidir**.

### 5.5 Stock por talla

**El stock de un producto no es un número, es cinco.** Cada producto lleva un array
`tallas` con una entrada por talla —`S`, `M`, `L`, `XL`, `XXL`— y su stock propio. Un
producto nuevo nace con las cinco a cero.

El motivo es directo: con un contador único, agotada la M la tienda seguía vendiendo M.

Consecuencias en el resto del sistema:

- **Una línea de pedido de producto exige talla.** Sin ella el servidor la rechaza: es de
  esa talla de donde hay que descontar.
- **La misma prenda en dos tallas son dos líneas**, no una con cantidad 2. Ver
  [Visita guiada](#14-visita-guiada).
- **`stockTotal` es un campo calculado**, no almacenado: un virtual que suma las cinco. Sale
  en las respuestas porque el esquema activa `virtuals` en su `toJSON`.
- **Quién decide si una talla se puede vender está en un solo sitio**,
  `motivoParaNoVender` en `src/products/producto.service.ts`. Lo consultan tanto el alta del
  pedido como el cobro: si cada uno lo resolviera por su cuenta, se podría aceptar un pedido
  y luego descontar de otro sitio.

**Cobrar sin existencias queda registrado, no se esconde.** Dos clientes pueden pagar la
última unidad casi a la vez; el dinero de los dos ya entró. El descuento es una única
operación condicional —«resta uno de esta talla _solo si_ queda al menos uno»—, así que
solo uno la gana. Al otro no se le devuelve un error: su pedido guarda una entrada en
`incidenciasStock`, que el panel enseña en rojo y permite reembolsar. Un stock negativo
silencioso sería peor que un reembolso trazable.

### 5.6 Permisos

Tres roles (`user`, `premium`, `admin`) y tres estados de cuenta (`pendiente`,
`activo`, `baneado`).

La regla de acceso está implementada **una sola vez**, en
`shared/controller.utils.ts`:

- `esAdmin(req)` — el rol del token es `admin`.
- `esDuenoOAdmin(req, usuario)` — pasa el admin, y pasa el dueño del recurso. Acepta el
  usuario como id suelto, `ObjectId` o documento ya populado.

Los middlewares `isAuth` / `isAdmin` protegen rutas enteras; `optionalAuth` rellena
`req.user` si hay token y deja pasar si no, y lo usa `/api/disponibilidad` para
devolver más información a un admin que a un visitante.

### 5.7 Noticias

Una noticia **nace siempre como borrador** (`publicada: false`) y no aparece en el
listado público hasta que un admin la publica explícitamente con
`PATCH /:id/publicar`.

Cada cambio añade una entrada a `historial` con la acción (`creada`, `editada`,
`publicada`, `despublicada`), el autor y una foto del título, el contenido y el estado
en ese momento. Es un registro de auditoría: se añade, nunca se edita.

**Cómo se ilustra una noticia.** El campo `imagenPortada` admite tres cosas, y el
servidor decide qué hacer con cada una en `resolverPortada`
(`src/shared/imagenRemota.ts`):

| Lo que llega                                                        | Qué hace el servidor               | Dónde acaba     |
| ------------------------------------------------------------------- | ---------------------------------- | --------------- |
| El código de inserción de una publicación de Instagram, o su enlace | Extrae el permalink y lo normaliza | `instagramPost` |
| Una referencia del propio almacén                                   | La deja como está                  | `imagenPortada` |
| Cualquier otro enlace a una imagen, o a la página que la contiene   | La descarga y la copia a R2        | `imagenPortada` |

**Los dos campos son excluyentes**: una noticia se ilustra con una publicación
insertada o con una imagen propia, nunca con las dos. El que no se usa queda vacío.

Que Instagram vaya por su propio camino tiene motivo: la URL de imagen que sirve su
CDN viene firmada y **caduca a los pocos días**, y la que se puede leer de la página
llega ya recortada. Insertar la publicación deja que sea Instagram quien la sirva, y
así no se rompe sola.

Copiar a R2 el resto de enlaces responde al mismo problema al revés: una imagen ajena
puede desaparecer, así que se guarda una copia.

Cualquier otro valor se rechaza con **400**. La descarga solo acepta `http` y `https`,
bloquea las direcciones de la red interna, y corta a 8 MB de imagen, 4 MB de HTML y
15 segundos.

---

## 6. Modelo de datos

MongoDB con Mongoose. Siete colecciones:

```text
User ──1:N──→ Order ──1:N──→ OrderItem (embebido)
 │                              │
 │                              └──→ Disponibilidad (por slotId)
 │
 └──1:N──→ Noticia (como autor)

Producto        independiente, referenciado por codigoArticulo
                lleva tallas[] con el stock de cada una
Servicio        independiente, referenciado por codigoArticulo
Disponibilidad  ──N:1──→ Servicio
IntentoAcceso   independiente, se borra sola
```

### User

El documento más denso del proyecto (`src/users/user.model.ts`, 266 líneas). Agrupa en
un solo documento cinco secciones anidadas:

```text
User
├── username, email, password (hash bcrypt), role, status
├── profile          nombre, teléfono, avatar, direcciones de envío
├── customer         si es cliente, origen, fecha de alta
├── sportsProfile    si es deportista, federado, licencia, club
├── membership       estado de cuota, importe, moneda, vencimiento
└── membershipPayments[]   historial de pagos de cuota
```

### Order

```text
Order
├── user            referencia a User — puede quedar en null si la cuenta se borró
├── items[]         { tipo, codigoArticulo, nombre, precio, cantidad, talla, slotId }
│                   `talla` solo en productos; `slotId` solo en servicios
├── total           calculado por el servidor
├── status          uno de los ocho estados
├── pago            { proveedor, paymentIntentId, estado, pagadoEn,
│                     reembolsoId, reembolsadoEn }
│                   `proveedor` guarda el método que eligió el cliente
│                   (`stripe` · `bizum` · `paypal`), y `paymentIntentId`, la
│                   referencia del cobro en ese proveedor: el PaymentIntent de
│                   Stripe o el id de la CAPTURA de PayPal (no el de la orden:
│                   es el único con el que PayPal admite una devolución)
├── incidenciasStock[]  líneas cobradas sin existencias de su talla
└── motivoRechazo   solo cuando status = rechazado
```

Cada línea tiene una **identidad compuesta** (`identidadLinea`): artículo más horario más
talla. Dos reservas del mismo servicio a horas distintas, o la misma camiseta en dos
tallas, son líneas separadas y no una con cantidad 2. Ver
[Visita guiada](#14-visita-guiada).

### Servicio

```text
Servicio
├── codigoArticulo       código único en rango 60XX (ej: "6001")
├── nombre               título del servicio
├── categoria, subcategoria
├── descripcion          resumen corto para catálogo
├── descripcionCompleta  texto explicativo detallado para la página propia
├── precio               valor numérico
├── precioDesde          booleano: indica si es precio base ("Desde X €")
├── unidadPrecio         sufijo opcional ("/mes", "/h", "por persona")
├── textoBoton           CTA personalizado ("Comprar", "Reservar", "Solicitar fecha")
├── modalidad            online | presencial | hibrido
├── duracionMinutos      duración estimada de la sesión
├── plazasMaximas        aforo si aplica
├── requiereReserva      booleano: exige selección de hueco en Disponibilidad
├── activo               visibilidad en catálogo
├── imagenes[]           URLs en R2 (se muestran en catálogo general)
├── etiquetas[]          palabras clave informativas
└── orden                peso de ordenación en listados
```

### Disponibilidad

```text
Disponibilidad
├── servicio        codigoArticulo del servicio (60XX)
├── fecha           día del hueco
├── horaInicio      "HH:MM", hora local de la academia
├── horaFin
├── duracion        minutos
├── estado          disponible | ocupado | bloqueado
├── pedidoId        qué pedido lo retiene, si alguno
└── retenidoHasta   caducidad de la retención
```

### Noticia

```text
Noticia
├── titulo, extracto, contenido
├── imagenPortada   referencia en R2, ya sea subida o copiada de un enlace
├── instagramPost   permalink de la publicación, si se ilustró con una
├── categoria       EVENTO | RESULTADO | CLUB | PROMOCION | GENERAL
├── fechaEvento, horaInicio, horaFin, lugar    (solo tienen sentido en EVENTO)
├── publicada       nace en false
├── autor           referencia a User
└── historial[]     { fecha, autor, accion, snapshot }
```

### IntentoAcceso

El contador del freno de fuerza bruta del login.

```text
IntentoAcceso
├── clave            a quién cuenta: un usuario o una IP
├── intentos         fallos acumulados
├── bloqueadoHasta   hasta cuándo se rechaza
└── expiraEn         cuándo se borra el documento
```

Vive en Mongo y no en memoria **porque el despliegue es serverless**: cada petición
puede caer en una instancia distinta, así que un contador en memoria no cuenta nada.

Se limpia sola: un índice TTL sobre `expiraEn` hace que Mongo borre el documento
cuando la fecha queda atrás. No hay tarea de mantenimiento que escribir.

### Semilla

**No hay semilla en el repositorio.** `seed.ts` está en `.gitignore`: es una herramienta
local de datos de prueba, no parte del despliegue. Quien monte el proyecto de cero se
encuentra las colecciones vacías, y el primer usuario administrador hay que crearlo
directamente en Mongo o por `POST /api/users/register` seguido de un cambio de rol.

Si se usa la copia local, hay que saber una cosa: **vacía las siete colecciones**, no solo
las tres que vuelve a insertar. No es exceso de celo. Los pedidos, los horarios, las
noticias y los intentos de acceso **apuntan** a usuarios, productos y servicios, así que
borrar solo esas tres deja restos incoherentes: pedidos sin dueño, y —peor— pedidos cuyo
`codigoArticulo` pasa a señalar un artículo distinto con el mismo código, que no falla y
miente. Como un pedido no se borra desde la aplicación, partir de cero es lo único que
garantiza un estado coherente.

`seed.ts` **no entra en `tsconfig`** (`include: ["src", "index.ts", "api"]`), así que
`npm run verificar` no la comprueba: al tocarla hay que verificarla a mano.

---

## 7. Tecnologías

| Tecnología           | Uso                                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Express 5            | API HTTP                                                                                                                                                                                |
| TypeScript 6         | Lenguaje                                                                                                                                                                                |
| MongoDB + Mongoose 8 | Persistencia y esquemas                                                                                                                                                                 |
| JSON Web Token       | Sesión sin estado (8 h de vigencia)                                                                                                                                                     |
| bcryptjs             | Hash de contraseñas                                                                                                                                                                     |
| Stripe 22            | Cobro con tarjeta y con Bizum (PaymentIntent + webhook)                                                                                                                                 |
| PayPal Orders v2     | Cobro con PayPal. Se habla con su API REST por `fetch`, **sin SDK**: son tres llamadas (token, crear orden, capturar) y el SDK oficial traería mucha más superficie de la que se usaría |
| Resend               | Correo transaccional, también por REST y sin SDK, por el mismo motivo                                                                                                                   |
| `@aws-sdk/client-s3` | Cliente de Cloudflare R2 (API compatible con S3)                                                                                                                                        |
| Multer 2             | Recepción de archivos en memoria antes de subirlos a R2                                                                                                                                 |
| cors                 | Origen configurable por entorno                                                                                                                                                         |
| dotenv               | Carga de `.env` en local                                                                                                                                                                |
| ts-node-dev          | Recarga en desarrollo                                                                                                                                                                   |
| ESLint 10            | Linter. Además de lo estándar, dos reglas propias del backend: `no-floating-promises` y `await-thenable` — en un flujo de cobro, una promesa sin esperar es dinero sin comprobar        |
| Prettier 3           | Formato, con la misma configuración que el frontend                                                                                                                                     |

No hay framework de tests instalado.

---

## 8. Configuración

Todas las variables se leen de `.env` en local y del panel de Vercel en producción.
`src/shared/env.ts` **valida al arrancar** y aborta si falta alguna obligatoria.

| Variable                | Propósito                                                                                        | Obligatoria                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `DB_URL`                | Cadena de conexión a MongoDB                                                                     | Sí                                          |
| `JWT_SECRET`            | Firma de los tokens de sesión                                                                    | Sí                                          |
| `R2_ACCOUNT_ID`         | Cuenta de Cloudflare R2                                                                          | Sí                                          |
| `R2_ACCESS_KEY_ID`      | Credencial de R2                                                                                 | Sí                                          |
| `R2_SECRET_ACCESS_KEY`  | Credencial de R2                                                                                 | Sí                                          |
| `R2_BUCKET_NAME`        | Bucket de archivos                                                                               | Sí                                          |
| `R2_PUBLIC_DOMAIN`      | Base pública de las URL de archivo                                                               | Sí                                          |
| `PORT`                  | Puerto HTTP local (por defecto 3000)                                                             | No                                          |
| `ENVIRONMENT`           | `development` o `production`                                                                     | No                                          |
| `ALLOWED_ORIGINS`       | Orígenes CORS separados por coma; admite comodín (`https://*.midominio.dev`) y `*` permite todos | Sí                                          |
| `STRIPE_SECRET_KEY`     | Clave secreta de Stripe (tarjeta y Bizum)                                                        | No — sin ella no se puede cobrar            |
| `STRIPE_WEBHOOK_SECRET` | Secreto de firma del webhook                                                                     | No — sin él el webhook rechaza              |
| `PAYPAL_CLIENT_ID`      | Credencial de la app REST de PayPal                                                              | No — sin ella no se puede cobrar con PayPal |
| `PAYPAL_CLIENT_SECRET`  | Credencial de la app REST de PayPal                                                              | No                                          |
| `PAYPAL_ENTORNO`        | `live` apunta a la API real; cualquier otro valor, al sandbox                                    | No                                          |
| `PAYPAL_WEBHOOK_ID`     | Verifica la firma de los avisos de PayPal                                                        | No — sin él se rechaza el webhook entero    |
| `RESEND_API_KEY`        | Envío del correo de recuperación                                                                 | No — sin ella el correo no sale             |
| `CORREO_REMITENTE`      | Remitente de ese correo, dominio verificado en Resend                                            | No                                          |

Las de pago y las de correo **no bloquean el arranque**, y es a propósito: el `seed`, los
tests manuales y el desarrollo sin pasarela no tienen por qué exigir credenciales de
producción. Lo que falla, con un mensaje que nombra la variable, es el intento de cobrar;
el correo degrada más suave todavía y solo deja aviso en el log. En el `.env` local
actual están todas vacías.

```env
DB_URL=<database-url>
JWT_SECRET=<secret>
R2_ACCESS_KEY_ID=<access-key>
STRIPE_SECRET_KEY=<stripe-secret-key>
```

---

## 9. Instalación

### Requisitos

- Node.js 22 o superior (probado con v25).
- npm.
- Una base MongoDB accesible (Atlas o local).
- Un bucket de Cloudflare R2 con sus credenciales.

### Pasos

```bash
npm install
cp .env.example .env
# rellenar .env con los valores reales
```

La base arranca vacía: no hay semilla en el repositorio.

---

## 10. Ejecución

### Desarrollo

```bash
npm run dev          # ts-node-dev con recarga, en http://localhost:3000
npm run lint         # eslint .
npm run format       # prettier --write .
npm run verificar    # tsc --noEmit && eslint . && prettier --check .
```

`npm run verificar` es la puerta: pasa los tres antes de dar un cambio por bueno.

### Producción

```bash
npm run build     # tsc → dist/
npm start         # node dist/index.js
```

`index.ts` solo llama a `listen()` cuando se ejecuta directamente
(`require.main === module`). Así el mismo fichero sirve en local y como función
serverless.

---

## 11. Tests

```bash
npm test          # vitest run
npm run test:watch
npm run verificar # tsc --noEmit -p tsconfig.test.json && eslint . && prettier --check .
```

### Comprobación automática

**Vitest + Supertest + MongoDB en memoria.** Los tests viven en `test/` y hoy cubren el
**cobro con Stripe** de punta a punta: arrancarlo, los avisos que devuelve Stripe y la
devolución del dinero.

```text
test/
├── setup/
│   ├── mongo.ts         Arranca una MongoDB en memoria para toda la suite
│   └── entorno.ts       Conecta cada fichero a su propia base y fija el entorno
├── ayudas/
│   ├── webhook.ts       Carga la app, firma eventos y los entrega como Stripe
│   ├── pedidos.ts       Pedidos y productos de prueba
│   ├── sesion.ts        Tokens de cliente y de admin
│   └── stripe-simulado.ts   SDK de Stripe de mentira, que apunta cómo se le llama
├── webhook/
│   ├── firma.test.ts            Autenticación: sin firma, firma falsa, otro secreto,
│   │                            evento viejo, cuerpo manipulado
│   ├── pago-completado.test.ts  payment_intent.succeeded
│   ├── pago-fallido.test.ts     payment_intent.payment_failed
│   ├── pago-expirado.test.ts    payment_intent.canceled
│   ├── pago-asincrono.test.ts   payment_intent.processing (Bizum) y sus desenlaces
│   └── reembolso.test.ts        charge.refunded
└── pagos/
    ├── iniciar-pago.test.ts         POST /pedidos/:id/pago/iniciar: permisos, estados
    │                                cobrables y qué se le pide a Stripe
    ├── reembolso-desde-panel.test.ts  Cancelar un pedido cobrado devuelve el dinero
    └── importes.test.ts             Euros a céntimos, sin desviarse un céntimo
```

Tres decisiones que explican cómo están escritos:

- **La firma se genera con el SDK de Stripe** (`generateTestHeaderString`), que calcula
  el mismo HMAC que Stripe en sus servidores. Así se ejercita la verificación real y no
  una imitación.
- **La base de datos es de verdad, en memoria.** Un test de cobro que no comprueba que el
  pedido quedó guardado como pagado no prueba lo que importa. Cada fichero usa su propia
  base dentro del mismo servidor, para poder ir en paralelo sin pisarse.
- **A Stripe no se le llama nunca.** Los eventos del webhook se firman en local, y para
  crear cobros y reembolsos se sustituye el cliente por uno de mentira que apunta con qué
  se le llama: importe en céntimos, metadata con el pedido y método correcto. Lo que se
  prueba es nuestro lado del contrato.

Los tests quedan fuera de `tsconfig.json` a propósito, para que no acaben en `dist/`. Se
analizan con `tsconfig.test.json`, que es el que usan `npm run verificar` y ESLint.

`seed.ts` queda fuera de todo: no está en `tsconfig` ni lo revisa ESLint.

**Lo que no está cubierto**: el cobro con PayPal, los pedidos (alta, confirmación,
rechazo), usuarios, catálogo y disponibilidad.

### Comprobación funcional

Se hace a mano, llamando a la API con el servidor levantado. La forma más corta de
ejercitar un endpoint protegido es sacar un token del login y usarlo:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/users/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<password>"}' | jq -r .data.token)

curl -s http://localhost:3000/api/pedidos -H "Authorization: Bearer $TOKEN"
```

Los tres métodos de pago, la subida a R2 y el envío de correo **no se pueden ejercitar
sin credenciales**: hasta que estén, lo único comprobable de la pasarela es que rechaza
lo que debe rechazar (un método inventado, PayPal sin URL de vuelta, un webhook con
firma que no vale).

---

## 12. API

Todas las rutas cuelgan de `/api`. La referencia completa está en
[`docs/api-endpoints.md`](./api-endpoints.md); aquí van la forma de las respuestas y
los grupos.

### Forma de la respuesta

Éxito:

```json
{ "success": true, "data": {} }
```

Error:

```json
{ "error": "Mensaje legible", "detail": "opcional" }
```

Códigos usados: `400` datos inválidos, `401` sin token, `403` sin permiso, `404` no
encontrado, `409` conflicto de estado, `500` error interno.

Un cuerpo al que le falte un campo obligatorio, o que traiga un valor fuera de rango,
responde **400 nombrando los campos** (`Datos no validos: subcategoria`). El resto del
mensaje de Mongoose se queda en el registro del servidor: nombra colecciones, índices y
rutas internas, y eso es un mapa gratis de la aplicación para quien la esté sondeando.
La regla vive en `sendServerError` (`src/shared/controller.utils.ts`) y por tanto vale
para todos los controladores a la vez.

### Grupos

| Prefijo               | Dominio                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `/api/users`          | Registro, login, perfil, direcciones, membresías, administración |
| `/api/productos`      | Catálogo, CRUD e imágenes                                        |
| `/api/servicios`      | Catálogo de servicios, CRUD e imágenes                           |
| `/api/disponibilidad` | Consulta de huecos, generación por lotes, bloqueo                |
| `/api/pedidos`        | Carrito, confirmación, cambio de estado y cobro                  |
| `/api/noticias`       | Listado público, administración y publicación                    |
| `/api/media/*`        | Proxy de lectura de archivos de R2                               |

### Autenticación

```http
POST /api/users/login
```

```json
{ "username": "<usuario>", "password": "<password>" }
```

Devuelve `{ success: true, data: { token, user } }`. El token va en las peticiones
protegidas como `Authorization: Bearer <token>`, y caduca a las 8 horas.

El registro **exige `profile`** en el cuerpo; sin él, Mongoose rechaza con
`Path 'profile' is required`. El `.env.example` no lo documenta.

---

## 13. Despliegue

Vercel, como función serverless.

```text
Vercel
└── función  api/index.ts  →  reexporta la app Express de index.ts
    ├── MongoDB Atlas       (DB_URL)
    ├── Cloudflare R2       (R2_*)
    ├── Stripe              (STRIPE_*)   tarjeta y Bizum
    ├── PayPal              (PAYPAL_*)
    └── Resend              (RESEND_*)   correo de recuperación
```

`vercel.json` reescribe todo el tráfico (`/(.*)`) hacia `/api`, y Vercel descubre
automáticamente `api/index.ts` como la función.

> **Sobre `api/index.ts`.** Es una sola línea que reexporta la app. Parece un resto
> suelto y no lo es: es lo único que crea el endpoint, y **no hay alternativa moderna**.
> La propiedad `functions` de `vercel.json` solo acepta globs que apunten dentro de
> `api/`, así que declarar el `index.ts` de la raíz exigiría `builds`, que es legado y
> desactiva los ajustes del panel. Borrar este fichero deja el despliegue sin API.

**Orden de despliegue: backend primero, frontend después.** El envoltorio
`{ success, data }` es un contrato: el frontend nuevo contra un backend anterior rompe
el login.

---

## 14. Visita guiada

Cuatro puntos que no se entienden de una lectura.

### A. Cómo dos clientes no reservan el mismo hueco

**Qué hace.** Impide que dos personas que pulsan «reservar» a la vez se lleven el
mismo horario.

**Por qué existe.** Entre leer que un hueco está libre y guardarlo pasa un instante.
Si dos peticiones leen a la vez, las dos ven «libre» y las dos escriben.

**Cómo funciona.** `retenerSlots` no lee y luego escribe: manda **una sola operación**
a MongoDB que incluye la condición dentro del propio `update` —«pon este hueco como
ocupado _sólo si_ sigue disponible»—. MongoDB garantiza que esa operación es atómica
sobre un documento, así que de dos peticiones simultáneas solo una encuentra el hueco
libre. La otra recibe el hueco en la lista de `ocupados` y el llamante decide si eso
invalida el pedido entero.

**Qué complejidad es esencial.** Toda. La concurrencia viene del problema.

**Qué hay que saber para tocarlo.** No conviertas eso en «buscar y luego guardar»: en
cuanto la condición sale del `update`, vuelve la carrera. Y la retención tiene
caducidad (`retenidoHasta`): un pedido abandonado no bloquea el horario para siempre.

### B. Por qué una línea de pedido no es un artículo

**Qué hace.** Distingue dos reservas del mismo servicio a horas distintas como dos
líneas separadas dentro del mismo pedido.

**Por qué existe.** Un carrito normal suma cantidades: dos camisetas iguales son una
línea con cantidad 2. Pero dos sesiones de clase privada, martes a las 10 y jueves a
las 18, no se pueden sumar: son dos reservas de dos horarios distintos.

**Cómo funciona.** La identidad de una línea deja de ser el código de artículo y pasa a
ser **código más horario más talla** (`identidadLinea` en `order.model.ts`). La talla entró
en la fórmula al llevar el stock por talla: la misma camiseta en M y en L son dos líneas
que descuentan de sitios distintos.

**Qué complejidad es accidental.** Que la misma regla esté escrita también en el
frontend (`utils/identidadLinea.ts`). Las dos deben producir cadenas idénticas o el
ajuste del admin no encuentra su línea, **en silencio**.

**Qué hay que saber para tocarlo.** Es un contrato entre dos repositorios. Si algún día
se reserva también sala o entrenador, hay que cambiarlo en los dos a la vez.

### C. El cobro no lo confirma el navegador

**Qué hace.** Marca un pedido como pagado.

**Por qué existe.** Que Stripe acepte la tarjeta en el navegador no significa que el
dinero esté cobrado: la respuesta del navegador se puede perder, falsear o interrumpir.

**Cómo funciona.** Con Stripe y con Bizum, el backend crea un PaymentIntent y devuelve un
`clientSecret`. El navegador cobra con él y **no decide nada más**: quien marca el pedido
como `pagado` es el **webhook** (`payment_intent.succeeded`), que llega servidor a
servidor y va firmado.

PayPal no encaja en ese molde: el dinero se mueve en la llamada que hace el propio backend
a `/capture`. Por eso el navegador ahí sí dispara la acción —pidiendo
`POST /:id/pago/capturar`—, pero **sigue sin decidir nada**: lo que se cree no es lo que
diga el navegador, sino lo que responda PayPal a esa captura, servidor a servidor.

Y como el navegador puede no volver nunca —el cliente aprueba y cierra la pestaña—, PayPal
avisa además por su cuenta con `CHECKOUT.ORDER.APPROVED`. Ese aviso captura igual. Así que
un pago de PayPal tiene **dos** finales posibles, y pueden llegar los dos, en cualquier
orden.

Los tres caminos desembocan en la misma función, `marcarPagado`
(`src/payments/pago.service.ts`). Es el único sitio donde un pedido pasa a `pagado`, y por
tanto el único donde se consolidan los horarios y se descuenta el stock **de la talla
comprada**. Si cada proveedor consolidara por su cuenta, acabarían divergiendo.

Lo que no se puede servir no revienta el cobro: se anota en `incidenciasStock` del pedido
y se guarda **después** de marcar `pagado`. El cobro es un hecho aunque el stock no cuadre,
y esconderlo no lo desharía.

**Qué hay que saber para tocarlo.** El webhook de Stripe necesita el cuerpo **sin parsear**
para verificar la firma: por eso `index.ts` monta `express.raw()` en
`/api/pedidos/webhook` **antes** de `express.json()`. Ese orden no es cosmético; al
revés, la firma no valida nunca. Y se monta con `app.post`, no con `app.use`: `use` casa
por prefijo, así que le entregaría también un Buffer al webhook de PayPal, que cuelga de
`/webhook/paypal` y sí quiere el cuerpo parseado.

Los dos proveedores se autentican de forma distinta. Stripe firma con un secreto
compartido; PayPal no, y hay que preguntarle a él si la firma es buena. Sin
`PAYPAL_WEBHOOK_ID` no se puede verificar nada, así que su webhook **se rechaza** en vez de
creérselo: falla cerrado.

Todo es idempotente porque tiene que serlo: Stripe reintenta el webhook hasta recibir un
2xx, el cliente puede recargar la página de retorno de PayPal, y el aviso de PayPal puede
cruzarse con esa vuelta. Si el pedido ya está `pagado`, `marcarPagado` sale sin hacer nada;
y la captura además viaja con un `PayPal-Request-Id` fijo, de modo que PayPal devuelve la
captura que ya hizo en vez de cobrar dos veces.

### D. Las imágenes no se sirven desde R2

**Qué hace.** Entrega las imágenes de productos, servicios y noticias.

**Por qué existe.** El bucket de R2 no es público. Exponerlo obligaría a gestionar
dominio propio y permisos de lectura anónima.

**Cómo funciona.** El backend expone `/api/media/*`, lee el objeto de R2 y hace `pipe`
del stream a la respuesta, con `Cache-Control` de un año e `immutable` — las claves
llevan marca de tiempo, así que un fichero nunca cambia de contenido. Si R2 responde
`NoSuchKey`, el proxy devuelve `404`.

**Qué hay que saber para tocarlo.** En base de datos se guarda solo la _key_ del objeto
(`uploads/…`), nunca la URL completa: la URL pública se compone al leer con el
`R2_PUBLIC_DOMAIN` del entorno, en el `toJSON` de cada modelo. Cambiar de dominio no
exige migrar datos. Las filas antiguas guardaban la URL absoluta del entorno donde se
subió el fichero; `normalizarUrlMedia` les extrae la key venga del dominio que venga, así
que conviven ambos formatos. Por el mismo motivo `keyFromPublicUrl` no depende de
`R2_PUBLIC_DOMAIN`: si dependiera, al cambiar de dominio dejaría de reconocer las URL
antiguas y los borrados fallarían en silencio, dejando huérfanos en el bucket.

**El placeholder no se guarda en base de datos.** Un producto o servicio sin fotos tiene el
array `imagenes` vacío, y es la vista quien decide qué enseñar. Guardarlo convertía una
imagen de relleno en un dato: al subir fotos de verdad el placeholder seguía dentro del
array, porque nadie lo quitaba, y aparecía mezclado en la galería.

---

## 15. Estado actual

Los siete dominios están implementados y responden: registro y login, perfil y direcciones,
permisos por rol, catálogo de productos **con stock por talla** y de servicios con carga de
imágenes, parrilla de disponibilidad con reserva de horario, pedidos con confirmación
administrativa, cobro, devolución del importe al cancelar, y noticias con historial.

**El cobro con tarjeta y con Bizum se puede ejercitar: `STRIPE_SECRET_KEY` está puesta.**
Lo que falta es `STRIPE_WEBHOOK_SECRET`, y su ausencia tiene una consecuencia concreta y
visible: un cobro real se completa en Stripe y **el pedido se queda en `pendiente`**,
porque quien lo marca como pagado es el webhook. No es un fallo del código; es la pieza que
falta. Bizum ya está activado en el panel de Stripe.

**PayPal está escrito y no se ha ejercitado nunca.** `PAYPAL_CLIENT_ID` y
`PAYPAL_CLIENT_SECRET` están vacías, así que cualquier intento falla al pedir el token.

**La recuperación de contraseña está completa y con proveedor.** `RESEND_API_KEY` y
`CORREO_REMITENTE` están puestas, así que el correo sale. Es el **único** correo del
sistema: no hay correo de confirmación de pedido ni de ningún otro suceso.

**El registro exige `profile` en el cuerpo de la petición**, con el nombre y los apellidos
dentro. Sin él responde `400 Datos no validos: profile`.

**La verificación automática es estática**: tipos, linter y formato. No hay tests en el
repositorio ni framework declarado; es una decisión del proyecto, no un descuido. Lo
funcional se comprueba a mano contra el servidor levantado.

Lo que falta por hacer está recogido en el
[Checklist de pendientes](#17-checklist-de-pendientes).

---

## 15b. Decisiones deliberadas

Cosas que parecen mejorables y no lo son. Están aquí para que nadie las «arregle»
sin saber por qué se hicieron así.

- **Todos los dominios tienen capa de servicio, también los que parecen un CRUD simple.**
  Noticias y servicios no la necesitaban por tamaño; la tienen por coherencia. Cuando dos
  dominios hermanos se escriben con formas distintas, una corrección hecha en uno no llega
  al otro, y eso ya había pasado aquí más de una vez.
- **`payments/` no tiene modelo ni rutas propias.** El cobro vive dentro del pedido y sus
  rutas cuelgan de `/api/pedidos`. No es un dominio a medio hacer: es un dominio cuyo
  agregado es el pedido.
- **El cliente de Stripe se crea bajo demanda, no al arrancar.** Así el `seed`, los
  scripts y el desarrollo sin pasarela no exigen claves; cualquier intento real de
  cobrar falla con un mensaje que dice qué variable falta. Mismo criterio que el
  cliente de R2.
- **`users/` está partido en cuatro controladores** (autenticación, identidad, perfil
  y direcciones, membresía y pagos). Cada uno cambia por motivos distintos; juntarlos
  crearía un fichero de mil líneas con cuatro razones para cambiar.
- **Los códigos de artículo son un espacio compartido entre productos y servicios.**
  Podría parecer que cada uno debería tener su propia numeración, pero un pedido
  mezcla ambos y el código es lo que permite distinguirlos en la misma línea.

---

## 16. Mantenimiento de esta documentación

Esta documentación representa el commit indicado en
[Estado documentado](#1-estado-documentado). Para actualizarla:

1. Usa `git log 627ec70..HEAD --oneline` solo para **localizar qué ha cambiado**.
2. Identifica qué secciones quedan afectadas.
3. **Lee el código actual** de esos módulos y documenta lo que hay ahora.
4. Actualiza solo esas secciones.
5. Cambia el commit y la fecha de referencia.

Este documento describe el **estado actual**, no cómo se llegó a él: no añadas
secciones de evolución, migraciones pasadas ni decisiones abandonadas. Si algo ya no
existe en el código, tampoco existe aquí.

Un cambio pequeño no justifica rehacer el mapa entero. Un cambio transversal de
arquitectura sí: vuelve a recorrer las áreas afectadas antes de escribir.

**Nunca escribas en este documento valores reales de variables sensibles.** Usa
marcadores: `<secret>`, `<database-url>`, `<api-key>`.

---

## 17. Checklist de pendientes

Cada línea con la evidencia que la demuestra. No incluye refactors ni mejoras de
calidad: solo funcionalidad que falta o integraciones sin terminar.

### Bloquean el uso en producción

- [ ] **Webhook de Stripe sin registrar.** `STRIPE_WEBHOOK_SECRET` está vacía. La clave
      secreta sí está, así que **se cobra de verdad**, pero nadie avisa al servidor: el
      pedido se queda en `pendiente` con el dinero ya cargado. Hay que dar de alta el
      endpoint en el panel apuntando a `/api/pedidos/webhook`, suscrito a
      `payment_intent.succeeded` y `payment_intent.payment_failed`, y copiar su secreto de
      firma. — `.env`, `src/payments/pago.controller.ts`
- [ ] **PayPal sin credenciales.** `PAYPAL_CLIENT_ID` y `PAYPAL_CLIENT_SECRET` están
      vacías. El código de los dos caminos (captura y webhook) está escrito y nunca se ha
      ejercitado. El botón lo ofrece el frontend. — `.env`, `src/payments/paypal.utils.ts`

### No bloquean

- [ ] **Webhook de PayPal sin registrar.** Depende del anterior. Cuando PayPal tenga
      credenciales, falta darlo de alta apuntando a `/api/pedidos/webhook/paypal`, suscrito
      a `CHECKOUT.ORDER.APPROVED`, y copiar su id en `PAYPAL_WEBHOOK_ID`. Sin él, un cliente
      que apruebe y no vuelva al sitio deja el pedido a medias. — panel de PayPal, `.env`
- [ ] **No hay correo de confirmación de pedido.** El único correo del sistema es el de
      recuperación de contraseña. Si se implementa, su sitio es `marcarPagado`.
      — `src/shared/correo.ts`, `src/payments/pago.service.ts`
- [ ] **El panel no puede borrar un pedido.** `DELETE /api/pedidos/:id` existe y es de
      admin, pero el frontend no tiene la llamada. Es coherente con la política —un pedido
      se cancela, no se borra—, así que solo se anota. — `src/orders/order.routes.ts`
- [ ] **Sin tests automatizados.** No hay framework declarado en `package.json` ni ficheros
      de prueba. Con tres métodos de pago y dos caminos de confirmación, la verificación
      funcional depende de ejercitar la API a mano. — `package.json`

### Cerrados

- [x] **Claves de Stripe y de Resend configuradas.** `STRIPE_SECRET_KEY` y `RESEND_API_KEY`
      ya tienen valor: se puede cobrar con tarjeta y sale el correo de recuperación. — `.env`
- [x] **Bizum activado en el panel de Stripe.** Se cobra a través de Stripe y ya está
      habilitado; no necesita variables propias. — panel de Stripe
- [x] **El registro exige `profile` y no está documentado.** Documentado en la referencia
      de endpoints, con los campos que lleva dentro. Responde con un 400 que nombra el
      campo. — `docs/api-endpoints.md`, `src/shared/controller.utils.ts`
- [x] **`api/index.ts` frente a declarar la función en `vercel.json`.** Decisión tomada:
      **se queda**. La propiedad `functions` de `vercel.json` solo admite globs que apunten
      dentro de `api/`, así que declarar `index.ts` de la raíz exigiría la propiedad
      `builds`, que es legado y desactiva los ajustes del panel. — `api/index.ts`,
      `vercel.json`
