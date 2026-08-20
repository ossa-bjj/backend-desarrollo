import { Router } from 'express';
import {
  getServicios,
  getServiciosAdmin,
  searchServicios,
  getServicioById,
  crearServicio,
  updateServicio,
  toggleActivoServicio,
  addImagenesServicio,
  removeImagenServicio,
  deleteServicio,
} from './servicio.controller';
import { isAuth, isAdmin } from '../shared/auth.middleware';
import upload from '../shared/file.middleware';

const router = Router();

// --- RUTAS PUBLICAS ---
// Las rutas literales van antes que /:codigoArticulo para que no las capture.
router.get('/',                    getServicios);
router.get('/search',              searchServicios);
router.get('/admin/all',           isAuth, isAdmin, getServiciosAdmin);
router.get('/:codigoArticulo',     getServicioById);

// --- RUTAS PROTEGIDAS ---
router.post('/',                              isAuth, isAdmin, crearServicio);
router.put('/:codigoArticulo',                isAuth, isAdmin, updateServicio);
router.patch('/:codigoArticulo/activo',       isAuth, isAdmin, toggleActivoServicio);
router.post('/:codigoArticulo/imagenes',      isAuth, isAdmin, upload.array('imagenes', 10), addImagenesServicio);
router.delete('/:codigoArticulo/imagenes',    isAuth, isAdmin, removeImagenServicio);
router.delete('/:codigoArticulo',             isAuth, isAdmin, deleteServicio);

export default router;
