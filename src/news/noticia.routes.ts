import { Router } from 'express';
import {
  getNoticias,
  getNoticiasAdmin,
  crearNoticia,
  actualizarNoticia,
  alternarPublicacionNoticia,
  eliminarNoticia,
} from './noticia.controller';
import { isAuth, isAdmin } from '../shared/auth.middleware';

const router = Router();

// --- RUTAS PUBLICAS ---
// Las rutas literales van antes que /:id para que no las capture.
router.get('/',              getNoticias);
router.get('/admin/all',     isAuth, isAdmin, getNoticiasAdmin);

// --- RUTAS PROTEGIDAS ---
router.post('/',                  isAuth, isAdmin, crearNoticia);
router.put('/:id',                isAuth, isAdmin, actualizarNoticia);
router.patch('/:id/publicar',     isAuth, isAdmin, alternarPublicacionNoticia);
router.delete('/:id',             isAuth, isAdmin, eliminarNoticia);

export default router;
