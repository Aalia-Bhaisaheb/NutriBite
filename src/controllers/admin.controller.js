import mongoose from 'mongoose';
import User from '../models/User.js';
import Nutritionist from '../models/Nutritionist.js';
import Restaurant from '../models/Restaurant.js';
import Organization from '../models/Organization.js';
import Meal from '../models/Meal.js';
import Order from '../models/Order.js';
import Subscription from '../models/Subscription.js';
import MealPlan from '../models/MealPlan.js';
import Notification from '../models/Notification.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const assertNewEmail = async (email) => {
  const exists = await User.findOne({ email: normalizeEmail(email) });
  if (exists) {
    throw new ApiError(400, `An account with the email ${email} already exists.`);
  }
};

const requireFields = (body, fields) => {
  const missing = fields.filter((f) => !body[f] || String(body[f]).trim() === '');
  if (missing.length) {
    throw new ApiError(400, `Missing required field(s): ${missing.join(', ')}.`);
  }
};

const validatePassword = (password) => {
  if (!password || String(password).length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters long.');
  }
};

/**
 * Creates the login account for a partner (nutritionist / restaurant / org).
 * The password is passed in plain — User.pre('save') hashes it.
 */
const createPartnerAccount = async ({ fullName, email, password, role, phone, avatar }) => {
  await assertNewEmail(email);
  validatePassword(password);

  return User.create({
    fullName: String(fullName).trim(),
    email: normalizeEmail(email),
    password,
    role,
    phone,
    avatar,
  });
};

/**
 * Updates the login account attached to a partner profile.
 * Only touches what was actually sent.
 */
const updatePartnerAccount = async (userId, { fullName, email, password, phone, avatar }) => {
  const account = await User.findById(userId);
  if (!account) throw new ApiError(404, 'Linked login account not found.');

  if (email && normalizeEmail(email) !== account.email) {
    await assertNewEmail(email);
    account.email = normalizeEmail(email);
  }
  if (fullName) account.fullName = String(fullName).trim();
  if (phone !== undefined) account.phone = phone;
  if (avatar !== undefined) account.avatar = avatar;
  if (password) {
    validatePassword(password);
    account.password = password; // re-hashed by the pre-save hook
  }

  await account.save();
  return account;
};

/* ------------------------------------------------------------------ */
/* Platform statistics (all live)                                      */
/* ------------------------------------------------------------------ */

