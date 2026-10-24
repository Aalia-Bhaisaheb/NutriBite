import express from 'express';
import { createOrder, getMyOrders, updateOrderStatus } from '../controllers/order.controller.js';
import auth from '../middleware/auth.js';
import roleGuard from '../middleware/roleGuard.js';

const router = express.Router();

router.use(auth);

router.post('/', createOrder);
router.get('/my', getMyOrders);
router.patch('/:id/status', roleGuard('restaurant', 'admin'), updateOrderStatus);

export default router;
