import { Router } from 'express';
import {
  getServicios,
  getServiciosAdmin,
  buscarServicios,
  getServicioPorCodigo,
  crearServicio,
  actualizarServicio,
  alternarActivoServicio,
  anadirImagenesServicio,
  eliminarImagenServicio,
  establecerImagenPrincipalServicio,
  eliminarServicio,
} from './servicio.controller';
import { actualizarEstadoSolicitud, crearSolicitudDeServicio, getSolicitudes } from './solicitud.controller';
import { isAuth, isAdmin } from '../shared/auth.middleware';
import upload from '../shared/file.middleware';

const router = Router();

// --- RUTAS PUBLICAS ---
// Las rutas literales van antes que /:codigoArticulo para que no las capture.
router.get('/', getServicios);
router.get('/search', buscarServicios);
router.get('/admin/all', isAuth, isAdmin, getServiciosAdmin);
// Solicitudes de propuesta: la bandeja del admin va antes que /:codigoArticulo.
router.get('/solicitudes', isAuth, isAdmin, getSolicitudes);
router.patch('/solicitudes/:id', isAuth, isAdmin, actualizarEstadoSolicitud);
router.get('/:codigoArticulo', getServicioPorCodigo);
// Publica: la manda el formulario de «Solicitar propuesta» de cada servicio.
router.post('/:codigoArticulo/solicitudes', crearSolicitudDeServicio);

// --- RUTAS PROTEGIDAS ---
router.post('/', isAuth, isAdmin, crearServicio);
router.put('/:codigoArticulo', isAuth, isAdmin, actualizarServicio);
router.patch('/:codigoArticulo/activo', isAuth, isAdmin, alternarActivoServicio);
router.post(
  '/:codigoArticulo/imagenes',
  isAuth,
  isAdmin,
  upload.array('imagenes', 10),
  anadirImagenesServicio,
);
router.delete('/:codigoArticulo/imagenes', isAuth, isAdmin, eliminarImagenServicio);
router.patch('/:codigoArticulo/imagenes/principal', isAuth, isAdmin, establecerImagenPrincipalServicio);
router.delete('/:codigoArticulo', isAuth, isAdmin, eliminarServicio);

export default router;