// @desc    Get admin platform stats
// @route   GET /api/admin/stats
// @access  Private (Admin)
export const getPlatformStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    premiumUsers,
    newUsersThisMonth,
    activeNutritionists,
    partnerRestaurants,
    totalOrganizations,
    totalMeals,
    ordersLast30Days,
    activeMealPlans,
  ] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'user', subscriptionTier: 'premium' }),
    User.countDocuments({ role: 'user', createdAt: { $gte: startOfMonth } }),
    Nutritionist.countDocuments(),
    Restaurant.countDocuments({ isPartner: true }),
    Organization.countDocuments(),
    Meal.countDocuments(),
    Order.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    MealPlan.countDocuments({ status: { $in: ['confirmed', 'active', 'approved'] } }),
  ]);

  // Monthly recurring revenue = sum of the price of every currently active subscription
  const revenueAgg = await Subscription.aggregate([
    { $match: { isActive: true, endDate: { $gte: now } } },
    { $group: { _id: null, total: { $sum: { $ifNull: ['$priceMonthly', 0] } } } },
  ]);
  const monthlyRecurringRevenue = revenueAgg.length ? revenueAgg[0].total : 0;

  // Revenue actually booked this month
  const bookedAgg = await Subscription.aggregate([
    { $match: { createdAt: { $gte: startOfMonth } } },
    { $group: { _id: null, total: { $sum: { $ifNull: ['$priceMonthly', 0] } } } },
  ]);
  const revenueThisMonth = bookedAgg.length ? bookedAgg[0].total : 0;

  // Newest partners across restaurants + organizations, merged and sorted
  const [recentRestaurants, recentOrganizations] = await Promise.all([
    Restaurant.find().sort({ createdAt: -1 }).limit(5).lean(),
    Organization.find().sort({ createdAt: -1 }).limit(5).lean(),
  ]);

  const recentPartners = [
    ...recentRestaurants.map((r) => ({
      id: r._id,
      name: r.restaurantName,
      type: 'Restaurant',
      location: r.location || '—',
      status: r.status,
      createdAt: r.createdAt,
    })),
    ...recentOrganizations.map((o) => ({
      id: o._id,
      name: o.orgName,
      type: o.type ? `${o.type.charAt(0).toUpperCase()}${o.type.slice(1)} / Org` : 'Organization',
      location: o.location || '—',
      status: o.status,
      createdAt: o.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  res.status(200).json({
    success: true,
    data: {
      totalUsers,
      premiumUsers,
      freeUsers: totalUsers - premiumUsers,
      newUsersThisMonth,
      activeNutritionists,
      partnerRestaurants,
      totalOrganizations,
      totalMeals,
      ordersLast30Days,
      activeMealPlans,
      monthlyRecurringRevenue,
      revenueThisMonth,
      recentPartners,
    },
  });
});

/* ------------------------------------------------------------------ */
/* Members & their subscription plans                                  */
/* ------------------------------------------------------------------ */

// @desc    List platform members with their live plan status
// @route   GET /api/admin/users?plan=premium|free&search=&role=
// @access  Private (Admin)
export const getUsers = asyncHandler(async (req, res) => {
  const { plan, search, role = 'user' } = req.query;

  const query = {};
  if (role && role !== 'all') query.role = role;
  if (plan === 'premium' || plan === 'free') query.subscriptionTier = plan;
  if (search && search.trim()) {
    const rx = new RegExp(search.trim(), 'i');
    query.$or = [{ fullName: rx }, { email: rx }];
  }

  const users = await User.find(query)
    .populate({
      path: 'assignedNutritionist',
      select: 'title specialization',
      populate: { path: 'user', select: 'fullName email' },
    })
    .sort({ createdAt: -1 })
    .lean();

  const userIds = users.map((u) => u._id);

  // Pull the latest subscription per user in one query instead of N queries
  const subscriptions = await Subscription.find({ user: { $in: userIds } })
    .sort({ createdAt: -1 })
    .lean();

  const latestSubByUser = new Map();
  for (const sub of subscriptions) {
    const key = String(sub.user);
    if (!latestSubByUser.has(key)) latestSubByUser.set(key, sub);
  }

  const now = new Date();

  const data = users.map((u) => {
    const sub = latestSubByUser.get(String(u._id)) || null;
    const isActive = Boolean(sub && sub.isActive && new Date(sub.endDate) > now);
    const daysRemaining = isActive
      ? Math.max(0, Math.ceil((new Date(sub.endDate) - now) / (1000 * 60 * 60 * 24)))
      : 0;

    return {
      _id: u._id,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone || null,
      role: u.role,
      avatar: u.avatar || null,
      joinedAt: u.createdAt,
      subscriptionTier: u.subscriptionTier,
      healthProfile: u.healthProfile || null,
      assignedNutritionist: u.assignedNutritionist
        ? {
            _id: u.assignedNutritionist._id,
            title: u.assignedNutritionist.title,
            specialization: u.assignedNutritionist.specialization,
            name: u.assignedNutritionist.user?.fullName || null,
          }
        : null,
      subscription: sub
        ? {
            plan: sub.plan,
            isActive,
            status: isActive ? 'active' : 'expired',
            startDate: sub.startDate,
            endDate: sub.endDate,
            priceMonthly: sub.priceMonthly ?? 0,
            daysRemaining,
          }
        : {
            plan: 'free',
            isActive: false,
            status: 'no_subscription',
            startDate: null,
            endDate: null,
            priceMonthly: 0,
            daysRemaining: 0,
          },
    };
  });

  const summary = {
    total: data.length,
    withActivePlan: data.filter((u) => u.subscription.isActive).length,
    withoutPlan: data.filter((u) => !u.subscription.isActive).length,
  };

  res.status(200).json({ success: true, count: data.length, summary, data });
});

// @desc    Delete a member account
// @route   DELETE /api/admin/users/:id
// @access  Private (Admin)
export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found.');
  if (user.role === 'admin') throw new ApiError(400, 'Administrator accounts cannot be deleted here.');

  // Release the nutritionist seat this member occupied
  if (user.assignedNutritionist) {
    await Nutritionist.findByIdAndUpdate(user.assignedNutritionist, { $inc: { clientsCount: -1 } });
  }

  await Promise.all([
    Subscription.deleteMany({ user: user._id }),
    Notification.deleteMany({ recipient: user._id }),
  ]);
  await user.deleteOne();

  res.status(200).json({ success: true, message: 'User removed.', data: { _id: req.params.id } });
});

