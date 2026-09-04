import { Router } from 'express';
import {
  createOrder,
  deleteOrder,
  getOrderById,
  getOrders,
  updateOrderStatus,
  confirmOrder,
  rejectOrder,
} from './order.controller';
import { iniciarPago, capturarPago, stripeWebhook } from '../payments/pago.controller';
import { isAuth, isAdmin } from '../shared/auth.middleware';

const router = Router();

// --- PAGO ---
// El webhook va antes que las rutas con :id y sin isAuth: lo autentica la firma
// de Stripe. Su cuerpo llega en crudo (ver express.raw en index.ts).
router.post('/webhook', stripeWebhook);
router.post('/:id/pago/iniciar',  isAuth, iniciarPago);
// PayPal cierra el cobro aqui: no manda webhook en el flujo de captura.
router.post('/:id/pago/capturar', isAuth, capturarPago);

router.get('/',            isAuth,          getOrders);
router.post('/',           isAuth,          createOrder);
router.get('/:id',         isAuth,          getOrderById);
router.patch('/:id/confirmar', isAuth, isAdmin, confirmOrder);
router.patch('/:id/rechazar',  isAuth, isAdmin, rejectOrder);
router.patch('/:id/status',isAuth, isAdmin, updateOrderStatus);
router.delete('/:id',      isAuth, isAdmin, deleteOrder);

export default router;
