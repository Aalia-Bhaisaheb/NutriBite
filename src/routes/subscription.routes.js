import express from 'express';
import { upgradeToPremium, getMySubscription } from '../controllers/subscription.controller.js';
import auth from '../middleware/auth.js';
import roleGuard from '../middleware/roleGuard.js';

const router = express.Router();

router.use(auth); // Protect all routes in this file

router.post('/upgrade', roleGuard('user'), upgradeToPremium);
router.get('/my', getMySubscription);

export default router;
