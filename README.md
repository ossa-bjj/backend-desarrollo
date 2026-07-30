# Arturo Salas Academy - Backend

Este es el repositorio de la API y backend para **Arturo Salas Academy**. Proporciona el soporte de base de datos, autenticación de usuarios, gestión de membresías, procesamiento de pedidos de la tienda (integrado con Stripe) y carga de archivos a través de Cloudinary.

## 🚀 Tecnologías Principales

*   **Entorno de Ejecución**: Node.js + TypeScript
*   **Framework**: Express (v5)
*   **Base de Datos**: MongoDB + Mongoose
*   **Autenticación**: JSON Web Tokens (JWT) + Bcryptjs
*   **Almacenamiento de Archivos**: Multer + Cloudinary
*   **Despliegue**: Cloudflare Workers (`wrangler`) + Vercel Serverless (`api/index.ts`)
*   **Gestor de Paquetes**: `pnpm` (obligatorio para mantener `pnpm-lock.yaml` en CI/CD)

## 📁 Estructura del Proyecto

```text
backend/
├── api/                  # Punto de entrada para el despliegue serverless (Vercel)
├── docs/                 # Documentación técnica de la API
├── src/
│   ├── orders/           # Rutas, modelos y controladores de Pedidos/Ordenes
│   ├── products/         # Rutas, modelos y controladores de Productos
│   ├── users/            # Rutas, modelos y controladores de Usuarios y Autenticación
│   └── shared/           # Conectores de base de datos y utilidades compartidas
├── index.ts              # Punto de entrada principal (Express + Serverless Handler para Cloudflare)
├── seed.ts               # Script para poblar la base de datos con datos de prueba
├── tsconfig.json         # Configuración de TypeScript en formato ESM (ESNext)
└── wrangler.toml         # Configuración de despliegue en Cloudflare Workers
```

## 🛠️ Comandos Disponibles

> ⚠️ **IMPORTANTE**: Usa siempre `pnpm` en lugar de `npm` para instalar dependencias y evitar desincronizaciones del archivo `pnpm-lock.yaml`.

```bash
# Instalar dependencias
pnpm install

# Instalar nueva dependencia (ejemplo)
pnpm add <nombre-paquete>
pnpm add -D <nombre-paquete>

# Levantar servidor de desarrollo local
pnpm dev

# Compilar TypeScript a JavaScript
pnpm build

# Probar compilación para Cloudflare Workers sin desplegar
npx wrangler deploy --dry-run

# Desplegar manualmente a Cloudflare Workers
npx wrangler deploy
```

## ☁️ Despliegue en Cloudflare Workers

El backend está adaptado para ejecutarse en la infraestructura de V8 Isolates de **Cloudflare Workers**.

### 1. Cambios Arquitectónicos Implementados

* **Formato ES Modules (ESM)**:
  `tsconfig.json` está configurado con `"module": "ESNext"` y `"moduleResolution": "bundler"`. Cloudflare Workers requiere sintaxis ESM nativa (`import` / `export`).
* **Compatibilidad con Node.js (`nodejs_compat`)**:
  En `wrangler.toml` está activa la bandera `compatibility_flags = ["nodejs_compat"]`, lo que permite el uso de módulos nativos de Node.js (`crypto`, `events`, `buffer`, `fs`, `path`, `stream`, etc.) y librerías como Mongoose, Bcryptjs y Cloudinary.
* **Manejador `fetch` con `serverless-http`**:
  Cloudflare Workers no ejecuta `app.listen()`. Las peticiones HTTP entrantes son recibidas por la función `fetch(request, env)`. Usamos `serverless-http` en `index.ts` para adaptar la aplicación Express a las peticiones del Worker:
  ```typescript
  import serverless from 'serverless-http';
  const handler = serverless(app);

  export default {
    async fetch(request: any, env: any) {
      return handler(request, env) as unknown as Response;
    }
  };
  ```
* **Importaciones estrictas ESM**:
  Toda la aplicación utiliza exclusivamente `import` y `export default`. Se eliminaron llamadas a `require()` o `module.exports` para prevenir errores de interoperabilidad (`TypeError: upload.array is not a function`).
* **Guarda para ejecución local**:
  La inicialización del servidor local (`app.listen()`) en `index.ts` está protegida por:
  ```typescript
  if (typeof module !== 'undefined' && typeof require !== 'undefined' && require.main === module)
  ```
  Evitando el error `ReferenceError: module is not defined` en el runtime de Cloudflare Workers.

### 2. Configuración en el Panel de Cloudflare (CI / CD)

En **Cloudflare Dashboard** -> **Workers & Pages** -> **backend** -> **Settings**:

* **Build command (Comando de construcción)**: `pnpm run build`
* **Deploy command (Comando de despliegue)**: `npx wrangler deploy` *(No añadir rutas ni banderas extras como `dist/index.js` ni `--compatibility-flag`, ya que están definidas en `wrangler.toml`)*.
* **Variables de Entorno (CI)**: `NPM_FLAGS = --no-frozen-lockfile` (permite instalar dependencias si hay ligeros desajustes en CI).

---

## ⚙️ Configuración del Entorno (`.env`)

Crea un archivo `.env` en la raíz del proyecto basado en `.env.example`:

```env
PORT=3000
DB_URL=mongodb+srv://...
DATABASE_USER=tu_usuario_mongodb
DATABASE_PASS=tu_contraseña_mongodb
JWT_SECRET=tu_secreto_para_tokens_jwt
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret
ALLOWED_ORIGINS=http://localhost:5173,https://tudominio.com
```

## 🛠️ Guía de Solución de Problemas (Troubleshooting)

Si en el futuro algún despliegue falla en Cloudflare, consulta esta lista de comprobación:

1. **Error `[ERR_PNPM_OUTDATED_LOCKFILE]`**:
   - *Causa*: Se modificó `package.json` sin actualizar `pnpm-lock.yaml`.
   - *Solución*: Ejecuta `pnpm install` en tu terminal local, haz commit de `pnpm-lock.yaml` y haz `git push`.
2. **Error `No such compatibility flag: dist/index.js`**:
   - *Causa*: El comando de despliegue en Cloudflare Dashboard tiene argumentos extra.
   - *Solución*: Cambia el **Deploy command** en Cloudflare Dashboard a simplemente `npx wrangler deploy`.
3. **Error `The uploaded script has no registered event handlers`**:
   - *Causa*: Falta el objeto `export default { fetch }` en `index.ts`.
   - *Solución*: Verifica que `index.ts` mantenga el adaptador `serverless-http` exportando la propiedad `fetch`.
4. **Error `Uncaught ReferenceError: module is not defined`**:
   - *Causa*: Se usó la variable global `module` sin verificar si existe en el entorno ESM de Cloudflare.
   - *Solución*: Protege la evaluación con `typeof module !== 'undefined'`.

## 📄 Documentación Continua

Para consultar las especificaciones de las rutas de la API, modelos de datos y arquitectura, revisa la carpeta:
*   [docs/](file:///C:/Proyectos/ArturoSalasWEB/backend/docs)

---
**Repositorio definitivo**: [ossa-bjj/backend](https://github.com/ossa-bjj/backend)
