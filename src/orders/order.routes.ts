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
import {
  iniciarPago,
  capturarPago,
  iniciarPagoInvitado,
  capturarPagoInvitado,
  cancelarPedidoPropio,
  stripeWebhook,
  paypalWebhook,
} from '../payments/pago.controller';
import { cancelGuestOrder, createGuestOrder, getGuestOrder } from './invitado.controller';
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

// --- COMPRA SIN CUENTA ---
// Sin isAuth: el pedido lo protege su clave (cabecera X-Clave-Pedido), que se
// entrega al crearlo. Van antes que las rutas con :id por claridad; no chocan
// con ellas porque tienen un segmento mas.
router.post('/invitado', createGuestOrder);
router.get('/invitado/:id', getGuestOrder);
router.post('/invitado/:id/pago/iniciar', iniciarPagoInvitado);
router.post('/invitado/:id/pago/capturar', capturarPagoInvitado);
router.post('/invitado/:id/cancelar', cancelGuestOrder);

router.post('/:id/pago/iniciar', isAuth, iniciarPago);
// La vuelta del cliente al sitio: el otro camino por el que se cierra un pago
// de PayPal. Los dos son idempotentes y pueden llegar en cualquier orden.
router.post('/:id/pago/capturar', isAuth, capturarPago);
// El dueño abandona su pedido sin pagar y suelta sus horarios.
router.post('/:id/cancelar', isAuth, cancelarPedidoPropio);

router.get('/', isAuth, getOrders);
router.post('/', isAuth, createOrder);
router.get('/:id', isAuth, getOrderById);
router.patch('/:id/confirmar', isAuth, isAdmin, confirmOrder);
router.patch('/:id/rechazar', isAuth, isAdmin, rejectOrder);
router.patch('/:id/status', isAuth, isAdmin, updateOrderStatus);
router.delete('/:id', isAuth, isAdmin, deleteOrder);

export default router;
