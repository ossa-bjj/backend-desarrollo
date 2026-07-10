import { Router } from 'express';
import {
  createOrder,
  deleteOrder,
  getOrderById,
  getOrders,
  updateOrderStatus,
} from './order.controller';
import { isAuth, isAdmin } from '../shared/auth.middleware';

const router = Router();

router.get('/',            isAuth,          getOrders);
router.post('/',           isAuth,          createOrder);
router.get('/:id',         isAuth,          getOrderById);
router.patch('/:id/status',isAuth, isAdmin, updateOrderStatus);
router.delete('/:id',      isAuth, isAdmin, deleteOrder);

export default router;
