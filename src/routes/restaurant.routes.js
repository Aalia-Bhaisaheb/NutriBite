import express from 'express';
import {
  getDashboardSummary,
  getDeliverySchedule,
  getScheduledOrdersForTomorrow,
  getRestaurantOrders,
  getIngredientsForecast,
} from '../controllers/restaurant.controller.js';
import auth from '../middleware/auth.js';
import roleGuard from '../middleware/roleGuard.js';

const router = express.Router();

router.use(auth);
router.use(roleGuard('restaurant'));

router.get('/dashboard', getDashboardSummary);
router.get('/delivery-schedule', getDeliverySchedule);
router.get('/scheduled-orders', getScheduledOrdersForTomorrow);
router.get('/orders', getRestaurantOrders);
router.get('/ingredients-forecast', getIngredientsForecast);

export default router;