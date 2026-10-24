import express from 'express';
import {
  getOrganizationMembers,
  getOrganizationStats,
} from '../controllers/organization.controller.js';
import auth from '../middleware/auth.js';
import roleGuard from '../middleware/roleGuard.js';

const router = express.Router();

router.use(auth);
router.use(roleGuard('organization', 'admin'));

router.get('/members', getOrganizationMembers);
router.get('/stats', getOrganizationStats);

export default router;
