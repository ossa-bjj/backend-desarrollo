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

| | |
| --- | --- |
| **Rama** | `desarrollo` |
| **Commit** | `e5557b1` |
| **Fecha** | 2026-08-25 |

Esta documentación describe el backend tal y como está en ese commit. Todo lo que
afirma se ha comprobado leyendo el código, la configuración o ejercitando la API en
local; donde algo no se ha podido confirmar, se dice.

---

## 2. Qué es el proyecto

API HTTP de la academia de BJJ y Grappling de Arturo Salas. Cubre cuatro cosas:

- **Tienda** — catálogo de productos físicos (guantes, ropa, calzado) con carga de
  imágenes.
- **Servicios** — sesiones de coaching, mentorías y seminarios, con reserva de horario.
- **Pedidos y cobro** — carrito mixto de productos y servicios, con confirmación
  administrativa cuando hace falta tarificar, y cobro con Stripe.
- **Contenido** — noticias del club con historial de cambios.

Sirve a un frontend React que vive en un repositorio separado (`ossa-bjj/frontend`).

---

## 3. Arquitectura

Express sobre MongoDB, desplegado como función serverless en Vercel. No hay capa de
servicios generalizada: cada dominio es **modelo + controlador + rutas**, y la lógica
vive en el controlador. La única excepción es `availability/`, que sí tiene un
`disponibilidad.service.ts` porque su lógica la comparten pedidos y pagos.

```text
Cliente (frontend React)
  ↓ HTTP
index.ts                    validación de entorno, CORS, conexión perezosa a Mongo
  ↓
router del dominio          /api/users · /api/productos · /api/pedidos ·
  ↓                         /api/servicios · /api/disponibilidad · /api/noticias
controlador                 valida, aplica reglas, responde { success, data }
  ↓
modelo Mongoose
  ↓
MongoDB Atlas
```

