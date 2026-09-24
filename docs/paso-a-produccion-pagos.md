# Paso a producción del cobro con Stripe

Fecha: 2026-09-24 · Para: quien despliega en Vercel y Cloudflare y lleva el panel de Stripe.

Qué desplegar, qué configurar, cómo comprobar que ha entrado, qué probar y qué mirar en los
logs. Cada comprobación trae el resultado esperado. No hace falta leer código.

---

## 0. Estado de partida (comprobado el 24-09-2026)

| Pieza                         | Estado                                                                                               | Consecuencia                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Backend en producción         | **Código antiguo.** Vercel no está conectado al repo: mergear no despliega.                          | El webhook rechaza **todas** las firmas de Stripe. |
| Frontend publicado            | Versión actual, pero **compilado sin clave publicable de Stripe** (`.env.production` la deja vacía). | El formulario de tarjeta no se carga.              |
| Endpoint del webhook (Stripe) | URL correcta y 11 eventos marcados.                                                                  | Listo. Stripe tiene avisos pendientes de entregar. |
| Iniciar un pago desde la web  | Responde `500 Error iniciando el pago`. Causa sin confirmar.                                         | Ningún cliente llega a pagar.                      |

**Mientras no se hagan los pasos 1 y 2, ningún pago de la web termina bien.**

---

## 1. Desplegar el backend

**Versión:** repo `ossa-bjj/backend-desarrollo`, rama `desarrollo`, commit `e474ec2` o posterior.

Opción recomendada (una vez): Vercel → proyecto del backend → _Settings_ → _Git_ → conectar
`ossa-bjj/backend-desarrollo` con **Production Branch = `desarrollo`**. Desde ese momento cada
merge despliega solo.

Opción manual, desde la carpeta del backend:

```bash
npx vercel login
npx vercel --prod
```

### Variables en Vercel → _Settings_ → _Environment Variables_ → **Production**

| Variable                | Obligatoria para cobrar   | Nota                                                                                 |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `DB_URL`, `JWT_SECRET`  | Sí (sin ellas no arranca) |                                                                                      |
| `R2_*` (cinco)          | Sí (sin ellas no arranca) |                                                                                      |
| `ALLOWED_ORIGINS`       | Sí                        | Debe incluir el dominio del frontend publicado.                                      |
| `STRIPE_SECRET_KEY`     | **Sí**                    | `sk_test_…` o `sk_live_…`. Mismo modo que el endpoint y que el frontend.             |
| `STRIPE_WEBHOOK_SECRET` | **Sí**                    | El _Signing secret_ **de ese endpoint** (panel de Stripe). No el de `stripe listen`. |

Cambiar una variable **no afecta a lo ya desplegado**: después hay que volver a desplegar.

### Comprobar que el backend nuevo está en producción

```bash
# 1. Arranca y conecta a la base de datos
curl -s https://arturosalas-backend.vercel.app/
#    esperado: {"status":"ok","api":"conectado"}

# 2. El código del webhook es el nuevo (esta es la prueba decisiva)
node -e "fetch('https://arturosalas-backend.vercel.app/api/pedidos/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':'t=1,v1=x'},body:JSON.stringify({r:'x'.repeat(200*1024)})}).then(async r=>console.log(r.status, await r.text()))"
#    esperado:  400 {"error":"Firma no válida"}          → código nuevo
#    si sale:   413 {"error":"Peticion mal formada"}     → sigue el código antiguo
```

---

## 2. Publicar el frontend con la clave de Stripe

En `frontend/.env.production` (no se versiona, vive en la máquina que despliega):

```env
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_…   # o pk_live_…, del MISMO modo que STRIPE_SECRET_KEY
```

Si se deja vacía, **anula** la del `.env` y el build sale sin clave. Luego:

```bash
cd frontend
npm run deploy
```

**Comprobar:** en la web publicada, ir al pago de un pedido y elegir tarjeta. Tiene que
aparecer el formulario de Stripe, no el mensaje "El pago con tarjeta no está configurado".

---

## 3. Comprobar que Stripe entrega los avisos

Panel de Stripe → _Developers_ → _Webhooks_ → endpoint
`https://arturosalas-backend.vercel.app/api/pedidos/webhook`:

1. Pestaña _Entregas de eventos_: los avisos pendientes empiezan a entrar solos (Stripe reintenta
   durante tres días). Son cobros de prueba sin pedido asociado; no cambian nada.
2. Botón _Enviar evento de prueba_ → `payment_intent.succeeded` → respuesta esperada
   **`200 {"received":true}`**.
3. Si responde `400 {"error":"Firma no válida"}` con el backend nuevo ya desplegado: el
   `STRIPE_WEBHOOK_SECRET` de Vercel no es el de este endpoint.

