import { Router } from 'express';
import {
  getDisponibilidad,
  crearDisponibilidad,
  generarDisponibilidad,
  bloquearDisponibilidad,
  desbloquearDisponibilidad,
  eliminarDisponibilidad,
} from './disponibilidad.controller';
import { isAuth, isAdmin, optionalAuth } from '../shared/auth.middleware';

const router = Router();

// --- RUTA PUBLICA ---
// Sin token devuelve solo los slots reservables. Con ?admin=true y token de
// admin devuelve tambien ocupados, bloqueados y fechas pasadas.
router.get('/', optionalAuth, getDisponibilidad);

// --- RUTAS PROTEGIDAS ---
router.post('/',                   isAuth, isAdmin, crearDisponibilidad);
router.post('/batch',              isAuth, isAdmin, generarDisponibilidad);
router.patch('/:id/bloquear',      isAuth, isAdmin, bloquearDisponibilidad);
router.patch('/:id/desbloquear',   isAuth, isAdmin, desbloquearDisponibilidad);
router.delete('/:id',              isAuth, isAdmin, eliminarDisponibilidad);

export default router;