/* ------------------------------------------------------------------ */
/* Nutritionist management                                             */
/* ------------------------------------------------------------------ */

// @desc    List nutritionists with their login account + live client count
// @route   GET /api/admin/nutritionists
// @access  Private (Admin)
export const getNutritionists = asyncHandler(async (req, res) => {
  const nutritionists = await Nutritionist.find()
    .populate('user', 'fullName email phone avatar createdAt')
    .sort({ createdAt: -1 })
    .lean();

  const counts = await User.aggregate([
    { $match: { assignedNutritionist: { $ne: null } } },
    { $group: { _id: '$assignedNutritionist', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

  const data = nutritionists.map((n) => ({
    ...n,
    activeClients: countMap.get(String(n._id)) || 0,
  }));

  res.status(200).json({ success: true, count: data.length, data });
});

// @desc    Create a nutritionist (login account + professional profile)
// @route   POST /api/admin/nutritionists
// @access  Private (Admin)
export const createNutritionist = asyncHandler(async (req, res) => {
  const {
    fullName, email, password, phone, avatar,
    title, specialization, experienceYears, bio, image, availability, maxClients,
  } = req.body;

  requireFields(req.body, ['fullName', 'email', 'password', 'title']);

  const account = await createPartnerAccount({
    fullName, email, password, role: 'nutritionist', phone,
    avatar: avatar || image,
  });

  try {
    const profile = await Nutritionist.create({
      user: account._id,
      title,
      specialization,
      experienceYears: experienceYears ? Number(experienceYears) : undefined,
      bio,
      image: image || avatar,
      availability,
      maxClients: maxClients ? Number(maxClients) : undefined,
      clientsCount: 0,
    });

    await Notification.create({
      recipient: account._id,
      title: 'Welcome to NutriBite',
      message: 'Your clinical nutritionist account has been created by the platform administrator.',
      type: 'success',
    });

    const populated = await Nutritionist.findById(profile._id)
      .populate('user', 'fullName email phone avatar createdAt');

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    // Don't leave an orphan login account behind
    await User.findByIdAndDelete(account._id);
    throw error;
  }
});

// @desc    Update a nutritionist (profile and/or credentials)
// @route   PUT /api/admin/nutritionists/:id
// @access  Private (Admin)
export const updateNutritionist = asyncHandler(async (req, res) => {
  const profile = await Nutritionist.findById(req.params.id);
  if (!profile) throw new ApiError(404, 'Nutritionist not found.');

  const {
    fullName, email, password, phone, avatar,
    title, specialization, experienceYears, bio, image, availability, maxClients,
  } = req.body;

  if (fullName || email || password || phone !== undefined || avatar !== undefined) {
    await updatePartnerAccount(profile.user, { fullName, email, password, phone, avatar });
  }

  if (title !== undefined) profile.title = title;
  if (specialization !== undefined) profile.specialization = specialization;
  if (experienceYears !== undefined) profile.experienceYears = Number(experienceYears);
  if (bio !== undefined) profile.bio = bio;
  if (image !== undefined) profile.image = image;
  if (availability !== undefined) profile.availability = availability;
  if (maxClients !== undefined) profile.maxClients = Number(maxClients);

  await profile.save();

  const populated = await Nutritionist.findById(profile._id)
    .populate('user', 'fullName email phone avatar createdAt');

  res.status(200).json({ success: true, data: populated });
});

// @desc    Delete a nutritionist and their login account
// @route   DELETE /api/admin/nutritionists/:id
// @access  Private (Admin)
export const deleteNutritionist = asyncHandler(async (req, res) => {
  const profile = await Nutritionist.findById(req.params.id);
  if (!profile) throw new ApiError(404, 'Nutritionist not found.');

  const assignedCount = await User.countDocuments({ assignedNutritionist: profile._id });
  if (assignedCount > 0 && req.query.force !== 'true') {
    throw new ApiError(
      400,
      `This nutritionist still has ${assignedCount} assigned client(s). Reassign them first, or repeat the request with ?force=true to unassign them automatically.`
    );
  }

  if (assignedCount > 0) {
    await User.updateMany({ assignedNutritionist: profile._id }, { assignedNutritionist: null });
  }

  await User.findByIdAndDelete(profile.user);
  await profile.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Nutritionist removed.',
    data: { _id: req.params.id, unassignedClients: assignedCount },
  });
});

/* ------------------------------------------------------------------ */
/* Restaurant management                                               */
/* ------------------------------------------------------------------ */

// @desc    List restaurants with their login account + live meal count
// @route   GET /api/admin/restaurants
// @access  Private (Admin)
export const getRestaurants = asyncHandler(async (req, res) => {
  const restaurants = await Restaurant.find()
    .populate('user', 'fullName email phone createdAt')
    .sort({ createdAt: -1 })
    .lean();

  const mealCounts = await Meal.aggregate([
    { $group: { _id: '$restaurant', count: { $sum: 1 } } },
  ]);
  const mealMap = new Map(mealCounts.map((m) => [String(m._id), m.count]));

  const orderCounts = await Order.aggregate([
    { $group: { _id: '$restaurant', count: { $sum: 1 } } },
  ]);
  const orderMap = new Map(orderCounts.map((o) => [String(o._id), o.count]));

  const data = restaurants.map((r) => ({
    ...r,
    mealsCount: mealMap.get(String(r._id)) || 0,
    ordersCount: orderMap.get(String(r._id)) || 0,
  }));

  res.status(200).json({ success: true, count: data.length, data });
});

// @desc    Create a restaurant (login account + partner profile)
// @route   POST /api/admin/restaurants
// @access  Private (Admin)
export const createRestaurant = asyncHandler(async (req, res) => {
  const {
    fullName, email, password, phone,
    restaurantName, location, description, image, isPartner, status,
  } = req.body;

  requireFields(req.body, ['email', 'password', 'restaurantName', 'location']);

  const account = await createPartnerAccount({
    fullName: fullName || `${restaurantName} Manager`,
    email,
    password,
    role: 'restaurant',
    phone,
  });

  try {
    const profile = await Restaurant.create({
      user: account._id,
      restaurantName,
      location,
      description,
      image,
      isPartner: isPartner === undefined ? true : Boolean(isPartner),
      status: status || 'active',
    });

    await Notification.create({
      recipient: account._id,
      title: 'Welcome to NutriBite',
      message: 'Your partner kitchen account has been created by the platform administrator.',
      type: 'success',
    });

    const populated = await Restaurant.findById(profile._id)
      .populate('user', 'fullName email phone createdAt');

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    await User.findByIdAndDelete(account._id);
    throw error;
  }
});

// @desc    Update a restaurant (profile and/or credentials)
// @route   PUT /api/admin/restaurants/:id
// @access  Private (Admin)
export const updateRestaurant = asyncHandler(async (req, res) => {
  const profile = await Restaurant.findById(req.params.id);
  if (!profile) throw new ApiError(404, 'Restaurant not found.');

  const {
    fullName, email, password, phone,
    restaurantName, location, description, image, isPartner, status,
  } = req.body;

  if (fullName || email || password || phone !== undefined) {
    await updatePartnerAccount(profile.user, { fullName, email, password, phone });
  }

  if (restaurantName !== undefined) profile.restaurantName = restaurantName;
  if (location !== undefined) profile.location = location;
  if (description !== undefined) profile.description = description;
  if (image !== undefined) profile.image = image;
  if (isPartner !== undefined) profile.isPartner = Boolean(isPartner);
  if (status !== undefined) profile.status = status;

  await profile.save();

  const populated = await Restaurant.findById(profile._id)
    .populate('user', 'fullName email phone createdAt');

  res.status(200).json({ success: true, data: populated });
});

// @desc    Delete a restaurant, its menu and its login account
// @route   DELETE /api/admin/restaurants/:id
// @access  Private (Admin)
export const deleteRestaurant = asyncHandler(async (req, res) => {
  const profile = await Restaurant.findById(req.params.id);
  if (!profile) throw new ApiError(404, 'Restaurant not found.');

  const mealsRemoved = await Meal.deleteMany({ restaurant: profile._id });
  await User.findByIdAndDelete(profile.user);
  await profile.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Restaurant removed.',
    data: { _id: req.params.id, mealsRemoved: mealsRemoved.deletedCount },
  });
});

