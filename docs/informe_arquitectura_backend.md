# Informe de revisión — arquitectura del backend

**Fecha:** 2026-09-08 · **Rama:** `desarrollo` · **Commit:** `627ec70` · **Base:** 6.690 líneas de `.ts` en `src/`, 8 dominios

> Gemelo de [`frontend/docs/informe_arquitectura_frontend.md`](../../frontend/docs/informe_arquitectura_frontend.md),
> con el mismo método: mapa primero, juicio después, y cada hallazgo medido por lo que le
> cuesta a quien venga detrás.

> **Estado de ejecución (2026-09-08).** **Los siete hallazgos están reparados**, el 1 ya en
> los siete dominios. Al hacerlo aparecieron dos defectos reales que no estaban en el
> informe: ver «Lo que salió al reparar».
> `tsc --noEmit`, `eslint` y `prettier --check` en verde en el backend —los tres por primera
> vez, porque los dos últimos no existían aquí—, y el frontend sigue en verde. Queda
> pendiente de decisión de producto el correo de pedido (ver hallazgo 2) y de prueba manual
> el alta de pedidos y un cobro completo.

---

## Índice

1. [Alcance](#1-alcance)
2. [Estado general](#2-estado-general)
3. [Hallazgos](#3-hallazgos)
   - [Coste alto](#coste-alto)
   - [Coste medio](#coste-medio)
   - [Coste bajo](#coste-bajo)
4. [Visita guiada](#4-visita-guiada)
5. [Bien resuelto](#5-bien-resuelto)
6. [No revisado](#6-no-revisado)
   6 bis. [Lo que salió al reparar](#6-bis-lo-que-salió-al-reparar)
   6 ter. [El historial de pedidos y los restos de la semilla](#6-ter-el-historial-de-pedidos-y-los-restos-de-la-semilla)
7. [Checklist de tickets](#7-checklist-de-tickets)

---

## 1. Alcance

Revisión completa de `backend/src` y del punto de entrada `index.ts`: estructura por
dominios, capas, dirección de dependencias, **flujo de cobro de principio a fin** (alta del
pedido → confirmación → inicio de pago → webhook / captura → descuento de stock →
reembolso), permisos de las rutas y coherencia con el frontend.

Se han leído enteros los dos ficheros del cobro (`order.controller.ts`, `pago.controller.ts`)
y todo `shared/`. El resto se ha cubierto por peso.

**Fuera del alcance:** PayPal sin terminar y el webhook de Stripe sin registrar, ya
conocidos; el rendimiento de las consultas; y la falta de tests, que es conversación aparte.

`seed.ts` **no** es un hallazgo: está en `.gitignore` y no está rastreado, que es
exactamente donde se decidió dejarlo.

---

## 2. Estado general

El backend está mejor escrito que la media de lo que se hereda. La estructura por dominios
es rigurosa —`<dominio>.controller.ts` / `.model.ts` / `.routes.ts` / `.service.ts`, sin un
solo nombre de fichero repetido en todo el árbol—, los permisos están donde deben
(`isAuth` más `isAdmin` en las rutas, y una única implementación de «pasa el dueño o el
admin»), y los comentarios explican el **porqué** en los sitios difíciles en vez de traducir
el código. `sendServerError` distingue una petición mal formada de un fallo del servidor y
no filtra nombres de colecciones al cliente. Eso no es corriente.

El riesgo principal es uno y es estructural: **la capa de servicio existe pero solo se
aplica en la mitad del proyecto**. En productos el servicio es más grande que el controlador
(366 frente a 256 líneas) y ahí las reglas de negocio están donde toca. En pedidos y pagos
pasa lo contrario —579/143 y 521/79—, y en noticias y servicios directamente no hay capa de
servicio. El resultado es que las reglas más caras del sistema (resolver el catálogo,
calcular el total, decidir si hay existencias, marcar un pedido como pagado) viven dentro de
manejadores HTTP, mezcladas con `res.status(...)`.

Y hay un segundo problema, más barato pero visible: **lo que lee el cliente está a medio
acentuar**, incluido el mismo mensaje escrito cinco veces en un fichero, tres con tilde y
dos sin.

---

## 3. Hallazgos

### Coste alto

---

#### 1. La capa de servicio se aplica a medias, y el dominio del dinero es el que peor sale — ✅ reparado en los siete dominios

**Dónde:** todo `src/`, medido así:

| Dominio        | Controlador | Servicio | Veredicto                                   |
| -------------- | ----------: | -------: | ------------------------------------------- |
| `products`     |         256 |  **366** | El modelo a seguir                          |
| `users`        |         928 |      253 | Aceptable: son cuatro controladores de CRUD |
| `availability` |         344 |      155 | Aceptable                                   |
| `orders`       |     **579** |      143 | El servicio solo cubre **leer**             |
| `payments`     |     **521** |       79 | El servicio solo cubre **reembolsar**       |
| `news`         |         315 |        — | Sin capa de servicio                        |
| `services`     |         245 |        — | Sin capa de servicio                        |

Los dos casos concretos que más pesan:

- [`order.controller.ts:116-302`](../src/orders/order.controller.ts#L116-L302) —
  `createOrder` son **186 líneas** que resuelven el catálogo contra dos colecciones,
  normalizan productos y servicios en una forma común, acumulan unidades por talla, aplican
  la regla de existencias, calculan el total y retienen los horarios. Nada de eso es HTTP.
- [`pago.controller.ts:250-380`](../src/payments/pago.controller.ts#L250-L380) —
  `descontarStock`, `marcarPagado` y `cerrarPagoDePayPal` son operaciones de dominio, no
  manejadores. `marcarPagado` es, además, **el único sitio donde un pedido pasa a PAGADO**:
  la operación más importante del sistema vive en un fichero de controladores.

**Qué le cuesta a quien venga después.** Para cambiar una regla de negocio hay que entrar en
un manejador de 186 líneas y distinguir qué es regla y qué es respuesta HTTP. Y no hay
dónde llamarla desde otro sitio: el día que el alta de un pedido se haga también desde un
panel interno o un script, la única forma de reutilizar la regla es copiarla.

Es además el caso más caro que describe el manual: **la convención está a medio migrar**.
Productos demuestra que el equipo sabe hacerlo y decidió hacerlo así; el resto no lo sigue,
y nada dice cuál de los dos patrones gana.

**Dirección del arreglo.** Un `pedido.service.ts` que se quede con la resolución del
catálogo y la construcción de las líneas, y un `pago.service.ts` con `marcarPagado`,
`descontarStock` y `cerrarPagoDePayPal`. Los controladores quedan en leer la petición,
llamar y traducir el resultado a HTTP. No cambia comportamiento; cambia dónde está.

**Cómo quedó, y qué NO se hizo.** Se arreglaron los dos dominios del dinero, que eran los
que justificaban el coste alto:

| Dominio    | Antes     | Ahora         | Estado                         |
| ---------- | --------- | ------------- | ------------------------------ |
| `payments` | 521 / 79  | **213 / 398** | Invertido: el servicio manda   |
| `orders`   | 579 / 143 | **387 / 386** | Equilibrado                    |
| `news`     | 315 / —   | 334 / —       | **Sigue sin capa de servicio** |
| `services` | 245 / —   | 284 / —       | **Sigue sin capa de servicio** |

Noticias y servicios se quedan como estaban, y hay que decirlo claro: **el hallazgo no está
cerrado del todo**. Son CRUD con imágenes, sin dinero ni concurrencia de por medio, así que
el coste de dejarlos es bajo y el riesgo de tocarlos ahora no compensaba meterlo en la misma
tanda que el cobro. Quedan como B9 y B10 en el checklist.

---

#### 2. El frontend promete un correo que el backend no envía — ✅ reparado (la frase; el correo es decisión aparte)

**Dónde:** [`frontend/.../OrderConfirmation.tsx:23`](../../frontend/src/features/checkout/ui/OrderConfirmation.tsx#L23)
frente a [`shared/correo.ts`](../src/shared/correo.ts)

La pantalla de confirmación dice al cliente que acaba de pagar: _«Pago confirmado. Te hemos
enviado el resumen por correo»_. **No existe tal correo.** `correo.ts` tiene un único
consumidor en todo el backend —[`auth.controller.ts:16`](../src/users/auth.controller.ts#L16)—
y es la recuperación de contraseña. No hay correo de pedido en ninguna parte.

**De dónde sale.** Lo escribí yo en la reparación del frontend de esta misma fecha, al
sustituir el «Total cobrado / pendiente». Cambié una frase que prometía de más por otra que
promete algo distinto y que tampoco es verdad. Queda dicho porque el fallo es mío y porque
explica por qué aparece en un informe del backend.

**Qué le cuesta.** Es lo peor de los tres estados posibles: el cliente que ha pagado espera
un correo que no va a llegar, y en vez de dudar escribe a soporte. Un texto neutro no habría
generado esa incidencia.

**Dirección del arreglo.** Dos caminos, y hay que elegir a conciencia: quitar la frase
(reparación, minutos) o mandar el correo de verdad (funcionalidad nueva, con plantilla y su
sitio en `marcarPagado`). La reparación es lo urgente; el correo, una decisión de producto.

---

### Coste medio

---

#### 3. Lo que lee el cliente está a medio acentuar, y el mismo mensaje no se escribe igual dos veces — ✅ reparado

**Dónde:** todo `src/`, y en concreto [`order.controller.ts`](../src/orders/order.controller.ts)
y [`correo.ts:70-73`](../src/shared/correo.ts#L70-L73)

Hay que separar dos cosas que parecen la misma:

- **Comentarios y mensajes de commit sin acentos**: es la convención del proyecto, es
  coherente en todo el árbol y **no es un hallazgo**. Se respeta.
- **Cadenas que lee una persona**: ahí el español tiene que estar bien, y no lo está.

Las cifras: 32 «válido» frente a 23 «valido», 8 «confirmacion» y 21 «articulo» en textos de
respuesta. Y el caso que lo resume, cinco líneas del **mismo fichero** con el **mismo
mensaje**:

```
order.controller.ts:90   'ID de pedido no válido'
order.controller.ts:312  'ID de pedido no valido'
order.controller.ts:463  'ID de pedido no valido'
order.controller.ts:506  'ID de pedido no válido'
order.controller.ts:562  'ID de pedido no válido'
```

Aparte, el **asunto del correo** que recibe quien olvida su contraseña dice `Recupera tu
contrasena`, sin eñe, y el cuerpo lo repite dos veces más.

**Qué le cuesta.** El correo sin eñe lo lee un cliente real y parece spam mal traducido, que
es justo lo que no quieres en un mensaje con un enlace para pinchar. Y cinco copias del
mismo texto significan que corregirlo requiere encontrarlas todas: la prueba está en que ya
divergieron sin que nadie se diera cuenta.

**Dirección del arreglo.** Que el mensaje se escriba una vez (ver hallazgo 4, que lo
resuelve de paso) y repasar las cadenas de cara al cliente. Los comentarios se quedan como
están.

---

#### 4. La validación de id y el «no encontrado» se han reinventado dominio por dominio — ✅ reparado

**Dónde:** `news`, `products` y `services` frente a los otros cuatro

Tres dominios escribieron **el mismo trío de ayudantes**, cada uno con nombres distintos:

|                       | `products`       | `services`       | `news`         |
| --------------------- | ---------------- | ---------------- | -------------- |
| Leer el identificador | `parseCodigo`    | `parseCodigo`    | `parseId`      |
| Responder 400         | `codigoInvalido` | `codigoInvalido` | `idInvalido`   |
| Responder 404         | `noEncontrado`   | `noEncontrado`   | `noEncontrada` |

Los cuerpos **sí** difieren por motivos legítimos —productos excluye el rango reservado a
servicios, servicios exige estar dentro, noticias valida un ObjectId—, así que no es copia y
pega. Lo duplicado es la **forma**. Y los otros cuatro dominios ni siquiera hicieron
ayudantes: repiten **26 bloques** de `isValidObjectId(id)` + `res.status(400)` a mano.

Mientras tanto [`shared/controller.utils.ts`](../src/shared/controller.utils.ts) existe, está
bien hecho y nadie lo amplió.

**Qué le cuesta.** Un dominio nuevo tiene tres modelos a los que parecerse y ninguno
señalado como el bueno, así que inventará un cuarto. Y las respuestas de la API salen
distintas según por qué puerta entres, que es lo que produce el hallazgo 3.

**Dirección del arreglo.** Subir a `shared/controller.utils.ts` lo que es común —responder
404 con el nombre del recurso, responder 400, y leer un ObjectId de ruta— y dejar en cada
dominio solo su regla propia de qué es un código válido.

---

#### 5. El backend no tiene ni ESLint ni Prettier; el frontend tiene los dos — ✅ reparado

**Dónde:** [`package.json`](../package.json) frente a `frontend/package.json`

El `verificar` del frontend es `tsc -b && eslint . && prettier --check .`. El del backend es
`tsc --noEmit` y nada más. No hay configuración de ESLint ni de Prettier en todo el backend.

**Qué le cuesta.** Dos niveles de rigor en el mismo repositorio, y el nivel bajo le toca
justo al lado donde está el dinero. Sin formateador, el estilo lo decide quien escribe —de
ahí vienen las columnas alineadas a mano de algunos ficheros, que se descuadran al primer
cambio—, y sin linter no hay quien avise de un `await` olvidado o una promesa sin gestionar,
que en un flujo de cobro no es cosmética.

**Dirección del arreglo.** Alinear el backend con lo que el frontend ya usa y meterlo en el
mismo `verificar`. Es un paso de configuración y un formateo grande de una vez.

---

### Coste bajo

---

#### 6. `MetodoPago` es un contrato gemelo con el frontend y, al contrario que `identidadLinea`, no lo dice — ✅ reparado

**Dónde:** [`pago.controller.ts:19-20`](../src/payments/pago.controller.ts#L19-L20) y
`frontend/src/features/pago/model/pago.types.ts`

Los dos lados definen la misma lista —`stripe`, `bizum`, `paypal`— y tienen que coincidir o
el cobro falla. El proyecto ya tiene un caso idéntico, `identidadLinea`, y allí **está
declarado**: los dos ficheros llevan escrito que son pareja y por qué no se puede compartir
código entre los dos runtimes. Aquí no hay nada.

**Qué le cuesta.** Poco hoy y mucho el día que se añada un método: nada avisa de que hay un
segundo sitio. La incoherencia con el caso hermano es lo que lo convierte en hallazgo — si
en un sitio se documenta y en otro no, la documentación deja de ser fiable.

---

#### 7. El redondeo de importes se decide en dos sitios (eran tres) — ✅ reparado

**Dónde:** [`order.controller.ts:63`](../src/orders/order.controller.ts#L63) y
[`stripe.utils.ts:36`](../src/payments/stripe.utils.ts#L36)

`redondearEuros` vive como constante privada de un controlador; `aCentimos` hace la
conversión para Stripe en otro módulo. Son las dos únicas piezas que deciden cómo se
redondea dinero y no se conocen.

**Qué le cuesta.** Poco mientras las dos usen `Math.round`. La forma en que muerde es
sutil: si un día una pasa a truncar, el total guardado y el importe cobrado pueden
separarse un céntimo, y eso no lo ve nadie hasta que un cliente lo dice.

---

## 4. Visita guiada

Dos puntos que un recién llegado no entendería, explicados para alguien del equipo.

---

### A. Por qué un pedido de PayPal se puede cerrar dos veces sin cobrar dos veces

**Qué hace.** Cuando alguien paga con PayPal, el aviso de que ha pagado puede llegar por dos
caminos distintos, a la vez y en cualquier orden. El código está preparado para que da igual
cuál llegue primero, y para que llegar los dos no cobre dos veces.

**Por qué existe.** Un cliente aprueba el pago en PayPal y **puede no volver**: cierra la
pestaña, se queda sin batería. Si solo escucháramos su vuelta al sitio, ese pago quedaría
aprobado y sin cobrar, y nadie se enteraría. Por eso PayPal avisa además por su cuenta. Pero
entonces hay dos avisos para el mismo cobro.

**Cómo funciona.** Los dos caminos llaman a la misma función. Lo primero que hace es mirar
si el pedido ya está pagado y, si lo está, no hacer nada. Además, la petición de cobro a
PayPal viaja siempre con el mismo identificador de operación, así que si llega repetida
PayPal devuelve la que ya hizo en vez de hacer otra. Dos frenos: uno nuestro y uno de ellos.

**Complejidad esencial y accidental.** Que haya dos avisos es esencial: viene de que el
cliente puede desaparecer a mitad. Que la función esté dentro de un fichero de controladores
en vez de en una capa de servicio es accidental — es el hallazgo 1.

**Qué hay que saber para tocarlo sin romperlo.**

1. **El corte «si ya está pagado, salir» es lo primero de la función.** Moverlo o
   condicionarlo es abrir la puerta a un cobro doble.
2. **Se guarda el identificador de la captura, no el de la orden.** Es el único que PayPal
   acepta para devolver dinero. Cambiarlo deja los pedidos de PayPal sin poder reembolsarse.
3. **Se comprueba que la orden cobrada es la de este pedido.** Sin eso, una orden ajena
   aprobada por el mismo cliente daría por pagado un pedido que nadie pagó.

---

### B. Por qué confirmar un presupuesto se hace en tres pasos y no en uno

**Qué hace.** Cuando el administrador tarifica un pedido que estaba en espera, puede cambiar
precios, cantidades y horarios de varias líneas a la vez. El código lo hace en tres fases
separadas en lugar de ir aplicando cambios según los lee.

**Por qué existe.** Los horarios son un recurso compartido: reservar uno se lo quita a otro
cliente. Si se fueran aplicando cambios línea por línea y la última fallara —un precio mal
puesto, un horario que otro se acaba de llevar—, quedaría media confirmación aplicada: la
agenda movida y el pedido sin guardar. Un desastre difícil de detectar y peor de deshacer.

**Cómo funciona.** Primero se emparejan los ajustes con sus líneas y **se valida todo sin
tocar nada**. Después se mueven los horarios, anotando cada movimiento en una lista. Por
último se aplican precios y cantidades, que ya no pueden fallar, y se guarda. Si guardar
falla, se recorre la lista de movimientos al revés y se devuelven los horarios.

La analogía: es un ensayo antes del estreno. Se comprueba que todo el mundo se sabe su papel
antes de levantar el telón, porque una vez levantado no se puede parar.

**Complejidad esencial y accidental.** Que haya que validar antes de escribir es esencial: no
hay transacción que abarque el pedido y la agenda a la vez. La lista de deshacer también.
Lo accidental es que las tres fases estén dentro de un manejador HTTP de 148 líneas — de
nuevo el hallazgo 1.

**Qué hay que saber para tocarlo sin romperlo.**

1. **Los ajustes se indexan por el horario ORIGINAL de la línea**, no por el nuevo. Es lo
   único que permite saber a qué sesión se refiere cada ajuste, y por eso el emparejamiento
   ocurre antes de mover nada.
2. **Ninguna validación puede bajar del paso 1 al paso 2.** En cuanto se valida algo después
   de mover un horario, vuelve el estado a medias.
3. **Si no se puede devolver un horario, queda un aviso en el log a propósito.** No es un
   error tragado: es una reserva que hay que revisar a mano, y borrar ese `console.error` la
   haría invisible.

---

## 5. Bien resuelto

Lo que **no** hay que tocar al arreglar lo de arriba.

- **La estructura por dominios es rigurosa.** Ocho carpetas, el mismo esquema de nombres en
  todas, y **ni un solo nombre de fichero repetido** en todo el árbol. Orientarse es trivial.
- **Los permisos están en las rutas y la regla de acceso es única.** `esDuenoOAdmin` en
  `shared/controller.utils.ts` es la única implementación de «pasa el dueño o el admin», y
  admite id, ObjectId o documento populado para que ningún controlador tenga que normalizar
  por su cuenta.
- **`sendServerError` está pensado de verdad.** Distingue una validación fallida (400, con
  los campos) de un fallo del servidor (500, sin detalle), y explica por escrito que los
  mensajes de Mongoose son un mapa gratis de la aplicación para quien la sondea.
- **El orden de los middlewares está documentado donde importa.** `index.ts` explica por qué
  el webhook de Stripe se monta con `post` y no con `use`, y qué se rompería al cambiarlo.
  Eso es exactamente lo que salva a la siguiente persona.
- **`correo.ts` degrada en vez de reventar.** Sin credenciales no tumba el alta de un
  usuario: avisa en el log y sigue. La decisión está escrita.
- **El stock por talla se descuenta con una operación atómica condicional** y lo que no
  cuadra se anota en el pedido en vez de dejar stock negativo. Es la mejor pieza del
  proyecto.
- **Sin código muerto.** Se comprobaron una a una las 33 exportaciones sospechosas de no
  tener uso: todas lo tienen.

---

## 6. No revisado

- **PayPal a medias y el webhook de Stripe sin registrar**: conocidos y fuera de alcance.
- **Rendimiento de las consultas**, índices y planes de ejecución.
- **`seed.ts`**: herramienta local, ignorada por git y fuera del despliegue.
- **Cobertura de tests**: no hay, por decisión previa. Conversación aparte.

---

## 6 bis. Lo que salió al reparar

Dos defectos reales que no estaban en el informe original y aparecieron al mover el código.
Los dos son el mismo patrón: **la solución correcta existía en `products` y no había llegado
a `services`**, porque sin capa de servicio nada obliga a que dos dominios hermanos se
parezcan.

### A. Borrar una imagen de un servicio borraba el fichero antes de comprobar de quién era

`eliminarImagenServicio` hacía `deleteFromR2(url)` **primero** y el `$pull` después, con un
filtro que solo miraba el código del servicio. Mandando la URL de **otro** servicio —o la de
un producto— se borraba su fichero del bucket, y la referencia del dueño real se quedaba
apuntando a un objeto que ya no existe.

`producto.service.ts` ya lo tenía resuelto: su `quitarImagen` mete la propia url en el
filtro, así que el `$pull` solo casa si la imagen es de ese producto, y solo entonces se
toca el almacenamiento. Ahora `servicio.service.ts` hace lo mismo.

Es admin, así que no era escalada de privilegios; era una forma de perder datos sin aviso.
**Cambio de comportamiento:** mandar una URL ajena ahora responde 404 en vez de borrar el
fichero.

### B. Al crear un servicio se ignoraba `requiereConfirmacion`

El alta desestructuraba los campos a mano y **ese no estaba en la lista**; la actualización,
en cambio, usaba una lista blanca que sí lo incluía. Crear y actualizar no coincidían en qué
campos existen.

Consecuencia real: el panel **sí manda** el campo al crear
([`useServiciosAdmin.ts:90`](../../frontend/src/features/servicios-admin/model/useServiciosAdmin.ts#L90)),
el servidor lo tiraba, y ganaba el `default: true` del modelo. Un administrador que creaba
un servicio con la casilla desmarcada obtenía igualmente un servicio que **exige
confirmación**: todos los pedidos con ese servicio caían en el gate de tarificación en vez
de poder pagarse directamente, y había que editarlo después para arreglarlo.

Ahora el alta pasa por la misma lista blanca que la actualización, así que los dos caminos
admiten exactamente los mismos campos. **Cambio de comportamiento:** un servicio creado con
la casilla desmarcada ya nace como directamente pagable, que es lo que el panel decía.

---

## 6 ter. El historial de pedidos y los restos de la semilla

Revisado a raiz de un fallo en pruebas: el panel de pedidos reventaba con
`Cannot read properties of null (reading 'username')` y dejaba el sitio en blanco.

### La politica de historial es correcta y deliberada

Un pedido **no se borra desde la aplicacion**, y esta bien que sea asi. El ciclo de vida va
por estado —`pendiente_confirmacion` → `pendiente` → `pagado` → `preparando` → `enviado` →
`entregado`, con `cancelado` y `rechazado` como salidas— y **cancelar es la retirada**:
`updateOrderStatus` sobre un pedido `pagado` dispara el reembolso ANTES de cambiar el
estado, y solo cambia el estado si el dinero se devolvio. Borrar la fila dejaria el cobro de
Stripe sin nada al otro lado.

Matiz, porque «no se puede borrar» no es exacto: `DELETE /api/pedidos/:id` **si existe** y es
solo de admin, y libera los horarios al hacerlo. Lo que no hay es forma de llamarlo desde el
panel —`pedidoService.ts` no tiene la funcion y no hay boton—. Es una omision coherente con
la politica, no un olvido que haya que tapar.

### El problema estaba en la semilla, no en el historial

La semilla vaciaba `User`, `Producto` y `Servicio`, y dejaba intactas las colecciones que
**dependen** de esas tres. Cada pasada dejaba la base de datos incoherente:

| Resto                          | Apunta a                        | Que pasa al resembrar                                          |
| ------------------------------ | ------------------------------- | -------------------------------------------------------------- |
| `Order.user`                   | referencia a `User`             | `populate` devuelve `null`: pedido sin dueño                   |
| `Order.items[].codigoArticulo` | codigo, no referencia           | El codigo se reutiliza: apunta a otro articulo **distinto**    |
| `Disponibilidad`               | codigo de servicio y `pedidoId` | Horarios retenidos por pedidos de un catalogo que ya no existe |
| `Noticia.autor`                | referencia a `User`             | Autor huerfano (esto si estaba bien tratado, ver abajo)        |
| `IntentoAcceso`                | **nombre** de usuario, no id    | Un bloqueo viejo sigue aplicando al `admin` recien creado      |

El segundo es el peor de todos y no da ningun error: un pedido antiguo pasa a decir que se
compro un articulo que en realidad es otro. **No falla, miente.**

La semilla ya deja las siete colecciones a cero. Es lo unico que garantiza un estado
coherente, precisamente porque un pedido no se borra desde la aplicacion.

### Un tipo que mentia, y uno que no

El fallo concreto fue que `Pedido.user` se declaraba `string | PedidoUsuarioResumen` en el
frontend, sin `null`. Como el tipo no admitia lo que la API devuelve de verdad, TypeScript
no podia avisar, y `typeof null === 'object'` hacia que el caso se colara por la rama del
objeto.

Lo llamativo es que **las noticias ya lo tenian bien**: `autor: { … } | null` en el tipo y
`?.username ?? 'Desconocido'` al pintarlo. El proyecto ya conocia esta clase de problema y la
trataba; los pedidos eran la excepcion. Ya no.

### Y un agujero de resiliencia aparte

No habia **ningun** limite de error en el frontend, asi que ese fallo desmontaba el arbol
desde la raiz: pagina en blanco, sin menu ni pie, sin forma de salir. Ahora
`components/shared/LimiteDeError` envuelve el contenido de la ruta dentro de la carcasa, con
`key={pathname}` para que se reinicie al navegar.

**Nota de mantenimiento:** `seed.ts` no entra en `tsconfig` (`include: ["src", "index.ts",
"api"]`), asi que `verificar` **no lo comprueba**. Es deliberado —esta en `.gitignore` y en
un clon limpio no existe—, pero significa que al tocarla hay que comprobarla a mano.

---

## 6 quater. Superficie de la API sin consumidor

Recogido aqui al retirar `LEGACY_CLEANUP.md`, que era su unico registro. Reverificado hoy
comparando las rutas expuestas con las que llama el cliente.

`/api/users` expone **22 rutas**; `frontend/src/services/` llama a siete formas:
`/users`, `/users/:id`, `/login`, `/me`, `/register`, `/forgot-password` y
`/reset-password`. Las granulares no las usa nadie:

- `PATCH /:id/password`, `/:id/status`, `/:id/customer`, `/:id/membership`
- `PATCH` y `DELETE /:id/sports-profile`
- `POST`, `PATCH` y `DELETE /:id/addresses[/:addressId]`
- `GET`, `POST`, `PATCH` y `DELETE /:id/membership-payments[/:paymentId]`

El panel si gestiona direcciones, cuotas y perfil deportivo: lo hace mandando el usuario
entero por `PUT /:id`. Las rutas finas quedaron escritas y sin llamar.

**No es un hallazgo de calidad ni una propuesta de borrado.** Es superficie publica que
existe, esta protegida por `isAuth`/`isAdmin` y funciona; simplemente no tiene cliente. Se
anota para que quien la vea sepa que no es codigo muerto por descuido, y para que quien
necesite editar una direccion sin reenviar el usuario entero sepa que ya existe la ruta.

---

## 7. Checklist de tickets

Estado a 2026-09-08, tras la sesión de reparación.

### Hecho

- [x] **B1** · Fuera la promesa del correo inexistente en `OrderConfirmation.tsx`. _(hallazgo 2)_
- [x] **B2** · `shared/controller.utils.ts` gana `leerObjectId`, `noEncontrado`, `noEncontrada`, `peticionInvalida`, `conflicto` y `sinPermiso`; **22 bloques** de validación de id sustituidos en cinco controladores. _(hallazgos 3 y 4)_
- [x] **B3** · Acentos y eñes repasados en las cadenas de cara al cliente de nueve ficheros, y el correo de recuperación ya dice «contraseña». Los comentarios se han dejado como estaban, que es la convención del proyecto. _(hallazgo 3)_
- [x] **B4** · `MetodoPago` declarado como contrato gemelo en los dos lados. De paso, `identidadLinea` lo declaraba **solo en el frontend**: ahora también en el backend. _(hallazgo 6)_
- [x] **B5** · `shared/dinero.ts` reúne `redondearEuros`, `aCentimos` y `comoDecimalDeTexto`. Eran tres conversiones en tres ficheros, no dos. _(hallazgo 7)_
- [x] **B6** · `payments/pago.service.ts` con `marcarPagado`, `descontarStock`, `cerrarPagoDePayPal`, el inicio de cobro y las reglas. `pago.controller.ts`: **521 → 214 líneas**. _(hallazgo 1)_
- [x] **B7** · `prepararPedido` y `resolverCatalogo` pasan a `order.service.ts`. `order.controller.ts`: **579 → 389**; el servicio: **143 → 382**. _(hallazgo 1)_
- [x] **B9** · `news/noticia.service.ts`: el filtro público, la resolución de portada (Instagram o imagen), el historial y la aplicación de cambios. `noticia.controller.ts`: **315 → 153 líneas**. _(hallazgo 1)_
- [x] **B10** · `services/servicio.service.ts` con las consultas y las operaciones, incluidos `esCodigoDeServicio` —que estaba en el dominio de pedidos y es de este— y la corrección del borrado de imágenes. `servicio.controller.ts`: **245 → 202**. _(hallazgo 1)_
- [x] **B11** · `esDuplicado` estaba escrito igual en dos controladores; ahora vive en `shared/controller.utils.ts`. _(hallazgo 4)_
- [x] **B8** · ESLint y Prettier instalados y configurados igual que en el frontend, más dos reglas propias del backend (`no-floating-promises`, `await-thenable`) porque aquí una promesa sin esperar es dinero sin comprobar. `verificar` pasa a ser `tsc --noEmit && eslint . && prettier --check .`. _(hallazgo 5)_

Las cuatro excepciones al linter llevan su motivo escrito en el sitio: tres trazas de
arranque (`index.ts`, `cors.ts`, `db.ts`) y el `namespace` que exige ampliar los tipos de
Express (`token.utils.ts`).

### Pendiente

- [ ] **Decisión de producto:** si se manda o no un correo de confirmación de pedido. Hoy
      no se promete ninguno, que es lo correcto mientras no exista. Si se implementa, su
      sitio es `marcarPagado` en `pago.service.ts`.

### Un hallazgo que apareció al reparar

El árbol de trabajo local está en **CRLF** aunque `.gitattributes` declara `eol=lf` y git
guarda LF (`core.autocrlf=true` global lo reescribe al sacarlo). No afecta al repositorio ni
al despliegue —lo que se comitea es LF—, pero **hizo fallar en silencio** la primera pasada
mecánica de B2: sustituyó 3 de 26 bloques y ninguna herramienta avisó. Los ficheros tocados
se han escrito ya en LF. Para alinear el resto de una vez:

```bash
git add --renormalize .
```

### Verificación hecha

- [x] `npm run verificar` en verde en el backend: `tsc --noEmit`, `eslint .`, `prettier --check .`.
- [x] `pnpm verificar` en verde en el frontend.
- [ ] **Falta probar a mano:** el alta de un pedido con producto (con talla) y con servicio
      (con horario), y un cobro completo de principio a fin. B6 y B7 movieron las reglas de
      sitio sin cambiarlas, pero eso el compilador no lo garantiza.
