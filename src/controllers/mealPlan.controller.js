import MealPlan from '../models/MealPlan.js';
import User from '../models/User.js';
import Nutritionist from '../models/Nutritionist.js';
import Restaurant from '../models/Restaurant.js';
import Meal from '../models/Meal.js';
import Notification from '../models/Notification.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Turns the builder's day/meal payload into the plan's stored shape.
 * Nutrition facts and the delivering restaurant are pulled from the live
 * catalog whenever a catalog meal was picked, so the nutritionist never has
 * to type numbers by hand — a custom (non-catalog) meal keeps whatever the
 * nutritionist entered.
 */
const buildDays = async (days = []) => {
  if (!Array.isArray(days) || days.length === 0) return [];

  const mealIds = [
    ...new Set(
      days.flatMap((d) => (d.meals || []).map((m) => m.meal).filter(Boolean).map(String))
    ),
  ];

  const catalogMeals = mealIds.length
    ? await Meal.find({ _id: { $in: mealIds } }).select('calories protein carbs fat restaurant')
    : [];
  const catalogMap = new Map(catalogMeals.map((m) => [String(m._id), m]));

  return days
    .filter((day) => day.dayOfWeek && DAY_NAMES.includes(day.dayOfWeek) && (day.meals || []).length > 0)
    .map((day) => {
      const meals = (day.meals || [])
        .filter((m) => m.mealType && (m.meal || m.customName))
        .map((m) => {
          const catalog = m.meal ? catalogMap.get(String(m.meal)) : null;
          return {
            mealType: m.mealType,
            meal: m.meal || undefined,
            customName: m.meal ? undefined : m.customName,
            calories: m.calories ?? catalog?.calories ?? 0,
            protein: m.protein ?? catalog?.protein ?? 0,
            carbs: m.carbs ?? catalog?.carbs ?? 0,
            fat: m.fat ?? catalog?.fat ?? 0,
            restaurant: m.restaurant || catalog?.restaurant || undefined,
            specialRequirements: m.specialRequirements || undefined,
            deliveryTime: m.deliveryTime || undefined,
          };
        });

      return {
        dayOfWeek: day.dayOfWeek,
        meals,
        totalCalories: meals.reduce((sum, m) => sum + (m.calories || 0), 0),
        totalProtein: meals.reduce((sum, m) => sum + (m.protein || 0), 0),
      };
    });
};

const getOwnedNutritionist = async (req) => {
  const nutritionist = await Nutritionist.findOne({ user: req.user.id });
  if (!nutritionist) throw new ApiError(404, 'Nutritionist profile not found');
  return nutritionist;
};

const assertClientIsMine = async (nutritionist, userId) => {
  const client = await User.findById(userId);
  if (!client || String(client.assignedNutritionist) !== String(nutritionist._id)) {
    throw new ApiError(403, 'You are not assigned to this client');
  }
  return client;
};

// @desc    Create a new meal plan for a client
// @route   POST /api/meal-plans
// @access  Private (Nutritionist)
export const createMealPlan = asyncHandler(async (req, res) => {
  const { userId, title, startDate, endDate, days } = req.body;

  if (!userId || !title) {
    throw new ApiError(400, 'A client and a plan title are required.');
  }

  const nutritionist = await getOwnedNutritionist(req);
  await assertClientIsMine(nutritionist, userId);

  const mealPlan = await MealPlan.create({
    user: userId,
    nutritionist: nutritionist._id,
    title,
    startDate,
    endDate,
    days: await buildDays(days),
    status: 'draft',
  });

  const populated = await MealPlan.findById(mealPlan._id)
    .populate('user', 'fullName email')
    .populate({ path: 'days.meals.meal', select: 'name calories protein carbs fat image' })
    .populate({ path: 'days.meals.restaurant', select: 'restaurantName' });

  res.status(201).json({ success: true, data: populated });
});

