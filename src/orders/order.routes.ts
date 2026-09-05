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
import { iniciarPago, capturarPago, stripeWebhook, paypalWebhook } from '../payments/pago.controller';
import { isAuth, isAdmin } from '../shared/auth.middleware';

const router = Router();

// --- PAGO ---
// El webhook va antes que las rutas con :id y sin isAuth: lo autentica la firma
// de Stripe. Su cuerpo llega en crudo (ver express.raw en index.ts).
router.post('/webhook', stripeWebhook);
// PayPal avisa por su cuenta cuando el cliente aprueba, aunque no vuelva al
// sitio. Su firma se verifica preguntandole a PayPal, asi que este cuerpo si
// puede llegar ya parseado.
router.post('/webhook/paypal', paypalWebhook);

router.post('/:id/pago/iniciar',  isAuth, iniciarPago);
// La vuelta del cliente al sitio: el otro camino por el que se cierra un pago
// de PayPal. Los dos son idempotentes y pueden llegar en cualquier orden.
router.post('/:id/pago/capturar', isAuth, capturarPago);

router.get('/',            isAuth,          getOrders);
router.post('/',           isAuth,          createOrder);
router.get('/:id',         isAuth,          getOrderById);
router.patch('/:id/confirmar', isAuth, isAdmin, confirmOrder);
router.patch('/:id/rechazar',  isAuth, isAdmin, rejectOrder);
router.patch('/:id/status',isAuth, isAdmin, updateOrderStatus);
router.delete('/:id',      isAuth, isAdmin, deleteOrder);

export default router;