/* ------------------------------------------------------------------ */
/* Organization management                                             */
/* ------------------------------------------------------------------ */

// @desc    List partner organizations
// @route   GET /api/admin/organizations
// @access  Private (Admin)
export const getOrganizations = asyncHandler(async (req, res) => {
  const organizations = await Organization.find()
    .populate('user', 'fullName email phone createdAt')
    .sort({ createdAt: -1 })
    .lean();

  const memberCounts = await User.aggregate([
    { $match: { organization: { $ne: null } } },
    { $group: { _id: '$organization', count: { $sum: 1 } } },
  ]);
  const memberMap = new Map(memberCounts.map((m) => [String(m._id), m.count]));

  const data = organizations.map((o) => ({
    ...o,
    membersCount: memberMap.get(String(o._id)) || 0,
  }));

  res.status(200).json({ success: true, count: data.length, data });
});

// @desc    Create an organization (login account + profile)
// @route   POST /api/admin/organizations
// @access  Private (Admin)
export const createOrganization = asyncHandler(async (req, res) => {
  const { fullName, email, password, phone, orgName, type, location, status } = req.body;

  requireFields(req.body, ['email', 'password', 'orgName', 'type']);

  const account = await createPartnerAccount({
    fullName: fullName || `${orgName} Coordinator`,
    email,
    password,
    role: 'organization',
    phone,
  });

  try {
    const profile = await Organization.create({
      user: account._id,
      orgName,
      type,
      location,
      status: status || 'active',
    });

    const populated = await Organization.findById(profile._id)
      .populate('user', 'fullName email phone createdAt');

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    await User.findByIdAndDelete(account._id);
    throw error;
  }
});