// @desc    Edit a plan the nutritionist hasn't sent yet (or one the client rejected)
// @route   PUT /api/meal-plans/:id
// @access  Private (Nutritionist)
export const updateMealPlan = asyncHandler(async (req, res) => {
  const mealPlan = await MealPlan.findById(req.params.id);
  if (!mealPlan) throw new ApiError(404, 'Meal plan not found');

  const nutritionist = await getOwnedNutritionist(req);
  if (String(mealPlan.nutritionist) !== String(nutritionist._id)) {
    throw new ApiError(403, 'Not authorized to edit this plan');
  }
  if (!['draft', 'rejected'].includes(mealPlan.status)) {
    throw new ApiError(400, 'Only a draft or a rejected plan can be edited. Revise and resend instead.');
  }

  const { title, startDate, endDate, days } = req.body;
  if (title !== undefined) mealPlan.title = title;
  if (startDate !== undefined) mealPlan.startDate = startDate;
  if (endDate !== undefined) mealPlan.endDate = endDate;
  if (days !== undefined) mealPlan.days = await buildDays(days);

  // Editing a rejected plan puts it back in the draft pipeline until it's resent
  if (mealPlan.status === 'rejected') {
    mealPlan.status = 'draft';
    const lastFeedback = mealPlan.rejectionHistory[mealPlan.rejectionHistory.length - 1];
    if (lastFeedback && !lastFeedback.revisedAt) lastFeedback.revisedAt = new Date();
  }

  await mealPlan.save();

  const populated = await MealPlan.findById(mealPlan._id)
    .populate('user', 'fullName email')
    .populate({ path: 'days.meals.meal', select: 'name calories protein carbs fat image' })
    .populate({ path: 'days.meals.restaurant', select: 'restaurantName' });

  res.status(200).json({ success: true, data: populated });
});

// @desc    Remove a draft plan that was never sent
// @route   DELETE /api/meal-plans/:id
// @access  Private (Nutritionist)
export const deleteMealPlan = asyncHandler(async (req, res) => {
  const mealPlan = await MealPlan.findById(req.params.id);
  if (!mealPlan) throw new ApiError(404, 'Meal plan not found');

  const nutritionist = await getOwnedNutritionist(req);
  if (String(mealPlan.nutritionist) !== String(nutritionist._id)) {
    throw new ApiError(403, 'Not authorized to delete this plan');
  }
  if (mealPlan.status !== 'draft') {
    throw new ApiError(400, 'Only a draft that was never sent to the client can be deleted.');
  }

  await mealPlan.deleteOne();
  res.status(200).json({ success: true, message: 'Draft removed.', data: { _id: req.params.id } });
});

// @desc    Get meal plan by ID
// @route   GET /api/meal-plans/:id
// @access  Private (the client it belongs to, the nutritionist who owns it, or an admin)
export const getMealPlanById = asyncHandler(async (req, res) => {
  const mealPlan = await MealPlan.findById(req.params.id)
    .populate('user', 'fullName email avatar')
    .populate({ path: 'nutritionist', select: 'title image user', populate: { path: 'user', select: 'fullName' } })
    .populate({
      path: 'days.meals.meal',
      select: 'name calories protein carbs fat image',
    })
    .populate({
      path: 'days.meals.restaurant',
      select: 'restaurantName',
    });

  if (!mealPlan) throw new ApiError(404, 'Meal plan not found');

  if (req.user.role === 'user' && String(mealPlan.user._id) !== String(req.user.id)) {
    throw new ApiError(403, 'Not authorized to view this plan');
  }
  if (req.user.role === 'nutritionist') {
    const nutritionist = await Nutritionist.findOne({ user: req.user.id });
    if (!nutritionist || String(mealPlan.nutritionist._id) !== String(nutritionist._id)) {
      throw new ApiError(403, 'Not authorized to view this plan');
    }
  }

  res.status(200).json({ success: true, data: mealPlan });
});

// @desc    Submit plan to user for approval
// @route   PATCH /api/meal-plans/:id/submit
// @access  Private (Nutritionist)
export const submitMealPlan = asyncHandler(async (req, res) => {
  const mealPlan = await MealPlan.findById(req.params.id);
  if (!mealPlan) throw new ApiError(404, 'Meal plan not found');

  const nutritionist = await getOwnedNutritionist(req);
  if (String(mealPlan.nutritionist) !== String(nutritionist._id)) {
    throw new ApiError(403, 'Not authorized to submit this plan');
  }
  if (!['draft', 'rejected'].includes(mealPlan.status)) {
    throw new ApiError(400, 'Only a draft or revised plan can be sent to the client.');
  }
  if (mealPlan.days.length === 0) {
    throw new ApiError(400, 'Add at least one meal before sending this plan to the client.');
  }

  mealPlan.status = 'pending_approval';
  await mealPlan.save();

  // Notify User
  await Notification.create({
    recipient: mealPlan.user,
    title: 'New Meal Plan to Review',
    message: `Your nutritionist has submitted the "${mealPlan.title}" meal plan for your approval.`,
    type: 'info',
  });

  res.status(200).json({ success: true, data: mealPlan });
});

// @desc    User approves the meal plan
// @route   PATCH /api/meal-plans/:id/approve
// @access  Private (User)
export const approveMealPlan = asyncHandler(async (req, res) => {
  const mealPlan = await MealPlan.findById(req.params.id).populate('nutritionist');
  if (!mealPlan) throw new ApiError(404, 'Meal plan not found');

  // Verify ownership
  if (mealPlan.user.toString() !== req.user.id.toString()) {
    throw new ApiError(403, 'Not authorized');
  }

  mealPlan.status = 'approved';
  mealPlan.approvedAt = new Date();
  await mealPlan.save();

  // Notify Nutritionist
  await Notification.create({
    recipient: mealPlan.nutritionist.user,
    title: 'Meal Plan Approved',
    message: `${req.user.fullName} has approved the "${mealPlan.title}" meal plan.`,
    type: 'success',
  });

  res.status(200).json({ success: true, data: mealPlan });
});

