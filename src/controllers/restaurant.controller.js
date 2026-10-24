import Restaurant from '../models/Restaurant.js';
import Order from '../models/Order.js';
import Meal from '../models/Meal.js';
import MealPlan from '../models/MealPlan.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const startOfDay = (d) => {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const dateKey = (d) => d.toISOString().slice(0, 10);

/**
 * Builds a day-by-day delivery calendar for one kitchen, straight from
 * confirmed/active meal plans. This is the source of truth for what a
 * restaurant has to cook and when — it doesn't depend on the nightly
 * scheduler having run yet, so a plan shows up here the moment a
 * nutritionist assigns it.
 */
const computeDeliverySchedule = async (restaurantId, { from, windowDays }) => {
  const rangeStart = startOfDay(from);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + windowDays - 1);

  const plans = await MealPlan.find({
    status: { $in: ['confirmed', 'active'] },
    'days.meals.restaurant': restaurantId,
    $or: [{ endDate: { $gte: rangeStart } }, { endDate: null }],
  })
    .populate('user', 'fullName phone deliveryAddress')
    .populate('days.meals.meal', 'name image ingredients')
    .lean();

  const byDate = new Map();
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(rangeStart);
    d.setDate(d.getDate() + i);
    const key = dateKey(d);
    byDate.set(key, { date: key, dayOfWeek: DAY_NAMES[d.getDay()], entries: [] });
  }

  for (const plan of plans) {
    const planStart = plan.startDate ? startOfDay(plan.startDate) : null;
    const planEnd = plan.endDate ? startOfDay(plan.endDate) : null;

    for (const [key, bucket] of byDate) {
      const date = new Date(key);
      if (planStart && date < planStart) continue;
      if (planEnd && date > planEnd) continue;

      const dayPlan = plan.days.find((d) => d.dayOfWeek === bucket.dayOfWeek);
      if (!dayPlan) continue;

      const mealsForUs = (dayPlan.meals || []).filter(
        (m) => m.restaurant && String(m.restaurant) === String(restaurantId)
      );
      if (mealsForUs.length === 0) continue;

      bucket.entries.push({
        mealPlanId: plan._id,
        mealPlanTitle: plan.title,
        client: plan.user ? { _id: plan.user._id, fullName: plan.user.fullName, phone: plan.user.phone } : null,
        deliveryAddress: plan.user?.deliveryAddress || null,
        meals: mealsForUs.map((m) => ({
          mealType: m.mealType,
          name: m.meal?.name || m.customName || 'Meal',
          image: m.meal?.image || null,
          calories: m.calories ?? m.meal?.calories ?? 0,
          deliveryTime: m.deliveryTime || null,
          specialRequirements: m.specialRequirements || null,
          ingredients: m.meal?.ingredients || [],
        })),
      });
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
};

// @desc    Get restaurant dashboard summary
// @route   GET /api/restaurants/dashboard
// @access  Private (Restaurant)
export const getDashboardSummary = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findOne({ user: req.user.id });
  if (!restaurant) throw new ApiError(404, 'Restaurant profile not found');

  const startOfToday = startOfDay(new Date());

  // "Scheduled for tomorrow" now reads live off confirmed meal plans, so it
  // updates the instant a nutritionist assigns a plan — not just after the
  // nightly scheduler creates the actual Order records.
  const [todayBucket, tomorrowBucket] = await computeDeliverySchedule(restaurant._id, {
    from: startOfToday,
    windowDays: 2,
  });
  const tomorrowMealCount = tomorrowBucket.entries.reduce((sum, e) => sum + e.meals.length, 0);

  const [incomingTodayCount, menuCount, activeMenuCount, pendingOrders, deliveredToday] =
    await Promise.all([
      Order.countDocuments({ restaurant: restaurant._id, createdAt: { $gte: startOfToday } }),
      Meal.countDocuments({ restaurant: restaurant._id }),
      Meal.countDocuments({ restaurant: restaurant._id, isAvailable: true }),
      Order.countDocuments({
        restaurant: restaurant._id,
        status: { $in: ['placed', 'confirmed', 'preparing'] },
      }),
      Order.countDocuments({
        restaurant: restaurant._id,
        status: 'delivered',
        updatedAt: { $gte: startOfToday },
      }),
    ]);

  // Revenue booked today, straight from the orders collection
  const revenueAgg = await Order.aggregate([
    {
      $match: {
        restaurant: restaurant._id,
        createdAt: { $gte: startOfToday },
        status: { $ne: 'cancelled' },
      },
    },
    { $group: { _id: null, total: { $sum: '$totalAmount' } } },
  ]);

  res.status(200).json({
    success: true,
    data: {
      restaurant: {
        _id: restaurant._id,
        restaurantName: restaurant.restaurantName,
        location: restaurant.location,
        status: restaurant.status,
        isPartner: restaurant.isPartner,
      },
      scheduledForTomorrow: tomorrowMealCount,
      incomingOrdersToday: incomingTodayCount,
      menuCount,
      activeMenuCount,
      pendingOrders,
      deliveredToday,
      revenueToday: revenueAgg.length ? revenueAgg[0].total : 0,
    }
  });
});

