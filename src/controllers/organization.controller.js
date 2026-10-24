import Organization from '../models/Organization.js';
import User from '../models/User.js';
import MealPlan from '../models/MealPlan.js';
import Meeting from '../models/Meeting.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';

const getMyOrg = async (req) => {
  const org = await Organization.findOne({ user: req.user.id });
  if (!org) throw new ApiError(404, 'Organization profile not found');
  return org;
};

// @desc    Get members in organization
// @route   GET /api/organizations/members
// @access  Private (Organization)
export const getOrganizationMembers = asyncHandler(async (req, res) => {
  const org = await getMyOrg(req);

  const members = await User.find({ role: 'user', organization: org._id })
    .populate({
      path: 'assignedNutritionist',
      select: 'title specialization',
      populate: { path: 'user', select: 'fullName' },
    })
    .sort({ createdAt: -1 })
    .lean();

  const memberIds = members.map((m) => m._id);

  // Which of these members currently have a live plan
  const activePlans = await MealPlan.find({
    user: { $in: memberIds },
    status: { $in: ['confirmed', 'active', 'approved'] },
  })
    .select('user status title')
    .lean();

  const planByUser = new Map(activePlans.map((p) => [String(p.user), p]));

  const data = members.map((m) => ({
    _id: m._id,
    fullName: m.fullName,
    email: m.email,
    joinedAt: m.createdAt,
    subscriptionTier: m.subscriptionTier,
    primaryGoal: m.healthProfile?.primaryGoal || null,
    assignedNutritionist: m.assignedNutritionist
      ? m.assignedNutritionist.user?.fullName || m.assignedNutritionist.title
      : null,
    activePlan: planByUser.get(String(m._id))?.title || null,
    status: planByUser.has(String(m._id)) ? 'On active plan' : 'No active plan',
  }));

  res.status(200).json({ success: true, count: data.length, data });
});

// @desc    Live dashboard stats for the organization
// @route   GET /api/organizations/stats
// @access  Private (Organization)
export const getOrganizationStats = asyncHandler(async (req, res) => {
  const org = await getMyOrg(req);

  const memberIds = await User.find({ role: 'user', organization: org._id })
    .select('_id')
    .lean();
  const ids = memberIds.map((m) => m._id);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(startOfToday.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [premiumMembers, activeDietPlans, recentCheckIns] = await Promise.all([
    User.countDocuments({ _id: { $in: ids }, subscriptionTier: 'premium' }),
    MealPlan.countDocuments({
      user: { $in: ids },
      status: { $in: ['confirmed', 'active', 'approved'] },
    }),
    Meeting.countDocuments({
      user: { $in: ids },
      scheduledAt: { $gte: thirtyDaysAgo },
    }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      orgName: org.orgName,
      type: org.type,
      location: org.location,
      status: org.status,
      totalMembers: ids.length,
      premiumMembers,
      activeDietPlans,
      recentCheckIns,
    },
  });
});
