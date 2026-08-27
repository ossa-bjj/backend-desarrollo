import { Router } from 'express';
import {
  register,
  login,
  me,
  forgotPassword,
  resetPassword,
} from './auth.controller';
import {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  updatePassword,
  updateStatus,
  deleteUser,
} from './user.controller';
import {
  updateCustomer,
  updateSportsProfile,
  removeSportsProfile,
  addAddress,
  updateAddress,
  removeAddress,
} from './user-profile.controller';
import {
  updateMembership,
  getMembershipPayments,
  addMembershipPayment,
  updateMembershipPayment,
  removeMembershipPayment,
} from './user-membership.controller';
import { isAuth, isAdmin } from '../shared/auth.middleware';

const router = Router();

// --- RUTAS PÚBLICAS ---

router.post('/register',        register);
router.post('/login',           login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password',  resetPassword);

// --- RUTAS PROTEGIDAS ---

router.get('/me',                         isAuth,          me);
router.post('/',                          isAuth, isAdmin, createUser);
router.get('/',                           isAuth, isAdmin, getAllUsers);
router.get('/:id',                        isAuth, isAdmin, getUserById);
router.put('/:id',                        isAuth,          updateUser);
router.patch('/:id/password',             isAuth,          updatePassword);
router.patch('/:id/status',               isAuth, isAdmin, updateStatus);
router.patch('/:id/customer',             isAuth, isAdmin, updateCustomer);
router.patch('/:id/sports-profile',       isAuth, isAdmin, updateSportsProfile);
router.delete('/:id/sports-profile',      isAuth, isAdmin, removeSportsProfile);
router.patch('/:id/membership',           isAuth, isAdmin, updateMembership);
router.post('/:id/addresses',             isAuth,          addAddress);
router.patch('/:id/addresses/:addressId', isAuth,          updateAddress);
router.delete('/:id/addresses/:addressId',isAuth,          removeAddress);
router.get('/:id/membership-payments',    isAuth, isAdmin, getMembershipPayments);
router.post('/:id/membership-payments',   isAuth, isAdmin, addMembershipPayment);
router.patch('/:id/membership-payments/:paymentId', isAuth, isAdmin, updateMembershipPayment);
router.delete('/:id/membership-payments/:paymentId',isAuth, isAdmin, removeMembershipPayment);
router.delete('/:id',                     isAuth, isAdmin, deleteUser);

export default router;