// @desc    Live delivery calendar — which meals go out on which date, for
//          every client whose confirmed plan uses this kitchen
// @route   GET /api/restaurants/delivery-schedule?days=14
// @access  Private (Restaurant)
export const getDeliverySchedule = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findOne({ user: req.user.id });
  if (!restaurant) throw new ApiError(404, 'Restaurant profile not found');

  const windowDays = Math.min(Math.max(Number(req.query.days) || 14, 1), 30);
  const today = startOfDay(new Date());

  const schedule = await computeDeliverySchedule(restaurant._id, { from: today, windowDays });

  const todayKey = dateKey(today);
  const tomorrowKey = dateKey(new Date(today.getTime() + 24 * 60 * 60 * 1000));

  const data = schedule.map((day) => ({
    ...day,
    isToday: day.date === todayKey,
    isTomorrow: day.date === tomorrowKey,
    mealCount: day.entries.reduce((sum, e) => sum + e.meals.length, 0),
  }));

  res.status(200).json({ success: true, data });
});

// @desc    Get scheduled orders for tomorrow (actual dispatched Order records)
// @route   GET /api/restaurants/scheduled-orders
// @access  Private (Restaurant)
export const getScheduledOrdersForTomorrow = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findOne({ user: req.user.id });
  if (!restaurant) throw new ApiError(404, 'Restaurant profile not found');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const nextDay = new Date(tomorrow);
  nextDay.setDate(nextDay.getDate() + 1);

  const orders = await Order.find({
    restaurant: restaurant._id,
    isScheduled: true,
    scheduledDate: { $gte: tomorrow, $lt: nextDay }
  })
    .populate('user', 'fullName')
    .populate('items.meal', 'name calories');

  res.status(200).json({ success: true, count: orders.length, data: orders });
});


// @desc    All orders for the logged-in restaurant
// @route   GET /api/restaurants/orders
// @access  Private (Restaurant)
export const getRestaurantOrders = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findOne({ user: req.user.id });
  if (!restaurant) throw new ApiError(404, 'Restaurant profile not found');

  const query = { restaurant: restaurant._id };
  if (req.query.status) query.status = req.query.status;

  const orders = await Order.find(query)
    .populate('user', 'fullName phone')
    .populate('items.meal', 'name calories')
    .sort({ createdAt: -1 })
    .limit(100);

  res.status(200).json({ success: true, count: orders.length, data: orders });
});

// @desc    Ingredients needed for tomorrow, derived live from confirmed
//          meal plans (doesn't wait on the nightly scheduler)
// @route   GET /api/restaurants/ingredients-forecast
// @access  Private (Restaurant)
export const getIngredientsForecast = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findOne({ user: req.user.id });
  if (!restaurant) throw new ApiError(404, 'Restaurant profile not found');

  const today = startOfDay(new Date());
  const [, tomorrowBucket] = await computeDeliverySchedule(restaurant._id, { from: today, windowDays: 2 });

  const tally = new Map();
  for (const entry of tomorrowBucket.entries) {
    for (const meal of entry.meals) {
      for (const ingredient of meal.ingredients || []) {
        tally.set(ingredient, (tally.get(ingredient) || 0) + 1);
      }
    }
  }

  const data = Array.from(tally.entries())
    .map(([ingredientName, portionsRequired]) => ({ ingredientName, portionsRequired }))
    .sort((a, b) => b.portionsRequired - a.portionsRequired);

  res.status(200).json({ success: true, count: data.length, data });
});