Dos integraciones externas: **Cloudflare R2** para archivos e imágenes (a través de un
proxy propio, ver [Visita guiada](#14-visita-guiada)) y **Stripe** para el cobro.

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
├── seed.ts                   Datos de ejemplo: 5 usuarios, 25 productos, 5 servicios
├── src/
│   ├── availability/         Huecos reservables y retención de horarios
│   ├── news/                 Noticias con historial de cambios
│   ├── orders/               Pedidos y confirmación de presupuestos
│   ├── payments/             Stripe: PaymentIntent y webhook
│   ├── products/             Productos y carga de imágenes
│   ├── services/             Servicios vendibles (códigos 60XX)
│   ├── users/                Usuarios, perfiles y membresías
│   └── shared/               DB, JWT, R2, entorno y middleware compartido
├── docs/
│   ├── api-endpoints.md      Referencia de rutas
│   └── project_documentation.md   Este documento
├── vercel.json               Reescritura de todo el tráfico hacia /api
└── .env.example              Plantilla de variables
```

Cada carpeta de `src/` sigue el mismo patrón: `<dominio>.model.ts`,
`<dominio>.controller.ts`, `<dominio>.routes.ts`. Quien conoce uno se orienta en los
demás.

`shared/` contiene lo transversal: `db.ts` (conexión cacheada), `token.utils.ts` (JWT
y la declaración global de `Request.user`), `auth.middleware.ts` (`isAuth`, `isAdmin`,
`optionalAuth`), `r2.utils.ts` (Cloudflare R2), `env.ts` (validación de arranque),
`file.middleware.ts` (Multer en memoria) y `controller.utils.ts` (errores y permisos).

---

## 5. Lógica de negocio

### 5.1 Códigos de artículo

Productos y servicios **comparten el espacio de `codigoArticulo`**, un entero de cuatro
dígitos cuyo prefijo indica la categoría:

| Prefijo | Categoría |
| --- | --- |
| `10XX` | Ropa de entrenamiento |
| `20XX` | Protecciones |
| `30XX` | Ropa de calle |
| `40XX` | Accesorios |
| `50XX` | Calzado |
| `60XX` | **Servicios** (rango 6000–6999, validado en el esquema) |

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
                            ↓ Stripe + webhook
                         pagado → preparando → enviado → entregado
                            ↓
                        cancelado
```

**Un pedido nace en uno de dos estados**, según lleve o no algún servicio marcado con
`requiereConfirmacion`:

- Sin servicios que confirmar → nace `pendiente`, ya es pagable.
- Con alguno → nace `pendiente_confirmacion`. El total del catálogo es orientativo; un
  admin lo revisa, ajusta precios línea a línea y lo confirma o lo rechaza.

`ESTADOS_NO_PAGABLES` (`pendiente_confirmacion`, `cancelado`, `rechazado`) es la lista
que consulta `pago.controller.ts` antes de crear un PaymentIntent: un intento de pagar
en esos estados devuelve `409`.

**El total lo calcula siempre el servidor** con los precios vigentes en el momento de
crear el pedido. Lo que envíe el cliente no se usa.

### 5.3 Reserva de horarios

Un servicio con `requiereReserva` consume huecos de la colección `Disponibilidad`. El
mecanismo tiene tres fases y está en `src/availability/disponibilidad.service.ts`:

1. **Retener** (`retenerSlots`) — al crear el pedido, los huecos pasan a `ocupado` con
   un `retenidoHasta` y el `pedidoId`. Es una retención con caducidad.
2. **Consolidar** (`consolidarSlotsDePedido`) — cuando el webhook confirma el pago, se
   quita la caducidad. A partir de ahí el horario solo se libera cancelando.
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

### 5.5 Permisos

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

### 5.6 Noticias

Una noticia **nace siempre como borrador** (`publicada: false`) y no aparece en el
listado público hasta que un admin la publica explícitamente con
`PATCH /:id/publicar`.

Cada cambio añade una entrada a `historial` con la acción (`creada`, `editada`,
`publicada`, `despublicada`), el autor y una foto del título, el contenido y el estado
en ese momento. Es un registro de auditoría: se añade, nunca se edita.

---

## 6. Modelo de datos

MongoDB con Mongoose. Seis colecciones:

```text
User ──1:N──→ Order ──1:N──→ OrderItem (embebido)
 │                              │
 │                              └──→ Disponibilidad (por slotId)
 │
 └──1:N──→ Noticia (como autor)

Producto        independiente, referenciado por codigoArticulo
Servicio        independiente, referenciado por codigoArticulo
Disponibilidad  ──N:1──→ Servicio
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
├── user            referencia a User
├── items[]         { tipo, codigoArticulo, nombre, precio, cantidad, slotId }
├── total           calculado por el servidor
├── status          uno de los ocho estados
├── pago            { proveedor, estado, referencia }
└── motivoRechazo   solo cuando status = rechazado
```

Cada línea tiene una **identidad compuesta** (`identidadLinea`): dos reservas del mismo
servicio a horas distintas son dos líneas separadas, no una con cantidad 2. Ver
[Visita guiada](#14-visita-guiada).

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
├── titulo, extracto, contenido, imagenPortada
├── categoria       EVENTO | RESULTADO | CLUB | PROMOCION | GENERAL
├── fechaEvento, horaInicio, horaFin, lugar    (solo tienen sentido en EVENTO)
├── publicada       nace en false
├── autor           referencia a User
└── historial[]     { fecha, autor, accion, snapshot }
```

### Semilla

`seed.ts` limpia las colecciones de usuarios, productos y servicios e inserta 5
usuarios, 25 productos y 5 servicios de ejemplo. **Borra lo que haya**: no ejecutarlo
sobre datos que importen.

---

## 7. Tecnologías

| Tecnología | Uso |
| --- | --- |
| Express 5 | API HTTP |
| TypeScript 6 | Lenguaje |
| MongoDB + Mongoose 8 | Persistencia y esquemas |
| JSON Web Token | Sesión sin estado (8 h de vigencia) |
| bcryptjs | Hash de contraseñas |
| Stripe 22 | Cobro con tarjeta (PaymentIntent + webhook) |
| `@aws-sdk/client-s3` | Cliente de Cloudflare R2 (API compatible con S3) |
| Multer 2 | Recepción de archivos en memoria antes de subirlos a R2 |
| cors | Origen configurable por entorno |
| dotenv | Carga de `.env` en local |
| ts-node-dev | Recarga en desarrollo |

No hay framework de tests instalado.

---

## 8. Configuración

Todas las variables se leen de `.env` en local y del panel de Vercel en producción.
`src/shared/env.ts` **valida al arrancar** y aborta si falta alguna obligatoria.

| Variable | Propósito | Obligatoria |
| --- | --- | --- |
| `DB_URL` | Cadena de conexión a MongoDB | Sí |
| `JWT_SECRET` | Firma de los tokens de sesión | Sí |
| `R2_ACCOUNT_ID` | Cuenta de Cloudflare R2 | Sí |
| `R2_ACCESS_KEY_ID` | Credencial de R2 | Sí |
| `R2_SECRET_ACCESS_KEY` | Credencial de R2 | Sí |
| `R2_BUCKET_NAME` | Bucket de archivos | Sí |
| `R2_PUBLIC_DOMAIN` | Base pública de las URL de archivo | Sí |
| `PORT` | Puerto HTTP local (por defecto 3000) | No |
| `ENVIRONMENT` | `development` o `production` | No |
| `ALLOWED_ORIGINS` | Orígenes CORS separados por coma; `*` permite todos | No |
| `STRIPE_SECRET_KEY` | Clave secreta de Stripe | No — sin ella no se puede cobrar |
| `STRIPE_WEBHOOK_SECRET` | Secreto de firma del webhook | No — sin él el webhook rechaza |

Las dos de Stripe **no bloquean el arranque**, pero sin ellas la pasarela no funciona.
En el `.env` local actual están vacías.

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
- pnpm 11.
- Una base MongoDB accesible (Atlas o local).
- Un bucket de Cloudflare R2 con sus credenciales.

### Pasos

```bash
pnpm install
cp .env.example .env
# rellenar .env con los valores reales
```

Para poblar la base con datos de ejemplo:

```bash
pnpm seed
```

---

## 10. Ejecución

### Desarrollo

```bash
pnpm dev          # ts-node-dev con recarga, en http://localhost:3000
```

### Producción

```bash
pnpm build        # tsc → dist/
pnpm start        # node dist/index.js
```

`index.ts` solo llama a `listen()` cuando se ejecuta directamente
(`require.main === module`). Así el mismo fichero sirve en local y como función
serverless.

---

## 11. Tests

**En el estado revisado no existen tests automatizados en este repositorio.** No hay
framework de pruebas declarado en `package.json` ni ficheros `*.test.ts` o `*.spec.ts`.

La verificación disponible hoy es la comprobación de tipos:

```bash
npx tsc --noEmit
```

---

## 12. API

Todas las rutas cuelgan de `/api`. La referencia completa está en
[`docs/api-endpoints.md`](./api-endpoints.md); aquí van la forma de las respuestas y
los grupos.

### Forma de la respuesta

Éxito:

```json
{ "success": true, "data": { } }
```

Error:

```json
{ "error": "Mensaje legible", "detail": "opcional" }
```

Códigos usados: `400` datos inválidos, `401` sin token, `403` sin permiso, `404` no
encontrado, `409` conflicto de estado, `500` error interno.

### Grupos

| Prefijo | Dominio |
| --- | --- |
| `/api/users` | Registro, login, perfil, direcciones, membresías, administración |
| `/api/productos` | Catálogo, CRUD e imágenes |
| `/api/servicios` | Catálogo de servicios, CRUD e imágenes |
| `/api/disponibilidad` | Consulta de huecos, generación por lotes, bloqueo |
| `/api/pedidos` | Carrito, confirmación, cambio de estado y cobro |
| `/api/noticias` | Listado público, administración y publicación |
| `/api/media/*` | Proxy de lectura de archivos de R2 |

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
    └── Stripe              (STRIPE_*)
```

`vercel.json` reescribe todo el tráfico (`/(.*)`) hacia `/api`, y Vercel descubre
automáticamente `api/index.ts` como la función.

> **Sobre `api/index.ts`.** Es una sola línea que reexporta la app. Parece un resto
> suelto y no lo es: mientras `vercel.json` no declare la función explícitamente, es lo
> único que crea el endpoint.

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
ocupado *sólo si* sigue disponible»—. MongoDB garantiza que esa operación es atómica
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
ser **código más horario** (`identidadLinea` en `order.model.ts`).

**Qué complejidad es accidental.** Que la misma regla esté escrita también en el
frontend (`utils/identidadLinea.ts`). Las dos deben producir cadenas idénticas o el
ajuste del admin no encuentra su línea, **en silencio**.

**Qué hay que saber para tocarlo.** Es un contrato entre dos repositorios. Si algún día
se reserva también sala o entrenador, hay que cambiarlo en los dos a la vez.

### C. El cobro no lo confirma el navegador

**Qué hace.** Marca un pedido como pagado.

**Por qué existe.** Que Stripe acepte la tarjeta en el navegador no significa que el
dinero esté cobrado: la respuesta del navegador se puede perder, falsear o interrumpir.

**Cómo funciona.** El backend crea un PaymentIntent y devuelve un `clientSecret`. El
navegador cobra con él y **no decide nada más**. Quien marca el pedido como `pagado` es
el **webhook** de Stripe (`payment_intent.succeeded`), que llega servidor a servidor y
va firmado. Ese mismo webhook consolida los horarios retenidos.

**Qué hay que saber para tocarlo.** El webhook necesita el cuerpo **sin parsear** para
verificar la firma: por eso `index.ts` monta `express.raw()` en
`/api/pedidos/webhook` **antes** de `express.json()`. Ese orden no es cosmético; al
revés, la firma no valida nunca. Y el manejador es idempotente: si el pedido ya está
`pagado`, sale sin hacer nada.

### D. Las imágenes no se sirven desde R2

**Qué hace.** Entrega las imágenes de productos, servicios y noticias.

**Por qué existe.** El bucket de R2 no es público. Exponerlo obligaría a gestionar
dominio propio y permisos de lectura anónima.

**Cómo funciona.** El backend expone `/api/media/*`, lee el objeto de R2 y hace `pipe`
del stream a la respuesta, con `Cache-Control` de un año e `immutable` — las claves
llevan marca de tiempo, así que un fichero nunca cambia de contenido. Si R2 responde
`NoSuchKey`, el proxy devuelve `404`.

**Qué hay que saber para tocarlo.** En base de datos se guarda solo la *key* del objeto
(`uploads/…`), nunca la URL completa: la URL pública se compone al leer con el
`R2_PUBLIC_DOMAIN` del entorno, en el `toJSON` de cada modelo. Cambiar de dominio no
exige migrar datos. Las filas antiguas guardaban la URL absoluta del entorno donde se
subió el fichero; `normalizarUrlMedia` les extrae la key venga del dominio que venga, así
que conviven ambos formatos. Por el mismo motivo `keyFromPublicUrl` no depende de
`R2_PUBLIC_DOMAIN`: si dependiera, al cambiar de dominio dejaría de reconocer las URL
antiguas y los borrados fallarían en silencio, dejando huérfanos en el bucket.

La única clave sin marca de tiempo es `defaults/nodisponible.jpg`, que la semilla
sobrescribe en cada ejecución para no acumular una copia por siembra. Al servirse con
`immutable`, un cambio de esa imagen tardaría en propagarse a los navegadores que ya la
tengan cacheada.

---

## 15. Estado actual

Los seis dominios están implementados y responden: registro y login, perfil y
direcciones, permisos por rol, catálogo de productos y de servicios con carga de
imágenes, parrilla de disponibilidad con reserva de horario, pedidos con confirmación
administrativa, cobro con tarjeta y noticias con historial. Comprobado en local contra
MongoDB Atlas.

**El único método de pago operativo es Stripe.** El servidor rechaza cualquier otro
proveedor con `400`. En el `.env` local las dos claves de Stripe están vacías, así que
la pasarela no se puede ejercitar sin rellenarlas.

**La recuperación de contraseña genera el token pero no lo entrega**: no hay envío de
correo implementado.

**El registro exige `profile` en el cuerpo de la petición.** Sin él Mongoose rechaza
con `Path 'profile' is required`, y el `.env.example` no lo menciona.

No hay tests automatizados en el repositorio.

Lo que falta por hacer está recogido en el
[Checklist de pendientes](#17-checklist-de-pendientes).

---

## 15b. Decisiones deliberadas

Cosas que parecen mejorables y no lo son. Están aquí para que nadie las «arregle»
sin saber por qué se hicieron así.

- **`availability/` es el único dominio con capa de servicio.** No es una
  inconsistencia: su lógica la comparten pedidos y pagos, y por eso vive fuera del
  controlador. Los demás dominios no la necesitan. Es el patrón a copiar cuando otro
  dominio llegue a tener consumidores múltiples.
- **El cliente de Stripe se crea bajo demanda, no al arrancar.** Así el `seed`, los
  scripts y el desarrollo sin pasarela no exigen claves; cualquier intento real de
  cobrar falla con un mensaje que dice qué variable falta. Mismo criterio que el
  cliente de R2.
- **`users/` está partido en cuatro controladores** (autenticación, identidad, perfil
  y direcciones, membresía y pagos). Cada uno cambia por motivos distintos; juntarlos
  crearía un fichero de mil líneas con cuatro razones para cambiar.
- **`seed.ts` es el fichero más largo del repositorio y no es un problema.** De sus
  770 líneas, unas 700 son datos literales y unas 45 lógica. Es una tabla de datos, y
  las tablas de datos son largas. No hace falta trocearlo.
- **Los códigos de artículo son un espacio compartido entre productos y servicios.**
  Podría parecer que cada uno debería tener su propia numeración, pero un pedido
  mezcla ambos y el código es lo que permite distinguirlos en la misma línea.

---

## 16. Mantenimiento de esta documentación

Esta documentación representa el commit indicado en
[Estado documentado](#1-estado-documentado). Para actualizarla:

1. Usa `git log e5557b1..HEAD --oneline` solo para **localizar qué ha cambiado**.
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

- [ ] **PayPal y Bizum no cobran.** El frontend los ofrece en el selector de método de
      pago; el servidor solo acepta `stripe` y devuelve `400` con cualquier otro
      proveedor. Un cliente puede creer que ha pagado. — `src/payments/pago.controller.ts`
- [ ] **Sin claves de Stripe configuradas en local.** `STRIPE_SECRET_KEY` y
      `STRIPE_WEBHOOK_SECRET` están vacías, así que ni el cobro ni el webhook se pueden
      probar. — `.env`, `src/payments/stripe.utils.ts`

### No bloquean

- [ ] **El correo de recuperación de contraseña no se envía.** El token se genera y se
      guarda, pero no sale del servidor. — `src/users/auth.controller.ts:116`
- [ ] **El registro exige `profile` y no está documentado.** Una petición sin ese campo
      falla con `Path 'profile' is required`. — `src/users/auth.controller.ts`,
      `.env.example`
- [ ] **Sin tests automatizados.** No hay framework declarado en `package.json` ni
      ficheros `*.test.ts` o `*.spec.ts` en el repositorio.
- [ ] **`api/index.ts` frente a declarar la función en `vercel.json`.** Hoy el endpoint
      existe por el descubrimiento automático de Vercel. Declararlo explícitamente
      permitiría borrar la carpeta. Decisión de infraestructura sin tomar. —
      `api/index.ts`, `vercel.json`
