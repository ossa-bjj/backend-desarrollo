# Calidad del backend — backlog de tickets

Revisión de calidad estructural del backend: cohesión de módulos, legibilidad, olores de código, sobreingeniería y restos legacy. **No cubre corrección funcional ni seguridad**; esos hallazgos van por separado.

- **Alcance:** rama `desarrollo`, estado completo del módulo (no un diff). 28 ficheros, 4.557 líneas: los 9 controladores, los 5 modelos, `disponibilidad.service.ts`, todo `shared/`, `stripe.utils.ts`, `index.ts`, `api/index.ts` y las 5 tablas de rutas. `seed.ts` revisado por estructura, no dato a dato.
- **Revisado, con decisión abierta:** `api/index.ts` (una línea, `export { default } from '../index'`) es hoy la entrada serverless. Funciona por el descubrimiento automático de Vercel: todo fichero bajo `api/` es un endpoint, y `vercel.json` reescribe `/(.*)` hacia `/api`. **No es obligatorio.** La alternativa es declarar la función en `vercel.json` apuntando a `index.ts` y borrar la carpeta. Mientras `vercel.json` no lo declare, borrar el fichero sin más deja el despliegue sin endpoint. Decisión de infraestructura, no de este backlog.
- **Fecha:** 2026-08-24
- **Fuera de alcance:** dependencias, `tsconfig`, validez de los datos del seed, y la coherencia con el frontend salvo donde un ticket la toca explícitamente.

## Cómo usar este documento

Cada ticket es autónomo salvo donde diga lo contrario. La tabla está ordenada por **orden de ejecución sugerido**, no por gravedad: primero lo que se puede cerrar hoy sin coordinar con nadie.

Marca la casilla del ticket al cerrarlo. Un ticket está cerrado cuando cumple sus criterios de aceptación **y** `npx tsc --noEmit` sigue en 0.

## Resumen

