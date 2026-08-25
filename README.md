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
```

| Variable          | Para qué sirve                                          |
| ----------------- | ------------------------------------------------------- |
| `DB_URL`          | Dónde está la base de datos                             |
| `JWT_SECRET`      | Firma las sesiones de quien inicia sesión               |
| `R2_*`            | La nube donde viven las imágenes                        |
| `ALLOWED_ORIGINS` | Qué webs pueden llamar a esta API (separadas por comas) |
| `STRIPE_*`        | Para cobrar de verdad                                   |

> [!NOTE]
> Las dos de Stripe **no se comprueban al arrancar**: el servidor funciona sin ellas.
> Lo único que fallará, con un mensaje claro, es intentar cobrar.

> [!WARNING]
> La clave **secreta** de Stripe vive solo aquí y no sale nunca de este servidor. El
> frontend usa la publicable (`pk_`), que es otra cosa.

---

## 🧰 Comandos

| Comando       | Qué hace                                    |
| ------------- | ------------------------------------------- |
| `pnpm dev`    | Arranca en local y se reinicia al guardar   |
| `pnpm build`  | Compila a `dist/`                           |
| `pnpm start`  | Ejecuta lo compilado                        |
| `pnpm seed`   | Rellena la base con datos de prueba         |

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
