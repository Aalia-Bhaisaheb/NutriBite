import express from 'express';
import {
  getNutritionists,
  getMyClients,
  scheduleMeeting,
  getMyMeetings,
  completeMeeting,
  getMyStats,
  getMyMealPlans
} from '../controllers/nutritionist.controller.js';
import auth from '../middleware/auth.js';
import roleGuard from '../middleware/roleGuard.js';

const router = express.Router();

router.get('/', getNutritionists); // Public

router.use(auth); // Protect all routes below

// Nutritionist profile/clients
router.get('/my-clients', roleGuard('nutritionist'), getMyClients);
router.get('/my-stats', roleGuard('nutritionist'), getMyStats);
router.get('/my-plans', roleGuard('nutritionist'), getMyMealPlans);

// Meetings routes - conceptually lumped in here for now
router.post('/meetings', roleGuard('nutritionist', 'user'), scheduleMeeting);
router.get('/meetings/my', getMyMeetings);
router.patch('/meetings/:id/complete', roleGuard('nutritionist'), completeMeeting);

export default router;