**Eventos marcados** (no quitar ninguno de estos siete): `payment_intent.succeeded`,
`payment_intent.processing`, `payment_intent.payment_failed`, `payment_intent.canceled`,
`charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Los cuatro
`checkout.session.*` sobran (son de Stripe Checkout, que no se usa) y se pueden desmarcar.

---

## 4. Pruebas a hacer en la web

En **modo prueba** de Stripe. Tarjetas de prueba: cualquier fecha futura y cualquier CVC.

| #   | Qué hacer                                                    | Resultado esperado en el pedido                                  | Dónde mirarlo                       |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------- |
| 1   | Pagar con `4242 4242 4242 4242`                              | Pasa a **pagado**. Baja el stock de la talla comprada.           | Panel de admin · Entregas en Stripe |
| 2   | Pagar con `4000 0000 0000 0002` (rechazada)                  | Sigue **pendiente**. Se puede volver a intentar.                 | Panel de admin                      |
| 3   | Pagar con `4000 0025 0000 3155` y completar la autenticación | Pasa a **pagado**.                                               | Panel de admin                      |
| 4   | Pagar con Bizum y aceptar en la pantalla de prueba           | Primero pendiente; a los pocos segundos, **pagado**.             | Panel de admin                      |
| 5   | Pagar con Bizum y rechazar en la pantalla de prueba          | Sigue **pendiente**.                                             | Panel de admin                      |
| 6   | Cancelar desde el panel de admin un pedido pagado            | **Cancelado**, importe devuelto en Stripe, stock repuesto.       | Panel de admin · Pagos en Stripe    |
| 7   | Devolver el importe desde el panel de Stripe                 | **Cancelado**, stock repuesto.                                   | Panel de admin                      |
| 8   | Pagar con `4000 0000 0000 0259` (provoca una reclamación)    | Sigue **pagado**, con la reclamación anotada. Aviso en los logs. | Logs de Vercel · Disputas en Stripe |
| 9   | Pedido con un producto y un servicio                         | Pagado: baja el stock y la reserva del horario queda en firme.   | Panel de admin                      |

Si la prueba 1 falla al pulsar _Pagar_ con **"Error iniciando el pago"**, ver la línea
`Error iniciando el pago:` en los logs (apartado 5): trae la causa exacta.

---

## 5. Qué buscar en los logs

Vercel → proyecto del backend → _Logs_. Buscar por el texto de la izquierda.

| Texto en el log                                         | Qué significa                                                           | Qué hacer                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `Firma de webhook de Stripe no valida:`                 | Stripe llamó y el servidor rechazó el aviso. **El pedido no se marca.** | Urgente. Comprobar el paso 1 (código nuevo) y `STRIPE_WEBHOOK_SECRET`. |
| `Error iniciando el pago:`                              | Reventó al crear el cobro. Lo que sigue a los dos puntos es la causa.   | Urgente. Si dice `Falta STRIPE_SECRET_KEY`, falta la variable.         |
| `Error procesando el webhook de Stripe:`                | El aviso llegó bien pero falló al procesarlo. Stripe lo reintentará.    | Revisar el error que acompaña.                                         |
| `RECLAMACION abierta sobre el pedido`                   | Un cliente ha reclamado el cobro a su banco. El dinero está retenido.   | **Responder en Stripe con pruebas antes del plazo** o se pierde.       |
| `Stock insuficiente al cobrar:`                         | Se cobró una talla que ya no tenía existencias.                         | Reponer o devolver el importe. Queda anotado en el pedido.             |
| `Linea del articulo … sin talla`                        | Un pedido de producto sin talla: no se descontó stock.                  | Revisar ese pedido.                                                    |
| `Aviso de Stripe para un pedido inexistente`            | Aviso de un cobro que no es de ningún pedido.                           | Normal con cobros de prueba. Con cobros reales, investigar.            |
| `Aviso de cobro para un pedido inexistente`             | Ídem, en el aviso de pago completado.                                   | Ídem.                                                                  |
| `Reembolso de un cobro que no es de ningun pedido`      | Devolución de un cobro que no es de la web.                             | Ídem.                                                                  |
| `Reclamacion sobre un cobro que no es de ningun pedido` | Reclamación de un cobro que no es de la web.                            | Ídem.                                                                  |

---

## 6. Antes de cobrar de verdad

Hoy todo está en **modo prueba**. Para pasar a cobro real, en el panel de Stripe en modo
producción:

1. Registrar el mismo endpoint, con la misma URL y los mismos eventos. El modo producción
   tiene su **propia lista** de endpoints y su propio _Signing secret_.
2. Poner en Vercel `STRIPE_SECRET_KEY=sk_live_…` y el _Signing secret_ de ese endpoint.
3. Poner en `frontend/.env.production` `VITE_STRIPE_PUBLISHABLE_KEY=pk_live_…` y republicar.
4. Activar Bizum en _Configuración → Métodos de pago_ del modo producción.
5. Repetir las pruebas 1, 6 y 8 con importes pequeños.

Mezclar modos (`sk_test` con `pk_live`, o un endpoint de prueba con una clave de
producción) falla siempre.
