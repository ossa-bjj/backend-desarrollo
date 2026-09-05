<div align="center">

# ⚙️ Arturo Salas Academy — API

### El motor que hay detrás de la web de la academia

Guarda los productos, las noticias, los pedidos y las reservas. Y cobra.

<br>

![Express](https://img.shields.io/badge/Express-5-000000?style=for-the-badge&logo=express&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Stripe](https://img.shields.io/badge/Stripe-635BFF?style=for-the-badge&logo=stripe&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)

</div>

---

## 👀 ¿Qué es esto?

Es **la parte que no se ve**. La web bonita está en
[`ossa-bjj/frontend`](https://github.com/ossa-bjj/frontend); esto es lo que hay debajo:
guarda los datos, comprueba quién eres, cobra con tarjeta y sirve las imágenes.

Vive en Vercel. Los datos, en MongoDB. Las fotos y archivos, en Cloudflare R2.

---

## 🧩 Qué sabe hacer

|     | Módulo             | De qué se ocupa                                    |
| :-: | ------------------ | -------------------------------------------------- |
| 👤  | **Usuarios**       | Registro, login y permisos                         |
| 🛍️  | **Productos**      | El catálogo de la tienda                           |
| 📦  | **Pedidos**        | La compra, el cobro y su estado                    |
| 🥋  | **Servicios**      | Clases, sesiones y seminarios                      |
| 📅  | **Disponibilidad** | Qué huecos quedan libres para reservar             |
| 📰  | **Noticias**       | Las publicaciones del club                         |
| 🖼️  | **Media**          | Sirve las imágenes guardadas en la nube            |

Todo cuelga de `/api`. Por ejemplo: `/api/productos`, `/api/pedidos`.

---

## 🚀 Ponerlo en marcha

Necesitas [Node.js](https://nodejs.org), `pnpm` y una base de datos MongoDB.

```bash
pnpm install
cp .env.example .env     # rellenar con valores reales
pnpm dev                 # ¡listo! → http://localhost:3000
```

> [!IMPORTANT]
> Al arrancar comprueba que estén `DB_URL`, `JWT_SECRET` y todas las `R2_*`. Si falta
> alguna **no arranca**, y te dice cuál es. Es a propósito.

---

## ⚙️ Configuración

```env
DB_URL=<direccion-de-la-base-de-datos>
JWT_SECRET=<secreto>
R2_ACCOUNT_ID=<id-de-cuenta>
R2_ACCESS_KEY_ID=<clave>
R2_SECRET_ACCESS_KEY=<clave-secreta>
R2_BUCKET_NAME=assets
R2_PUBLIC_DOMAIN=http://localhost:3000/api/media
ALLOWED_ORIGINS=http://localhost:5173
STRIPE_SECRET_KEY=<clave-secreta-de-stripe>
STRIPE_WEBHOOK_SECRET=<secreto-del-webhook>
PAYPAL_CLIENT_ID=<client-id>
PAYPAL_CLIENT_SECRET=<client-secret>
PAYPAL_ENTORNO=sandbox
PAYPAL_WEBHOOK_ID=<webhook-id>
RESEND_API_KEY=<api-key>
CORREO_REMITENTE=OSSA BJJ <no-reply@tudominio.com>
```

| Variable          | Para qué sirve                                          |
| ----------------- | ------------------------------------------------------- |
| `DB_URL`          | Dónde está la base de datos                             |
| `JWT_SECRET`      | Firma las sesiones de quien inicia sesión               |
| `R2_*`            | La nube donde viven las imágenes                        |
| `ALLOWED_ORIGINS` | Qué webs pueden llamar a esta API (separadas por comas, admite `*` como comodín) |
| `STRIPE_*`        | Cobrar con tarjeta y con Bizum                          |
| `PAYPAL_*`        | Cobrar con PayPal. `PAYPAL_ENTORNO=live` cobra de verdad; cualquier otro valor usa el sandbox. `PAYPAL_WEBHOOK_ID` verifica la firma de sus avisos: sin él el webhook se rechaza entero |
| `RESEND_API_KEY`  | Enviar el correo de recuperación de contraseña          |
| `CORREO_REMITENTE`| Remitente de ese correo, con el dominio verificado en Resend |

> [!NOTE]
> Las de Stripe, PayPal y correo **no se comprueban al arrancar**: el servidor funciona
> sin ellas. Sin las de pago, lo único que falla —con un mensaje claro— es intentar
> cobrar. Sin las de correo, la recuperación de contraseña responde con normalidad pero
> el correo no sale, y queda avisado en el log.

> [!IMPORTANT]
> **Bizum se cobra a través de Stripe**, no es una pasarela aparte y no tiene variables
> propias. Hay que activarlo en el panel de Stripe (*Configuración › Métodos de pago*).
> Solo admite euros y cuentas españolas.

> [!WARNING]
> La clave **secreta** de Stripe vive solo aquí y no sale nunca de este servidor. El
> frontend usa la publicable (`pk_`), que es otra cosa.

---

## 🧰 Comandos

| Comando          | Qué hace                                     |
| ---------------- | -------------------------------------------- |
| `pnpm dev`       | Arranca en local y se reinicia al guardar    |
| `pnpm verificar` | Comprueba los tipos sin generar nada         |
| `pnpm humo`      | Prueba de humo de la API (con `dev` en marcha) |
| `pnpm build`     | Compila a `dist/`                            |
| `pnpm start`     | Ejecuta lo compilado                         |
| `pnpm seed`      | Rellena la base con datos de prueba          |

### 🔥 Prueba de humo

`pnpm humo` lanza 54 comprobaciones contra el servidor local: autenticación, los CRUD,
el ciclo de un pedido con los tres métodos de pago y la recuperación de contraseña.
Necesita `pnpm dev` en otra terminal.

> [!WARNING]
> Escribe en la base a la que apunte tu `.env`. Crea sus propios registros y los borra
> al terminar, pero no la lances contra producción.

### 🌱 Datos de prueba

`pnpm seed` mete 5 usuarios, 25 productos y 5 servicios para poder trastear.

| Usuario           | Contraseña     | Rol           |
| ----------------- | -------------- | ------------- |
| `admin`           | `Admin1234!`   | administrador |
| `cliente_regular` | `Cliente1234!` | usuario       |

> [!CAUTION]
> **Antes de meter nada, vacía usuarios, productos y servicios.** No lo ejecutes sobre
> datos que te importen. Y esas contraseñas son solo para tu ordenador: nunca en
> producción.

---

## 💳 Probar los pagos en tu ordenador

Stripe avisa de que una tarjeta se ha cobrado llamando a este servidor. Para que ese
aviso llegue a tu máquina, hace falta la CLI de Stripe abierta en otra terminal:

```bash
stripe listen --forward-to localhost:3000/api/pedidos/webhook
```

Ese comando imprime un código que empieza por `whsec_`: ese es tu
`STRIPE_WEBHOOK_SECRET`.

> [!IMPORTANT]
> **Sin ese aviso, los pedidos se quedan sin pagar aunque Stripe acepte la tarjeta.**
> Quien marca el pedido como pagado es el aviso, no el navegador.

Para probar, la tarjeta `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC.

---

## 📖 ¿Quieres la chicha?

<div align="center">

### 👉 [**Manual completo del proyecto**](docs/project_documentation.md) 👈

### 📡 [**Referencia de todas las rutas**](docs/api-endpoints.md)

</div>

En el manual está todo lo serio: arquitectura, lógica de negocio, modelo de datos,
despliegue y **el checklist de lo que queda pendiente**.

> [!NOTE]
> Al desplegar: **primero este backend, después el frontend**. Las respuestas viajan
> envueltas en `{ success, data }`, y un frontend nuevo contra un backend viejo rompe
> el login.

---

<div align="center">
<sub>Hecho para <b>Arturo Salas Academy</b> 🥋</sub>
</div>
