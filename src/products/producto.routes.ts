import { Router } from 'express';
import {
  getProductos,
  getProductoById,
  crearProducto,
  updateProducto,
  deleteProducto,
  searchProductos,
  getProductosByCategoria,
  getProductosByMarca,
  updateStock,
  getProductosDestacados,
  addImagenes,
  removeImagen,
} from './producto.controller';
import { isAuth, isAdmin } from '../shared/auth.middleware';
const upload = require('../shared/file.middleware');

const router = Router();

// --- RUTAS PÚBLICAS ---
router.get('/',                              getProductos);
router.get('/search',                        searchProductos);
router.get('/destacados',                    getProductosDestacados);
router.get('/categoria/:categoria',          getProductosByCategoria);
router.get('/marca/:marca',                  getProductosByMarca);
router.get('/:codigoArticulo',               getProductoById);

// --- RUTAS PROTEGIDAS ---
router.post('/',                                    isAuth, isAdmin, crearProducto);
router.put('/:codigoArticulo',                      isAuth, isAdmin, updateProducto);
router.patch('/:codigoArticulo/stock',              isAuth, isAdmin, updateStock);
router.post('/:codigoArticulo/imagenes',            isAuth, isAdmin, upload.array('imagenes', 10), addImagenes);
router.delete('/:codigoArticulo/imagenes',          isAuth, isAdmin, removeImagen);
router.delete('/:codigoArticulo',                   isAuth, isAdmin, deleteProducto);

export default router;