// @desc    User rejects the meal plan with feedback
// @route   PATCH /api/meal-plans/:id/reject
// @access  Private (User)
export const rejectMealPlan = asyncHandler(async (req, res) => {
  const { feedback } = req.body;
  if (!feedback) throw new ApiError(400, 'Please provide feedback for the rejection');

  const mealPlan = await MealPlan.findById(req.params.id).populate('nutritionist');
  if (!mealPlan) throw new ApiError(404, 'Meal plan not found');

  if (mealPlan.user.toString() !== req.user.id.toString()) {
    throw new ApiError(403, 'Not authorized');
  }

  mealPlan.status = 'rejected';
  mealPlan.rejectionHistory.push({
    rejectedAt: new Date(),
    feedback
  });
  await mealPlan.save();

  // Notify Nutritionist
  await Notification.create({
    recipient: mealPlan.nutritionist.user,
    title: 'Meal Plan Modification Requested',
    message: `${req.user.fullName} has requested changes to "${mealPlan.title}". Feedback: ${feedback}`,
    type: 'warning',
  });

  res.status(200).json({ success: true, data: mealPlan });
});

// @desc    Nutritionist assigns the approved plan to its kitchens and activates it
// @route   PATCH /api/meal-plans/:id/confirm
// @access  Private (Nutritionist)
export const confirmMealPlan = asyncHandler(async (req, res) => {
  const mealPlan = await MealPlan.findById(req.params.id);
  if (!mealPlan) throw new ApiError(404, 'Meal plan not found');

  const nutritionist = await getOwnedNutritionist(req);
  if (String(mealPlan.nutritionist) !== String(nutritionist._id)) {
    throw new ApiError(403, 'Not authorized to confirm this plan');
  }

  if (mealPlan.status !== 'approved') {
    throw new ApiError(400, 'Meal plan must be approved by the user first');
  }

  mealPlan.status = 'confirmed';
  mealPlan.confirmedAt = new Date();
  await mealPlan.save();

  // Assign the plan to every distinct kitchen it draws meals from, and let
  // each one know a client is now on their books. From here the nightly
  // scheduler dispatches the actual daily orders automatically.
  const restaurantIds = [
    ...new Set(
      mealPlan.days.flatMap((d) => d.meals.map((m) => m.restaurant).filter(Boolean).map(String))
    ),
  ];
  const restaurants = restaurantIds.length
    ? await Restaurant.find({ _id: { $in: restaurantIds } }).select('user restaurantName')
    : [];

  await Promise.all([
    Notification.create({
      recipient: mealPlan.user,
      title: 'Meal Plan Confirmed & Verified',
      message: restaurants.length
        ? `Your meal plan "${mealPlan.title}" is confirmed and assigned to ${restaurants.length} partner kitchen(s). Meals will be delivered automatically each day.`
        : `Your meal plan "${mealPlan.title}" is fully confirmed.`,
      type: 'success',
    }),
    ...restaurants.map((r) =>
      Notification.create({
        recipient: r.user,
        title: 'Assigned to a Confirmed Meal Plan',
        message: `Your kitchen has been assigned to the confirmed meal plan "${mealPlan.title}". Expect scheduled orders starting tomorrow — check Tomorrow's Prep on your dashboard.`,
        type: 'info',
      })
    ),
  ]);

  res.status(200).json({
    success: true,
    data: mealPlan,
    assignedRestaurants: restaurants.map((r) => ({ _id: r._id, restaurantName: r.restaurantName })),
  });
});

// @desc    Get the user's current meal plan — whatever needs their attention
//          or is currently active, most recent first. Includes plans waiting
//          on their approval, not just ones already confirmed.
// @route   GET /api/meal-plans/my
// @access  Private (User)
export const getMyMealPlan = asyncHandler(async (req, res) => {
  const mealPlan = await MealPlan.findOne({
    user: req.user.id,
    status: { $in: ['pending_approval', 'approved', 'confirmed', 'active'] }
  })
    .sort({ updatedAt: -1 })
    .populate('nutritionist', 'title image')
    .populate({
      path: 'days.meals.meal',
      select: 'name calories protein carbs fat image',
    })
    .populate({
      path: 'days.meals.restaurant',
      select: 'restaurantName',
    });

  res.status(200).json({ success: true, data: mealPlan });
});
