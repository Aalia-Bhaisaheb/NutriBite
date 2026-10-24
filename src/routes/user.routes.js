import express from 'express';
import {
  getMyNotifications,
  updateProfile,
  getMyDashboard,
  markNotificationsRead,
} from '../controllers/user.controller.js';
import auth from '../middleware/auth.js';

const router = express.Router();

router.use(auth);
router.get('/dashboard', getMyDashboard);
router.get('/notifications', getMyNotifications);
router.patch('/notifications/read-all', markNotificationsRead);
router.put('/profile', updateProfile);

export default router;
