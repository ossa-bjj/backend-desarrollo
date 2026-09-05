import 'dotenv/config';

/**
 * Prueba de humo de la API contra un servidor ya levantado.
 *
 * No sustituye a unos tests de verdad: recorre el camino feliz de cada dominio
 * y los rechazos que deben ocurrir, y sirve para responder en un minuto a «¿esto
 * sigue en pie?» después de tocar algo. Es lo que el proyecto no tenía.
 *
 *   pnpm dev      (en otra terminal)
 *   pnpm humo
 *
 * Trabaja contra la base de datos real del entorno, así que **se limpia lo que
 * crea**. Los datos de prueba llevan el prefijo `HUMO` para reconocerlos si
 * alguna ejecución se corta a medias.
 */

const BASE = process.env.URL_HUMO ?? 'http://localhost:3000/api';
const USUARIO = process.env.USUARIO_HUMO ?? 'admin';
const CLAVE = process.env.CLAVE_HUMO ?? 'Admin1234!';

let ok = 0;
let fallos = 0;
let token = '';

interface Respuesta {
  estado: number;
  cuerpo: Record<string, unknown>;
}

const llamar = async (
  metodo: string,
  ruta: string,
  cuerpo?: unknown,
  conToken = true,
): Promise<Respuesta> => {
  const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' };
  if (conToken && token) cabeceras.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

  const texto = await res.text();
  let parseado: Record<string, unknown> = {};
  try {
    parseado = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
  } catch {
    parseado = { crudo: texto };
  }
  return { estado: res.status, cuerpo: parseado };
};

const comprobar = async (
  nombre: string,
  esperado: number,
  metodo: string,
  ruta: string,
  cuerpo?: unknown,
  conToken = true,
): Promise<Respuesta> => {
  const r = await llamar(metodo, ruta, cuerpo, conToken);
  const bien = r.estado === esperado;
  bien ? ok++ : fallos++;
  console.log(`  ${bien ? 'OK   ' : 'FALLO'} ${nombre} -> ${r.estado} (esperado ${esperado})`);
  if (!bien) console.log(`         ${JSON.stringify(r.cuerpo)}`);
  return r;
};

const datos = (r: Respuesta) => r.cuerpo.data as Record<string, unknown>;
const titulo = (t: string) => console.log(`\n===== ${t} =====`);

