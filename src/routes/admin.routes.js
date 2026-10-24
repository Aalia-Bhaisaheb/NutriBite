import express from 'express';
import {
  getPlatformStats,
  getUsers,
  deleteUser,
  getNutritionists,
  createNutritionist,
  updateNutritionist,
  deleteNutritionist,
  getRestaurants,
  createRestaurant,
  updateRestaurant,
  deleteRestaurant,
  getOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  getAllMeals,
  deleteMeal,
} from '../controllers/admin.controller.js';
import auth from '../middleware/auth.js';
import roleGuard from '../middleware/roleGuard.js';

const router = express.Router();

// Everything below is admin-only
router.use(auth);
router.use(roleGuard('admin'));

// Platform overview
router.get('/stats', getPlatformStats);

// Members & their subscription plans
router.route('/users').get(getUsers);
router.route('/users/:id').delete(deleteUser);

// Nutritionists
router.route('/nutritionists').get(getNutritionists).post(createNutritionist);
router.route('/nutritionists/:id').put(updateNutritionist).delete(deleteNutritionist);

// Restaurants
router.route('/restaurants').get(getRestaurants).post(createRestaurant);
router.route('/restaurants/:id').put(updateRestaurant).delete(deleteRestaurant);

// Organizations
router.route('/organizations').get(getOrganizations).post(createOrganization);
router.route('/organizations/:id').put(updateOrganization).delete(deleteOrganization);

// Catalog oversight
router.route('/meals').get(getAllMeals);
router.route('/meals/:id').delete(deleteMeal);

export default router;
