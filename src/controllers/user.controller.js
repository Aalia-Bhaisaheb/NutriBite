import Notification from '../models/Notification.js';
import User from '../models/User.js';
import MealPlan from '../models/MealPlan.js';
import Order from '../models/Order.js';
import Subscription from '../models/Subscription.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';

// @desc    Get user notifications
// @route   GET /api/users/notifications
// @access  Private
export const getMyNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ recipient: req.user.id })
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, count: notifications.length, data: notifications });
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
export const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new ApiError(404, 'User not found');

  user.fullName = req.body.fullName || user.fullName;
  user.phone = req.body.phone || user.phone;
  user.avatar = req.body.avatar || user.avatar;
  user.deliveryAddress = req.body.deliveryAddress ?? user.deliveryAddress;

  if (req.body.healthProfile) {
    user.healthProfile = { ...user.healthProfile, ...req.body.healthProfile };
  }

  await user.save();
  res.status(200).json({ success: true, data: user });
});

// @desc    Live dashboard payload for the logged-in member
// @route   GET /api/users/dashboard
// @access  Private (User)
export const getMyDashboard = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).populate({
    path: 'assignedNutritionist',
    select: 'title specialization image rating availability',
    populate: { path: 'user', select: 'fullName avatar email' },
  });
  if (!user) throw new ApiError(404, 'User not found');

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const thirtyDaysAgo = new Date(startOfToday.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Current plan, if the nutritionist has published one
  const mealPlan = await MealPlan.findOne({
    user: user._id,
    status: { $in: ['confirmed', 'active', 'approved'] },
  })
    .sort({ createdAt: -1 })
    .populate({ path: 'days.meals.meal', select: 'name calories protein carbs fat image' })
    .populate({ path: 'days.meals.restaurant', select: 'restaurantName' })
    .lean();

  // Today's meals come from the day of the plan that matches today's weekday
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const todaysDay = mealPlan?.days?.find((d) => d.dayOfWeek === weekday) || null;

  const todaysMeals = (todaysDay?.meals || []).map((m) => ({
    mealType: m.mealType,
    name: m.meal?.name || m.customName || 'Meal',
    image: m.meal?.image || null,
    calories: m.calories ?? m.meal?.calories ?? 0,
    protein: m.protein ?? m.meal?.protein ?? 0,
    restaurant: m.restaurant?.restaurantName || null,
    deliveryTime: m.deliveryTime || null,
    specialRequirements: m.specialRequirements || null,
  }));

  const consumedToday = todaysMeals.reduce(
    (acc, m) => ({
      calories: acc.calories + (m.calories || 0),
      protein: acc.protein + (m.protein || 0),
    }),
    { calories: 0, protein: 0 }
  );

  const [ordersToday, unreadNotifications, recentOrders, scheduledLast30, deliveredLast30] =
    await Promise.all([
      Order.countDocuments({ user: user._id, createdAt: { $gte: startOfToday, $lt: endOfToday } }),
      Notification.countDocuments({ recipient: user._id, isRead: false }),
      Order.find({ user: user._id })
        .populate('restaurant', 'restaurantName')
        .populate('items.meal', 'name image')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Order.countDocuments({ user: user._id, isScheduled: true, scheduledDate: { $gte: thirtyDaysAgo } }),
      Order.countDocuments({
        user: user._id,
        isScheduled: true,
        status: 'delivered',
        scheduledDate: { $gte: thirtyDaysAgo },
      }),
    ]);

  const adherencePercent = scheduledLast30 > 0
    ? Math.round((deliveredLast30 / scheduledLast30) * 100)
    : null;

  const subscription = await Subscription.findOne({ user: user._id })
    .sort({ createdAt: -1 })
    .lean();

  const now = new Date();
  const subscriptionActive = Boolean(
    subscription && subscription.isActive && new Date(subscription.endDate) > now
  );

  res.status(200).json({
    success: true,
    data: {
      profile: {
        fullName: user.fullName,
        email: user.email,
        avatar: user.avatar,
        subscriptionTier: user.subscriptionTier,
        healthProfile: user.healthProfile || {},
      },
      targets: {
        calories: user.healthProfile?.caloriesTarget || null,
        protein: user.healthProfile?.proteinTarget || null,
      },
      today: {
        weekday,
        meals: todaysMeals,
        plannedCalories: consumedToday.calories,
        plannedProtein: consumedToday.protein,
        ordersToday,
      },
      mealPlan: mealPlan
        ? {
            _id: mealPlan._id,
            title: mealPlan.title,
            status: mealPlan.status,
            startDate: mealPlan.startDate,
            endDate: mealPlan.endDate,
            daysCount: mealPlan.days?.length || 0,
          }
        : null,
      nutritionist: user.assignedNutritionist
        ? {
            _id: user.assignedNutritionist._id,
            name: user.assignedNutritionist.user?.fullName || null,
            title: user.assignedNutritionist.title,
            specialization: user.assignedNutritionist.specialization,
            image: user.assignedNutritionist.image || user.assignedNutritionist.user?.avatar || null,
            rating: user.assignedNutritionist.rating,
            availability: user.assignedNutritionist.availability,
          }
        : null,
      subscription: subscription
        ? {
            plan: subscription.plan,
            isActive: subscriptionActive,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            priceMonthly: subscription.priceMonthly,
          }
        : null,
      adherencePercent,
      unreadNotifications,
      recentOrders,
    },
  });
});

// @desc    Mark all notifications as read
// @route   PATCH /api/users/notifications/read-all
// @access  Private
export const markNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: req.user.id, isRead: false }, { isRead: true });
  res.status(200).json({ success: true, message: 'Notifications marked as read.' });
});
