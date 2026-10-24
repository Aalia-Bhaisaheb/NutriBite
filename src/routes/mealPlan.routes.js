import express from 'express';
import {
  createMealPlan,
  updateMealPlan,
  deleteMealPlan,
  getMealPlanById,
  submitMealPlan,
  approveMealPlan,
  rejectMealPlan,
  confirmMealPlan,
  getMyMealPlan
} from '../controllers/mealPlan.controller.js';
import auth from '../middleware/auth.js';
import roleGuard from '../middleware/roleGuard.js';

const router = express.Router();

router.use(auth);

// User viewing their own plan
router.get('/my', getMyMealPlan);

// Shared specific plan fetch
router.get('/:id', getMealPlanById);

// Nutritionist specific actions
router.post('/', roleGuard('nutritionist'), createMealPlan);
router.put('/:id', roleGuard('nutritionist'), updateMealPlan);
router.delete('/:id', roleGuard('nutritionist'), deleteMealPlan);
router.patch('/:id/submit', roleGuard('nutritionist'), submitMealPlan);
router.patch('/:id/confirm', roleGuard('nutritionist'), confirmMealPlan);

// User specific actions
router.patch('/:id/approve', roleGuard('user'), approveMealPlan);
router.patch('/:id/reject', roleGuard('user'), rejectMealPlan);

export default router;