| ID | Ticket | Coste | Ficheros | Riesgo | Estado |
|---|---|---|---|---|---|
| [CAL-01](#cal-01) | Migrar `producto.controller.ts` al patrón vigente | Alto | 1 | Bajo | ✅ Cerrado |
| [CAL-02](#cal-02) | Unificar la comprobación de permisos | Alto | 5 | Bajo | ✅ Cerrado |
| [CAL-03](#cal-03) | Borrar exportaciones muertas | Bajo | 3 | Ninguno | ✅ Cerrado |
| [CAL-04](#cal-04) | Renombrar `auth.routes.ts` → `user.routes.ts` | Bajo | 2 | Ninguno | ✅ Cerrado |
| [CAL-05](#cal-05) | Corregir los mensajes de error en voseo | Medio | 3 | Ninguno | ✅ Cerrado |
| [CAL-06](#cal-06) | Unificar el vocabulario de nombres | Medio | varios | Medio | ✅ Cerrado |
| [CAL-07](#cal-07) | Renombrar `getXById` a lo que realmente hacen | Bajo | 2 | Bajo | ✅ Cerrado |
| [CAL-08](#cal-08) | Dar nombre propio a la identidad de línea de pedido | Medio | 2 | Medio | ✅ Cerrado |
| [CAL-09](#cal-09) | Unificar el envoltorio de respuesta | Alto | 4 + frontend | **Alto** | ✅ Cerrado |

**Los nueve tickets están cerrados** (2026-08-24). `npx tsc --noEmit` en 0 en el backend; `pnpm lint` y `pnpm build` en 0 en el frontend.

CAL-09 cambió el contrato de la API, así que también tocó el repo del frontend. **Backend y frontend deben desplegarse juntos, backend primero.**

> **Nada de esto está commiteado.** Al cerrar la sesión del 2026-08-24 el trabajo vive en el árbol de trabajo: 19 ficheros modificados, 1 renombrado y este documento sin trackear. Ver [`docs/ESTADO.md`](../../docs/ESTADO.md) en la carpeta contenedora para el estado completo de los dos repositorios y lo que queda pendiente.

---

## Estado general

Es un backend sano y, en sus partes recientes, notablemente bien escrito: los módulos de disponibilidad, pedidos y pagos tienen comentarios que explican *por qué* se hizo así, invariantes documentadas y decisiones difíciles resueltas con criterio. No hay código comentado, no hay ficheros dios reales, y el corte en módulos por dominio es correcto y se sostendría al crecer.

El riesgo de mantenimiento no estaba en ningún fichero concreto: estaba en que **el proyecto llevaba dos convenciones a la vez** y nada indicaba cuál ganaba. Había dos formas de manejar errores, dos formas de responder, dos idiomas para nombrar y cinco copias de la regla de permisos. La zona nueva era claramente mejor que la vieja, pero la vieja seguía viva justo en el módulo que más se toca: productos, la tienda.

**Resuelto en la tanda del 2026-08-24.** Hoy hay una sola forma de manejar errores (`sendServerError`), un solo envoltorio de respuesta, una sola implementación de la regla de permisos, y el idioma de cada módulo está fijado por escrito en el README. El apartado *Convenciones* del README es ahora la referencia; este documento queda como registro de por qué se decidió cada cosa.

---

## Tickets

### CAL-01

**Migrar `producto.controller.ts` al patrón vigente** · Coste alto · Riesgo bajo · Independiente

- [x] **Cerrado** (2026-08-24)

**Qué pasa.** Ocho de los nueve controladores usan `sendServerError` de `shared/controller.utils`. `src/products/producto.controller.ts` es el único que quedó en el patrón viejo: `next(error)` once veces, y además un 500 inline suelto en la línea 63 que ni siquiera es coherente con su propio fichero.

Arrastra otros dos defectos del mismo origen:

- **Reimplementa un helper que ya existe.** Las líneas 144-152 extraen la key de R2 desde la URL pública con nueve líneas inline. `keyFromPublicUrl` hace exactamente eso en `src/shared/r2.utils.ts:78`, y `servicio.controller.ts` sí lo usa, dos veces.
- **No valida nada de lo que su gemelo sí valida.** `servicio.controller.ts` tiene `parseCodigo` con comprobación de rango, `codigoInvalido`, `noEncontrado`, `esDuplicado`→409, y en `updateServicio` descarta `codigoArticulo` del body porque es la identidad del recurso. `producto.controller.ts:71-75` pasa `req.body` entero a `findOneAndUpdate`.

**Qué cuesta.** El manejador global de errores de `index.ts:105` responde siempre `'Error interno del servidor'` sin detalle. Los fallos de productos se diagnostican a ciegas mientras los del resto del backend devuelven el mensaje real. Y quien añada un endpoint a la tienda copiará el patrón muerto, porque es el único ejemplo que tiene delante.

**Dirección.** `servicio.controller.ts` es literalmente el gemelo de productos escrito bien. Úsalo como plantilla, no inventes un tercer patrón.

**Criterios de aceptación**

- `grep -c "next(error)" src/products/producto.controller.ts` devuelve 0.
- No queda ningún `res.status(500)` inline en el fichero.
- La extracción de key usa `keyFromPublicUrl`, sin copia local.
- `updateProducto` no permite reasignar `codigoArticulo` desde el body.
- Existe validación del código de artículo equivalente a `parseCodigo`.
- El alta de un producto duplicado devuelve 409, no 500.

---

### CAL-02

**Unificar la comprobación de permisos** · Coste alto · Riesgo bajo · Independiente

- [x] **Cerrado** (2026-08-24)

**Qué pasa.** La regla «es admin o es el dueño» está escrita cinco veces:

| Ubicación | Forma |
|---|---|
| `src/shared/controller.utils.ts:9` | `isOwnerOrAdmin` |
| `src/orders/order.controller.ts:54-57` | `isAdmin` + `canAccessOrder` |
| `src/payments/pago.controller.ts:11` | `esAdmin` + comparación inline en la 31 |
| `src/availability/disponibilidad.controller.ts:11` | `esAdmin` |
| `src/users/user.controller.ts:119` | `isAdminRequest` |

**Qué cuesta.** Ya han divergido: solo `canAccessOrder` sabe manejar un documento populado; las otras cuatro comparan contra un `ObjectId` crudo. El día que el rol `premium` tenga permisos propios habrá que encontrar las cinco, y la que se olvide **fallará abierta**.

**Dirección.** Una sola implementación en `shared/controller.utils.ts` que acepte tanto un id como un documento populado. Las cinco copias pasan a importarla.

**Criterios de aceptación**

- `grep -rn "rol === UserRole.ADMIN" src` devuelve una única línea, en `shared/`.
- El helper compartido maneja el caso populado que hoy solo cubre `canAccessOrder`.
- Ningún controlador define su propio `isAdmin` / `esAdmin`.

> **Léelo dos veces antes de dar por bueno.** Tocar permisos falla abierto: un error aquí no rompe nada visible, solo deja pasar a quien no debía.

---

### CAL-03

**Borrar exportaciones muertas** · Coste bajo · Riesgo ninguno · Independiente

- [x] **Cerrado** (2026-08-24)

**Qué pasa.**

| Símbolo | Ubicación | Estado |
|---|---|---|
| `PREFIJO_SERVICIO` | `src/services/servicio.model.ts:5` | Cero referencias en todo el repo. Además duplica el concepto que `CODIGO_SERVICIO_MIN/MAX` ya expresan mejor. |
| `UserDocument` | `src/users/user.model.ts:111` | Cero usos. |
| `HORAS_RETENCION` | `src/availability/disponibilidad.service.ts:9` | Solo se usa dentro de su propio fichero: sobra el `export`. |
| `calcularCaducidad` | `src/availability/disponibilidad.service.ts:11` | Igual: solo se usa dentro de su fichero. |

**Qué cuesta.** Poco, pero ensancha la superficie pública de los módulos sin motivo y da falsas pistas a quien busque de dónde sale un concepto.

**Dirección.** Borrar los dos primeros; quitar el `export` de los dos últimos, dejándolos como constantes locales.

**Criterios de aceptación**

- `PREFIJO_SERVICIO` y `UserDocument` ya no existen.
- `HORAS_RETENCION` y `calcularCaducidad` siguen existiendo, sin `export`.

> **Ojo con los falsos positivos.** Las interfaces `IOrder`, `IProduct`, `IUser*`, `IServicio`, `IDisponibilidad` y `TokenPayload` **parecen** muertas con un grep global, pero son los genéricos de `Schema<T>` / `model<T>` dentro de su propio fichero. No las toques.

---

### CAL-04

**Renombrar `auth.routes.ts` → `user.routes.ts`** · Coste bajo · Riesgo ninguno · Independiente

- [x] **Cerrado** (2026-08-24)

**Qué pasa.** `src/users/auth.routes.ts` monta las **26 rutas de usuarios**, importando de los cuatro controladores del módulo, no solo las de autenticación. `index.ts:71` lo importa como `userRouter` desde `'./src/users/auth.routes'`, reconociendo implícitamente que el nombre está mal.

**Qué cuesta.** El nombre miente sobre el contenido justo en el punto donde alguien busca «dónde está la ruta de direcciones».

**Criterios de aceptación**

- El fichero se llama `user.routes.ts`.
- El import de `index.ts` apunta al nombre nuevo.

---

### CAL-05

**Corregir los mensajes de error en voseo** · Coste medio · Riesgo ninguno · Independiente

- [x] **Cerrado** (2026-08-24)

**Qué pasa.** Siete mensajes usan voseo rioplatense («No tenés permisos»), frente al resto del backend en castellano peninsular («No tienes permisos» en `pago.controller.ts:32`):

| Fichero | Líneas |
|---|---|
| `src/orders/order.controller.ts` | 88 |
| `src/users/user.controller.ts` | 115, 128, 225 |
| `src/users/user-profile.controller.ts` | 127, 160, 205 |

**Qué cuesta.** No es estilo de código: es texto que lee el cliente final de una academia española.

**Criterios de aceptación**

- `grep -rn "tenés" src` no devuelve nada.
- Los siete mensajes usan la misma persona verbal que el resto del backend.

---

### CAL-06

**Unificar el vocabulario de nombres** · Coste medio · Riesgo medio · Independiente

- [x] **Cerrado** (2026-08-24)

**Qué pasa.** El backend nombra en dos idiomas, y el corte cae por módulos:

| Módulo | Idioma | Ejemplos |
|---|---|---|
| `users/` | Inglés | `createUser`, `addAddress`, `updateStatus` |
| `services/`, `orders/`, `availability/` | Castellano | `crearServicio`, `retenerSlots`, `liberarSlotsDePedido` |
| `products/` | **Mezclado en el mismo fichero** | `getProductos`, `crearProducto`, `updateProducto`, `addImagenes`, `searchProductos` |

**Qué cuesta.** No puedes predecir el nombre de ninguna función sin abrir el fichero. En un dominio donde ya conviven `pedido`/`order` y `servicio`/`service`, esto acaba en un import equivocado.

**Dirección.** Decidir el idioma de los identificadores y aplicarlo. La mayoría del código nuevo está en castellano; `users/` es el módulo desviado, y `products/` el incoherente consigo mismo. Empieza por `products/`, que es el más barato y el más confuso.

**Criterios de aceptación**

- La decisión queda escrita en el README del backend, para que el siguiente no la vuelva a tomar.
- Ningún fichero mezcla los dos idiomas en sus exportaciones.

> Este ticket se puede cerrar por fases: primero `products/`, después `users/`. No hace falta hacerlo todo de una vez.

**Cómo se cerró.** Al aplicarlo, el terreno resultó más matizado de lo que decía el diagnóstico: `orders/` y `users/` **no mezclan idiomas**, son íntegramente ingleses y coherentes con sus propios modelos (`Order`, `User`). Los que mezclaban eran `products/` y `services/`. La regla adoptada, escrita en el README, es **«el idioma del módulo sigue al de su modelo de dominio»**, con el prefijo `get` como único anglicismo transversal. Renombrar `orders/` y `users/` al castellano habría exigido renombrar también sus modelos, y eso sí toca la base de datos: fuera de alcance.

---

### CAL-07

**Renombrar `getXById` a lo que realmente hacen** · Coste bajo · Riesgo bajo · Independiente

- [x] **Cerrado** (2026-08-24)

**Qué pasa.** `getProductoById` (`producto.controller.ts:55`) y `getServicioById` (`servicio.controller.ts:76`) no buscan por id: resuelven por `codigoArticulo`.

**Qué cuesta.** Poco por sí solo, pero induce a error a quien lea las rutas esperando un `ObjectId` y le pase uno.

**Dirección.** `getProductoPorCodigo` / `getServicioPorCodigo`, o el equivalente en el idioma que fije CAL-06. Solo cambian los nombres de las funciones; **las rutas HTTP no se tocan**.

**Criterios de aceptación**

- El nombre de cada función refleja la clave por la que busca.
- Las rutas expuestas siguen siendo exactamente las mismas.

---

### CAL-08

**Dar nombre propio a la identidad de línea de pedido** · Coste medio · Riesgo medio · Depende de nada, pero toca la ruta de confirmación

- [x] **Cerrado** (2026-08-24)

**Qué pasa.** Un pedido puede llevar dos sesiones del mismo servicio a horas distintas, así que la identidad de una línea es artículo **más** horario. Eso se construye como una plantilla de cadena `"código#horario"` a mano y en dos sitios con dos nombres:

- `claves` en `order.controller.ts:129`
- `claveLinea` en `order.controller.ts:290`

**Qué cuesta.** Es un acoplamiento oculto: dos trozos de código que **tienen** que generar exactamente el mismo formato de cadena, sin nada en el tipo que lo obligue. Si uno cambia el separador, los ajustes del admin dejan de encontrar sus líneas — en silencio, porque una clave que no casa simplemente no aplica ningún ajuste.

**Dirección.** Un concepto con nombre propio en el modelo de pedido, no una plantilla repetida.

**Criterios de aceptación**

- Existe una única función que produce la identidad de línea, y ambos puntos la usan.
- Cambiar el formato de esa identidad obliga a tocar un solo sitio.

> **Verifica el comportamiento, no solo el tipado.** Confirma un pedido con dos sesiones del mismo servicio a horas distintas y comprueba que cada ajuste cae en su línea.

---

### CAL-09

**Unificar el envoltorio de respuesta** · Coste alto · Riesgo **alto** · **No independiente: cambia el contrato con el frontend**

- [x] **Cerrado** (2026-08-24)

**Qué pasa.** El backend responde de dos formas distintas, casi al 50 %:

- **34 respuestas** con envoltorio `{ success, data }`
- **29 respuestas** con el objeto desnudo

El corte cae por módulos: **todo `users/` responde desnudo** (`user.controller.ts:185`, `user-profile.controller.ts`, `user-membership.controller.ts`), el resto envuelto.

**Qué cuesta.** Esta es la causa directa de que el frontend tenga que mantener **dos parsers distintos**, `readData` y `readBody`, en `apiClient.ts`. Cada endpoint nuevo obliga al autor del cliente a adivinar cuál toca, y equivocarse no da error: devuelve `undefined` en silencio.

**Dirección.** Elegir una forma y migrar `users/`, que es el módulo desviado. Arreglarlo permite borrar un parser del frontend.

**Criterios de aceptación**

- Todas las respuestas de éxito usan la misma forma.
- El frontend queda con un único parser en `apiClient.ts`.
- El README documenta la forma elegida.

> **Este ticket son dos PRs en dos repos.** El frontend no puede desplegarse antes que el backend sin romper producción. Planifícalo como despliegue conjunto y coordina el orden: **backend primero**.

---

## Anexo — Visita guiada a lo complejo

Esto no son tickets: es el contexto que hace falta para tocar las tres zonas densas del backend sin romperlas.

### A. El ciclo de vida de un hueco reservable

**Qué hace.** Impide que dos clientes compren la misma hora de clase, sin bloquear la agenda con carritos que nadie termina.

**Por qué existe.** Un producto se puede vender mientras haya stock. Una hora concreta de un lunes, no: o la tiene uno o no la tiene nadie. Y entre que alguien elige la hora y paga pueden pasar días, sobre todo si un admin tiene que tarificar el presupuesto por medio.

**Cómo funciona.** Un hueco tiene tres vidas, no dos. Está **libre**; está **cogido con fecha de caducidad** (alguien lo reservó pero aún no ha pagado); o está **cogido de verdad** (ya se cobró). La diferencia entre las dos últimas es un único campo, `retenidoHasta`: si lo lleva, caduca; si no, es firme.

Nadie limpia las caducadas con un proceso de fondo: se limpian solas cuando alguien consulta la agenda, justo antes de leerla (`disponibilidad.controller.ts:68`). El que mira la agenda paga el coste de depurarla, y a cambio no hace falta ningún cron — algo que en un despliegue serverless no tendría dónde vivir.

Para la carrera entre dos clientes simultáneos no hay bloqueos ni transacciones: la condición viaja dentro de la propia escritura. `disponibilidad.service.ts:57` pide «marca este hueco como ocupado **solo si sigue libre**», y la base de datos garantiza que de dos peticiones idénticas solo una encuentre el hueco libre. La otra recibe `null` y se le dice que elija otra hora.

**Qué complejidad es esencial.** Casi toda: la concurrencia y la caducidad vienen del problema real, no de cómo se escribió.

**Qué hay que saber para tocarlo.**

1. Un hueco firme **nunca** lleva `retenidoHasta`, y por eso la limpieza automática no lo puede tocar.
2. `reasignarSlot` coge el nuevo hueco **antes** de soltar el viejo (`disponibilidad.service.ts:120`). Ese orden es deliberado: al revés, un fallo entre medias deja al cliente sin ninguno de los dos.
3. El índice único de servicio+fecha+hora es lo único que hace idempotente la generación de la parrilla. Si se cae, regenerar duplica.

### B. La puerta de confirmación: cuándo el pedido deja de mirar al catálogo

**Qué hace.** Convierte ciertos pedidos en presupuestos que un administrador tiene que cerrar antes de que se puedan pagar.

**Por qué existe.** Una clase privada puede llevar recargo por desplazamiento; un seminario, descuento de grupo. El precio del catálogo es orientativo para esos servicios, y cobrar antes de ajustarlo sería cobrar mal.

**Cómo funciona.** Basta con que **una** línea del pedido pida revisión para que el pedido entero espere (`order.controller.ts:231`): no tiene sentido cobrar la mitad. El pedido nace en `pendiente_confirmacion`, ya con la hora retenida, y ahí se queda. El admin manda ajustes de precio, cantidad, motivo y hora; el backend recalcula el total y lo **congela** en el pedido.

A partir de ese momento se invierte quién manda: hasta la confirmación, el precio bueno es el del catálogo; después, el del pedido. Stripe cobrará esa cifra aunque el catálogo cambie mañana.

**Qué complejidad es accidental.** El congelado del total es esencial y está bien resuelto. La identidad de línea construida como cadena a mano **no lo es**: es el ticket CAL-08.

**Qué hay que saber para tocarlo.**

1. Después de confirmar, el total del pedido es la verdad y el catálogo no pinta nada.
2. Solo se puede confirmar desde `pendiente_confirmacion`.
3. La confirmación tiene un efecto lateral fuera del pedido: consolida los horarios, que dejan de caducar.

### C. Por qué el cobro se da por bueno en el webhook y no en el navegador

**Qué hace.** El pedido se marca pagado cuando lo dice Stripe por su cuenta, no cuando el navegador del cliente dice que la tarjeta pasó.

**Por qué existe.** El navegador no es de fiar: se cierra, se queda sin cobertura, o miente. Si el pedido se marcara pagado con lo que responde el cliente, cualquiera podría falsificar esa llamada.

**Cómo funciona.** Al pagar, Stripe avisa al servidor por un canal aparte. Ese aviso llega firmado, y la firma se calcula sobre los bytes **exactos** del mensaje: por eso el webhook necesita el cuerpo sin procesar, y por eso `express.raw` está montado antes que `express.json` en `index.ts:22`.

Stripe reintenta el aviso hasta recibir un OK, así que el mismo cobro puede llegar varias veces. La defensa es una línea: si el pedido ya está pagado, no hacer nada (`pago.controller.ts:148`).

**Qué complejidad es esencial.** Toda: es cómo funcionan las pasarelas de pago, y aquí está bien implementada.

**Qué hay que saber para tocarlo.**

1. El orden de los middlewares en `index.ts` es funcional, no cosmético. Si algo reordena `express.raw` y `express.json`, la firma deja de cuadrar y **ningún pedido vuelve a marcarse como pagado, en silencio**.
2. El `whsec_` de producción no es el que imprime `stripe listen`.
3. Hay que responder 2xx aunque el evento no interese, o Stripe reintenta para siempre.

---

## Bien resuelto — no lo toques

Esta sección no es cortesía: evita que el siguiente lo «mejore» y protege los patrones que sí funcionan.

- **`availability/`** es lo mejor del repositorio. El modelo documenta cada campo con su porqué, el servicio explica las decisiones difíciles antes de tomarlas, y la concurrencia está resuelta con la herramienta correcta en lugar de con locks caseros. **Es el patrón a copiar.**
- **`payments/stripe.utils.ts`** hace exactamente lo justo: cliente perezoso para que el arranque no exija claves donde no se cobra, conversión a céntimos con el motivo escrito, y una lista con nombre de los estados reutilizables en vez de una condición encadenada.
- **El corte de `users/` en cuatro controladores** (auth / identidad / perfil y direcciones / membresía y pagos) es una buena decisión de cohesión: cada uno cambia por motivos distintos. No los juntes.
- **`seed.ts` no es un fichero dios** aunque sea el más largo con diferencia. De sus 768 líneas, unas 700 son datos literales y ~45 son lógica. Es una tabla de datos, y las tablas de datos son largas. Si alguien propone trocearlo, no hace falta.
- **Cero código comentado en todo el repo**, y un único `TODO`, con contexto (`auth.controller.ts:113`). Eso es disciplina real y es raro de ver.

---

## Qué no se ha revisado

- **Corrección funcional y seguridad.** Fuera del alcance de esta revisión. Hay hallazgos abiertos de esa naturaleza que se siguen por separado; ninguno se repite aquí.
- **`seed.ts` dato a dato.** Revisada su estructura, no la validez de los productos que contiene.
- **Coherencia con el frontend.** Cubierta solo desde el lado del servidor. CAL-06 y CAL-09 la tocan, pero un veredicto completo exige revisar `types/` y `services/` del repo del frontend.
- **Dependencias y `tsconfig`.**
