# Arturo Salas Academy - Backend

Este es el repositorio de la API y backend para **Arturo Salas Academy**. Proporciona el soporte de base de datos, autenticación de usuarios, gestión de membresías, procesamiento de pedidos de la tienda (integrado con Stripe) y carga de archivos a través de Cloudinary.

## 🚀 Tecnologías Principales

*   **Entorno de Ejecución**: Node.js + TypeScript
*   **Framework**: Express (v5)
*   **Base de Datos**: MongoDB + Mongoose
*   **Autenticación**: JSON Web Tokens (JWT) + Bcryptjs
*   **Almacenamiento de Archivos**: Multer + Cloudinary
*   **Despliegue**: Optimizado para Vercel Serverless (`vercel.json`)
*   **Gestor de Paquetes**: `pnpm`

## 📁 Estructura del Proyecto

```text
backend/
├── api/                  # Punto de entrada para el despliegue serverless (Vercel)
├── docs/                 # Documentación técnica de la API
└── src/
    ├── orders/           # Rutas, modelos y controladores de Pedidos/Ordenes
    ├── products/         # Rutas, modelos y controladores de Productos
    ├── users/            # Rutas, modelos y controladores de Usuarios y Autenticación
    └── shared/           # Conectores de base de datos y utilidades compartidas
├── index.ts              # Punto de entrada principal para desarrollo local
├── seed.ts               # Script para poblar la base de datos con datos de prueba
└── tsconfig.json         # Configuración del compilador de TypeScript
```

## 🛠️ Comandos Disponibles

Asegúrate de tener instalado [pnpm](https://pnpm.io/) en tu entorno.

```bash
# Instalar dependencias
pnpm install

# Levantar servidor de desarrollo local (con reinicio automático)
pnpm dev

# Compilar el código a JavaScript
pnpm build

# Arrancar en entorno de producción
pnpm start

# Poblar base de datos local o remota con datos iniciales (Semillas de prueba)
pnpm seed
```

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

## 📄 Documentación Continua

Para consultar las especificaciones de las rutas de la API, modelos de datos y arquitectura, revisa la carpeta:
*   [docs/](file:///C:/Proyectos/ArturoSalasWEB/backend/docs)

---
**Repositorio definitivo**: [ossa-bjj/backend](https://github.com/ossa-bjj/backend)
