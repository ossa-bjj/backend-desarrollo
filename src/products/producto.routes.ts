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
} from './producto.controller';
import { isAuth, isAdmin } from '../shared/auth.middleware';
import upload from '../shared/file.middleware';

const router = Router();

// --- RUTAS PÚBLICAS ---
// El listado acepta todos los filtros por query string y son combinables, que
// es lo que las antiguas rutas /search, /destacados, /categoria/:categoria y
// /marca/:marca no permitían: cada una resolvía un criterio y solo uno.
router.get('/',                              getProductos);
// Antes de /:codigoArticulo, o el parámetro se comería la ruta.
router.get('/siguiente-codigo',              isAuth, isAdmin, getSiguienteCodigo);
router.get('/:codigoArticulo',               getProductoPorCodigo);

// --- RUTAS PROTEGIDAS ---
router.post('/',                                    isAuth, isAdmin, crearProducto);
router.put('/:codigoArticulo',                      isAuth, isAdmin, actualizarProducto);
router.patch('/:codigoArticulo/stock',              isAuth, isAdmin, actualizarStock);
router.post('/:codigoArticulo/imagenes',            isAuth, isAdmin, upload.array('imagenes', 10), anadirImagenes);
router.delete('/:codigoArticulo/imagenes',          isAuth, isAdmin, eliminarImagen);
router.delete('/:codigoArticulo',                   isAuth, isAdmin, eliminarProducto);

export default router;
