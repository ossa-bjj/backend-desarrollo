import { Router } from 'express';
import {
  getProductos,
  getProductoPorCodigo,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
  buscarProductos,
  getProductosPorCategoria,
  getProductosPorMarca,
  actualizarStock,
  getProductosDestacados,
  anadirImagenes,
  eliminarImagen,
} from './producto.controller';
import { isAuth, isAdmin } from '../shared/auth.middleware';
import upload from '../shared/file.middleware';

const router = Router();

// --- RUTAS PÚBLICAS ---
router.get('/',                              getProductos);
router.get('/search',                        buscarProductos);
router.get('/destacados',                    getProductosDestacados);
router.get('/categoria/:categoria',          getProductosPorCategoria);
router.get('/marca/:marca',                  getProductosPorMarca);
router.get('/:codigoArticulo',               getProductoPorCodigo);

// --- RUTAS PROTEGIDAS ---
router.post('/',                                    isAuth, isAdmin, crearProducto);
router.put('/:codigoArticulo',                      isAuth, isAdmin, actualizarProducto);
router.patch('/:codigoArticulo/stock',              isAuth, isAdmin, actualizarStock);
router.post('/:codigoArticulo/imagenes',            isAuth, isAdmin, upload.array('imagenes', 10), anadirImagenes);
router.delete('/:codigoArticulo/imagenes',          isAuth, isAdmin, eliminarImagen);
router.delete('/:codigoArticulo',                   isAuth, isAdmin, eliminarProducto);

export default router;
