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
  eliminarServicio,
} from './servicio.controller';
import { isAuth, isAdmin } from '../shared/auth.middleware';
import upload from '../shared/file.middleware';

const router = Router();

// --- RUTAS PUBLICAS ---
// Las rutas literales van antes que /:codigoArticulo para que no las capture.
router.get('/',                    getServicios);
router.get('/search',              buscarServicios);
router.get('/admin/all',           isAuth, isAdmin, getServiciosAdmin);
router.get('/:codigoArticulo',     getServicioPorCodigo);

// --- RUTAS PROTEGIDAS ---
router.post('/',                              isAuth, isAdmin, crearServicio);
router.put('/:codigoArticulo',                isAuth, isAdmin, actualizarServicio);
router.patch('/:codigoArticulo/activo',       isAuth, isAdmin, alternarActivoServicio);
router.post('/:codigoArticulo/imagenes',      isAuth, isAdmin, upload.array('imagenes', 10), anadirImagenesServicio);
router.delete('/:codigoArticulo/imagenes',    isAuth, isAdmin, eliminarImagenServicio);
router.delete('/:codigoArticulo',             isAuth, isAdmin, eliminarServicio);

export default router;