// @desc    Update an organization
// @route   PUT /api/admin/organizations/:id
// @access  Private (Admin)
export const updateOrganization = asyncHandler(async (req, res) => {
  const profile = await Organization.findById(req.params.id);
  if (!profile) throw new ApiError(404, 'Organization not found.');

  const { fullName, email, password, phone, orgName, type, location, status } = req.body;

  if (fullName || email || password || phone !== undefined) {
    await updatePartnerAccount(profile.user, { fullName, email, password, phone });
  }

  if (orgName !== undefined) profile.orgName = orgName;
  if (type !== undefined) profile.type = type;
  if (location !== undefined) profile.location = location;
  if (status !== undefined) profile.status = status;

  await profile.save();

  const populated = await Organization.findById(profile._id)
    .populate('user', 'fullName email phone createdAt');

  res.status(200).json({ success: true, data: populated });
});

// @desc    Delete an organization and its login account
// @route   DELETE /api/admin/organizations/:id
// @access  Private (Admin)
export const deleteOrganization = asyncHandler(async (req, res) => {
  const profile = await Organization.findById(req.params.id);
  if (!profile) throw new ApiError(404, 'Organization not found.');

  await User.updateMany({ organization: profile._id }, { organization: null });
  await User.findByIdAndDelete(profile.user);
  await profile.deleteOne();

  res.status(200).json({ success: true, message: 'Organization removed.', data: { _id: req.params.id } });
});

/* ------------------------------------------------------------------ */
/* Catalog oversight                                                   */
/* ------------------------------------------------------------------ */

// @desc    List every meal on the platform
// @route   GET /api/admin/meals
// @access  Private (Admin)
export const getAllMeals = asyncHandler(async (req, res) => {
  const meals = await Meal.find()
    .populate('restaurant', 'restaurantName location')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ success: true, count: meals.length, data: meals });
});

// @desc    Delete any meal
// @route   DELETE /api/admin/meals/:id
// @access  Private (Admin)
export const deleteMeal = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(400, 'Invalid meal id.');

  const meal = await Meal.findById(req.params.id);
  if (!meal) throw new ApiError(404, 'Meal not found.');

  await meal.deleteOne();
  res.status(200).json({ success: true, message: 'Meal removed.', data: { _id: req.params.id } });
});
