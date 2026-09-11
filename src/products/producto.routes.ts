import { Router } from 'express';
import {
  getProductos,
  getSiguienteCodigo,
  getProductoPorCodigo,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  actualizarStock,
  anadirImagenes,
  eliminarImagen,
  presignImagenes,
  confirmarImagenes,
  establecerImagenPrincipal,
  alternarActivoProducto,
} from './producto.controller';
import { isAuth, isAdmin, optionalAuth } from '../shared/auth.middleware';
import upload from '../shared/file.middleware';

const router = Router();

// --- RUTAS PÚBLICAS / VISTA AMPLIADA ---
// El listado acepta todos los filtros por query string. optionalAuth permite que
// el administrador autenticado reciba también los productos desactivados/ocultos.
router.get('/', optionalAuth, getProductos);
// Antes de /:codigoArticulo, o el parámetro se comería la ruta.
router.get('/siguiente-codigo', isAuth, isAdmin, getSiguienteCodigo);
router.get('/:codigoArticulo', optionalAuth, getProductoPorCodigo);

// --- RUTAS PROTEGIDAS (ADMIN) ---
router.post('/', isAuth, isAdmin, crearProducto);
router.put('/:codigoArticulo', isAuth, isAdmin, actualizarProducto);
router.patch('/:codigoArticulo/stock', isAuth, isAdmin, actualizarStock);
router.patch('/:codigoArticulo/activo', isAuth, isAdmin, alternarActivoProducto);
router.patch('/:codigoArticulo/imagenes/principal', isAuth, isAdmin, establecerImagenPrincipal);
router.post('/:codigoArticulo/imagenes/presign', isAuth, isAdmin, presignImagenes);
router.post('/:codigoArticulo/imagenes/confirmar', isAuth, isAdmin, confirmarImagenes);
router.post('/:codigoArticulo/imagenes', isAuth, isAdmin, upload.array('imagenes', 10), anadirImagenes);
router.delete('/:codigoArticulo/imagenes', isAuth, isAdmin, eliminarImagen);
router.delete('/:codigoArticulo', isAuth, isAdmin, eliminarProducto);

export default router;