const main = async (): Promise<void> => {
  titulo('AUTENTICACION');
  const acceso = await comprobar('login', 200, 'POST', '/users/login', { username: USUARIO, password: CLAVE }, false);
  token = String((datos(acceso)?.token as string) ?? '');
  if (!token) throw new Error('Sin token: el resto de la prueba no tiene sentido');
  await comprobar('login con clave mala', 401, 'POST', '/users/login', { username: USUARIO, password: 'noesesta' }, false);
  await comprobar('me sin token', 401, 'GET', '/users/me', undefined, false);
  await comprobar('me con token', 200, 'GET', '/users/me');

  titulo('PRODUCTOS');
  await comprobar('listado publico', 200, 'GET', '/productos?limite=5', undefined, false);
  await comprobar('categoria invalida', 400, 'GET', '/productos?categoria=INVENTADA', undefined, false);
  const propuesto = await comprobar('siguiente codigo libre', 200, 'GET', '/productos/siguiente-codigo?categoria=ACCESORIOS');
  const codigo = Number(datos(propuesto).codigo);

  const producto = {
    codigoArticulo: codigo,
    name: 'HUMO producto',
    price: 9.9,
    stock: 3,
    category: 'ACCESORIOS',
    subcategoria: 'General',
    description: 'creado por la prueba de humo',
    tags: ['humo'],
  };
  await comprobar('crear', 201, 'POST', '/productos', producto);
  await comprobar('crear sin token', 401, 'POST', '/productos', producto, false);
  // Un campo obligatorio que falta es peticion mal formada, no fallo del servidor.
  await comprobar('crear sin campo obligatorio', 400, 'POST', '/productos', {
    codigoArticulo: 4098, name: 'x', price: 1, stock: 1, category: 'ACCESORIOS', description: 'x',
  });
  await comprobar('editar', 200, 'PUT', `/productos/${codigo}`, { name: 'HUMO editado', price: 12.5, category: 'ACCESORIOS' });
  await comprobar('cambiar stock', 200, 'PATCH', `/productos/${codigo}/stock`, { stock: 7 });
  await comprobar('borrar', 200, 'DELETE', `/productos/${codigo}`);
  await comprobar('ya no existe', 404, 'GET', `/productos/${codigo}`, undefined, false);

  titulo('SERVICIOS');
  await comprobar('listado publico', 200, 'GET', '/servicios', undefined, false);
  await comprobar('listado admin sin token', 401, 'GET', '/servicios/admin/all', undefined, false);
  const CODIGO_SERVICIO = 6099;
  await comprobar('crear', 201, 'POST', '/servicios', {
    codigoArticulo: CODIGO_SERVICIO, nombre: 'HUMO servicio', precio: 30, subcategoria: 'General',
    descripcionCorta: 'corta', descripcionCompleta: 'completa', modalidad: 'presencial',
    duracion: 60, plazas: 1, requiereReserva: true, requiereConfirmacion: false, activo: true, tags: [], orden: 0,
  });
  await comprobar('editar', 200, 'PUT', `/servicios/${CODIGO_SERVICIO}`, { nombre: 'HUMO servicio editado', precio: 35 });
  await comprobar('alternar visibilidad', 200, 'PATCH', `/servicios/${CODIGO_SERVICIO}/activo`, { activo: false });

  titulo('DISPONIBILIDAD');
  const hoy = new Date().toISOString().slice(0, 10);
  const dentroDeTres = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await comprobar('consulta publica', 200, 'GET', `/disponibilidad?servicio=${CODIGO_SERVICIO}&desde=${hoy}&hasta=${dentroDeTres}`, undefined, false);

  const lote = {
    servicio: CODIGO_SERVICIO, desde: hoy, hasta: dentroDeTres,
    horaInicio: '10:00', horaFin: '12:00', duracion: 60, diasSemana: [0, 1, 2, 3, 4, 5, 6],
  };
  const generado = await comprobar('generar parrilla', 201, 'POST', '/disponibilidad/batch', lote);
  const repetido = await comprobar('generar otra vez', 201, 'POST', '/disponibilidad/batch', lote);
  // La segunda pasada no puede crear nada: el indice unico lo impide.
  const duplicados = Number(datos(repetido).creados);
  if (duplicados === 0) { ok++; console.log('  OK    la repeticion no duplica slots'); }
  else { fallos++; console.log(`  FALLO la repeticion creo ${duplicados} slots duplicados`); }
  console.log(`         primera: ${JSON.stringify(datos(generado))}`);

  const listado = await comprobar('listar slots', 200, 'GET', `/disponibilidad?servicio=${CODIGO_SERVICIO}&desde=${hoy}&hasta=${dentroDeTres}&admin=true`);
  const slots = (listado.cuerpo.data as Array<{ _id: string }>) ?? [];
  if (slots.length > 0) {
    await comprobar('bloquear', 200, 'PATCH', `/disponibilidad/${slots[0]._id}/bloquear`);
    await comprobar('desbloquear', 200, 'PATCH', `/disponibilidad/${slots[0]._id}/desbloquear`);
  }

  titulo('NOTICIAS');
  await comprobar('listado publico', 200, 'GET', '/noticias', undefined, false);
  const noticia = await comprobar('crear', 201, 'POST', '/noticias', {
    titulo: 'HUMO noticia', extracto: 'x', contenido: 'y', categoria: 'CLUB',
  });
  const idNoticia = String(datos(noticia)._id);
  await comprobar('categoria invalida', 400, 'POST', '/noticias', { titulo: 'x', extracto: 'x', contenido: 'x', categoria: 'NOEXISTE' });
  await comprobar('editar', 200, 'PUT', `/noticias/${idNoticia}`, { titulo: 'HUMO noticia editada' });

  // La portada admite el codigo de insercion de Instagram: se guarda el enlace.
  const conPost = await comprobar('portada con codigo de insercion', 200, 'PUT', `/noticias/${idNoticia}`, {
    imagenPortada: '<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/2wHrfDnNdx/?utm_source=ig_embed"></blockquote>',
  });
  const enlace = String(datos(conPost).instagramPost ?? '');
  if (enlace === 'https://www.instagram.com/p/2wHrfDnNdx/') { ok++; console.log('  OK    extrae el enlace del post'); }
  else { fallos++; console.log(`  FALLO enlace extraido: "${enlace}"`); }

  await comprobar('portada que no lleva a una imagen', 400, 'PUT', `/noticias/${idNoticia}`, { imagenPortada: 'https://example.com/' });
  await comprobar('publicar', 200, 'PATCH', `/noticias/${idNoticia}/publicar`);
  await comprobar('borrar', 200, 'DELETE', `/noticias/${idNoticia}`);

  titulo('PEDIDOS Y PAGOS');
  await comprobar('listado', 200, 'GET', '/pedidos?limite=5');
  await comprobar('listado sin token', 401, 'GET', '/pedidos', undefined, false);

  const catalogo = await llamar('GET', '/productos?limite=1', undefined, false);
  const primero = (catalogo.cuerpo.data as Array<{ codigoArticulo: number }>)[0];
  const pedido = await comprobar('crear pedido', 201, 'POST', '/pedidos', {
    items: [{ codigoArticulo: primero.codigoArticulo, quantity: 1 }],
  });
  const idPedido = String(datos(pedido)._id);

  await comprobar('metodo de pago inexistente', 400, 'POST', `/pedidos/${idPedido}/pago/iniciar`, { metodo: 'bitcoin' });
  await comprobar('paypal sin URL de retorno', 400, 'POST', `/pedidos/${idPedido}/pago/iniciar`, { metodo: 'paypal' });
  await comprobar('URL de retorno de otro dominio', 400, 'POST', `/pedidos/${idPedido}/pago/iniciar`, { metodo: 'paypal', returnUrl: 'no-es-una-url' });
  await comprobar('capturar sin pago de paypal', 409, 'POST', `/pedidos/${idPedido}/pago/capturar`, {});
  await comprobar('webhook de stripe sin firma', 400, 'POST', '/pedidos/webhook', { type: 'x' }, false);
  await comprobar('webhook de paypal sin firma', 400, 'POST', '/pedidos/webhook/paypal', { event_type: 'x' }, false);
  await comprobar('cambiar estado', 200, 'PATCH', `/pedidos/${idPedido}/status`, { status: 'cancelado' });
  await comprobar('borrar pedido', 200, 'DELETE', `/pedidos/${idPedido}`);

  titulo('USUARIOS');
  await comprobar('listar', 200, 'GET', '/users?limite=5');
  await comprobar('filtro de rol invalido', 400, 'GET', '/users?role=inventado');
  await comprobar('pedir recuperacion', 200, 'POST', '/users/forgot-password', { email: 'admin@arturosalas.com' }, false);
  await comprobar('reset con token falso', 400, 'POST', '/users/reset-password', { token: 'falso', newPassword: 'Larga1234' }, false);
  await comprobar('reset con clave corta', 400, 'POST', '/users/reset-password', { token: 'x', newPassword: 'ab' }, false);

  titulo('ROBUSTEZ');
  await comprobar('ruta inexistente', 404, 'GET', '/no-existe-esta-ruta', undefined, false);
  // Un cuerpo ilegible es culpa de quien llama: 400, no 500.
  const roto = await fetch(`${BASE}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{esto no es json',
  });
  if (roto.status === 400) { ok++; console.log('  OK    json ilegible -> 400'); }
  else { fallos++; console.log(`  FALLO json ilegible -> ${roto.status} (esperado 400)`); }

  titulo('LIMPIEZA');
  await comprobar('borrar el servicio de prueba', 200, 'DELETE', `/servicios/${CODIGO_SERVICIO}`);

  console.log(`\n==================== RESULTADO ====================`);
  console.log(`  OK: ${ok}    FALLOS: ${fallos}\n`);
  if (fallos > 0) process.exit(1);
};

main().catch((error: unknown) => {
  console.error('\nLa prueba de humo no pudo terminar:', (error as Error).message);
  console.error('Comprueba que el servidor esta levantado (pnpm dev).');
  process.exit(1);
});
