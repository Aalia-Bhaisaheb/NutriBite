import Subscription from '../models/Subscription.js';
import User from '../models/User.js';
import Nutritionist from '../models/Nutritionist.js';
import Notification from '../models/Notification.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';

// @desc    Upgrade to premium & assign nutritionist
// @route   POST /api/subscriptions/upgrade
// @access  Private (User)
export const upgradeToPremium = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (user.subscriptionTier === 'premium') {
    throw new ApiError(400, 'User is already on a premium plan');
  }

  // 1. Load-balance: assign the nutritionist currently carrying the fewest clients
  const availableNutritionists = await Nutritionist.find()
    .sort({ clientsCount: 1 })
    .limit(1);

  if (availableNutritionists.length === 0) {
    throw new ApiError(500, 'No nutritionists available at the moment');
  }

  const assignedNutritionist = availableNutritionists[0];

  // 2. Update Nutritionist client count
  assignedNutritionist.clientsCount += 1;
  await assignedNutritionist.save();

  // 3. Update User
  user.subscriptionTier = 'premium';
  user.assignedNutritionist = assignedNutritionist._id;
  await user.save();

  // 4. Create Subscription record
  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + 1); // 1 month from now

  const subscription = await Subscription.create({
    user: user._id,
    plan: 'premium',
    startDate,
    endDate,
    priceMonthly: 2999, // ₹2999 in INR
  });

  // 5. Notify the user and nutritionist
  await Notification.create({
    recipient: user._id,
    title: 'Premium Upgrade Successful',
    message: `Welcome to Premium! You have been assigned to ${assignedNutritionist.title}.`,
    type: 'success',
  });

  await Notification.create({
    recipient: assignedNutritionist.user,
    title: 'New Client Assigned',
    message: `${user.fullName} has joined your premium roster.`,
    type: 'info',
  });

  res.status(200).json({
    success: true,
    data: {
      subscription,
      assignedNutritionist: {
        _id: assignedNutritionist._id,
        title: assignedNutritionist.title,
      }
    },
  });
});

// @desc    Get current subscription
// @route   GET /api/subscriptions/my
// @access  Private
export const getMySubscription = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findOne({
    user: req.user.id,
    isActive: true
  }).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: subscription || { plan: 'free' },
  });
});
