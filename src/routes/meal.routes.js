import express from 'express';
import {
  getMeals,
  getMealById,
  getMealCategories,
  getMyMenu,
  createMeal,
  updateMeal,
  deleteMeal,
} from '../controllers/meal.controller.js';
import auth from '../middleware/auth.js';
import roleGuard from '../middleware/roleGuard.js';

const router = express.Router();

// Public catalog. Static paths must be declared before '/:id'.
router.get('/', getMeals);
router.get('/categories', getMealCategories);

// Menu management for the kitchen that owns the meal (admins may act on any).
router.get('/my-menu', auth, roleGuard('restaurant', 'admin'), getMyMenu);
router.post('/', auth, roleGuard('restaurant', 'admin'), createMeal);
router.put('/:id', auth, roleGuard('restaurant', 'admin'), updateMeal);
router.delete('/:id', auth, roleGuard('restaurant', 'admin'), deleteMeal);

router.get('/:id', getMealById);

export default router;
