# Especificación de la API

Esta es la documentación de referencia de los endpoints expuestos por la API del backend de Arturo Salas Academy.

## 🔐 Autenticación y Usuarios (`/api/users`)

| Método | Endpoint | Descripción | Acceso |
| :--- | :--- | :--- | :--- |
| **POST** | `/api/users/register` | Registrar un nuevo usuario | Público |
| **POST** | `/api/users/login` | Iniciar sesión y obtener token JWT | Público |
| **GET** | `/api/users/me` | Obtener el perfil del usuario actual | Autenticado |
| **PUT** | `/api/users/me` | Actualizar el perfil del usuario actual | Autenticado |

### Roles de Usuario:
*   `USER` (Cliente regular o deportista no federado)
*   `PREMIUM` (Deportista federado)
*   `ADMIN` (Administrador del sistema)

---

## 🛒 Productos y Tienda (`/api/productos`)

| Método | Endpoint | Descripción | Acceso |
| :--- | :--- | :--- | :--- |
| **GET** | `/api/productos` | Obtener lista de productos con filtros y paginación | Público |
| **GET** | `/api/productos/:id` | Obtener detalles de un producto específico | Público |
| **POST** | `/api/productos` | Crear un nuevo producto (con imágenes) | Admin |
| **PUT** | `/api/productos/:id` | Actualizar datos del producto | Admin |
| **DELETE** | `/api/productos/:id` | Eliminar un producto del catálogo | Admin |

---

## 📦 Pedidos y Facturación (`/api/pedidos`)

| Método | Endpoint | Descripción | Acceso |
| :--- | :--- | :--- | :--- |
| **POST** | `/api/pedidos` | Crear un pedido con sesión de Stripe Checkout | Autenticado |
| **GET** | `/api/pedidos/mis-pedidos` | Obtener el historial de pedidos del usuario actual | Autenticado |
| **GET** | `/api/pedidos/:id` | Obtener detalles de un pedido específico | Autenticado/Admin |
| **POST** | `/api/pedidos/webhook` | Webhook de Stripe para confirmación de pagos | Público (Stripe) |

---

## 🗄️ Modelos de Base de Datos (Mongoose)

### 1. Usuario (`User`)
Almacena credenciales encriptadas, información de perfil, direcciones, estado de deportista (club, federación) y el estado/historial de pagos de su membresía recurrente.

### 2. Producto (`ProductoModelo`)
Almacena el código del artículo, nombre, precio, descripción, stock actual, categoría, subcategoría, marca, etiquetas y array de URLs de imágenes alojadas en Cloudinary.

### 3. Pedido (`Order`)
Almacena los productos comprados, cantidades, precio unitario histórico, total pagado, ID de pago de Stripe, dirección de envío y estado de entrega.
