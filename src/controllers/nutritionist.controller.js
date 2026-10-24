import Nutritionist from '../models/Nutritionist.js';
import Meeting from '../models/Meeting.js';
import User from '../models/User.js';
import MealPlan from '../models/MealPlan.js';
import Notification from '../models/Notification.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';

// @desc    Get all nutritionists
// @route   GET /api/nutritionists
// @access  Public
export const getNutritionists = asyncHandler(async (req, res) => {
  const nutritionists = await Nutritionist.find().populate('user', 'fullName avatar');
  res.status(200).json({ success: true, count: nutritionists.length, data: nutritionists });
});

// @desc    Get clients assigned to me
// @route   GET /api/nutritionists/my-clients
// @access  Private (Nutritionist)
export const getMyClients = asyncHandler(async (req, res) => {
  const nutritionist = await Nutritionist.findOne({ user: req.user.id });
  if (!nutritionist) {
    throw new ApiError(404, 'Nutritionist profile not found');
  }

  const clients = await User.find({ assignedNutritionist: nutritionist._id });
  res.status(200).json({ success: true, count: clients.length, data: clients });
});

// --- MEETINGS ---

// @desc    Schedule a consultation. A nutritionist books it with one of their
//          own clients (passing clientId); a member books it with their own
//          assigned nutritionist. Either way the other side is notified.
// @route   POST /api/nutritionists/meetings
// @access  Private (Nutritionist, User)
export const scheduleMeeting = asyncHandler(async (req, res) => {
  const { scheduledAt, meetingLink, clientId } = req.body;

  if (!scheduledAt) {
    throw new ApiError(400, 'scheduledAt is required.');
  }
  if (new Date(scheduledAt).toString() === 'Invalid Date') {
    throw new ApiError(400, 'scheduledAt must be a valid date/time.');
  }

  let nutritionistDoc;
  let clientUserId;

  if (req.user.role === 'nutritionist') {
    nutritionistDoc = await Nutritionist.findOne({ user: req.user.id });
    if (!nutritionistDoc) throw new ApiError(404, 'Nutritionist profile not found');

    if (!clientId) throw new ApiError(400, 'clientId is required.');
    const client = await User.findById(clientId);
    if (!client || String(client.assignedNutritionist) !== String(nutritionistDoc._id)) {
      throw new ApiError(403, 'You can only schedule consultations with your own assigned clients.');
    }
    clientUserId = client._id;
  } else if (req.user.role === 'user') {
    const client = await User.findById(req.user.id);
    if (!client.assignedNutritionist) {
      throw new ApiError(400, 'You do not have an assigned nutritionist yet.');
    }
    nutritionistDoc = await Nutritionist.findById(client.assignedNutritionist);
    if (!nutritionistDoc) throw new ApiError(404, 'Your assigned nutritionist could not be found.');
    clientUserId = client._id;
  } else {
    throw new ApiError(403, 'Only members and nutritionists can schedule consultations.');
  }

  const meeting = await Meeting.create({
    user: clientUserId,
    nutritionist: nutritionistDoc._id,
    scheduledAt,
    meetingLink: meetingLink || null, // No fabricated link — added when it's confirmed
  });

  // Notify whichever side didn't do the booking
  if (req.user.role === 'nutritionist') {
    await Notification.create({
      recipient: clientUserId,
      title: 'Consultation Scheduled',
      message: `Your nutritionist has scheduled a consultation for ${new Date(scheduledAt).toLocaleString()}.`,
      type: 'info',
    });
  } else {
    await Notification.create({
      recipient: nutritionistDoc.user,
      title: 'New Consultation Booked',
      message: `${req.user.fullName} booked a consultation for ${new Date(scheduledAt).toLocaleString()}.`,
      type: 'info',
    });
  }

  const populated = await Meeting.findById(meeting._id)
    .populate('user', 'fullName avatar')
    .populate({ path: 'nutritionist', select: 'title', populate: { path: 'user', select: 'fullName avatar' } });

  res.status(201).json({ success: true, data: populated });
});

// @desc    Get my meetings
// @route   GET /api/meetings/my
// @access  Private
export const getMyMeetings = asyncHandler(async (req, res) => {
  let meetings;

  if (req.user.role === 'nutritionist') {
    const nutritionist = await Nutritionist.findOne({ user: req.user.id });
    meetings = await Meeting.find({ nutritionist: nutritionist._id })
      .populate('user', 'fullName avatar')
      .sort({ scheduledAt: 1 });
  } else {
    meetings = await Meeting.find({ user: req.user.id })
      .populate({
        path: 'nutritionist',
        populate: { path: 'user', select: 'fullName avatar' }
      })
      .sort({ scheduledAt: 1 });
  }

  res.status(200).json({ success: true, count: meetings.length, data: meetings });
});

// @desc    Complete meeting and add notes
// @route   PATCH /api/meetings/:id/complete
// @access  Private (Nutritionist)
export const completeMeeting = asyncHandler(async (req, res) => {
  const { notes } = req.body;
  const meeting = await Meeting.findById(req.params.id);

  if (!meeting) {
    throw new ApiError(404, 'Meeting not found');
  }

  meeting.status = 'completed';
  if (notes) meeting.notes = notes;

  await meeting.save();
  res.status(200).json({ success: true, data: meeting });
});

// --- DASHBOARD ---

// @desc    Live dashboard stats for the logged-in nutritionist
// @route   GET /api/nutritionists/my-stats
// @access  Private (Nutritionist)
export const getMyStats = asyncHandler(async (req, res) => {
  const nutritionist = await Nutritionist.findOne({ user: req.user.id });
  if (!nutritionist) {
    throw new ApiError(404, 'Nutritionist profile not found');
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const [totalClients, activeMealPlans, pendingApprovals, todaysConsultations, premiumClients] =
    await Promise.all([
      User.countDocuments({ assignedNutritionist: nutritionist._id }),
      MealPlan.countDocuments({
        nutritionist: nutritionist._id,
        status: { $in: ['confirmed', 'active', 'approved'] },
      }),
      MealPlan.countDocuments({
        nutritionist: nutritionist._id,
        status: { $in: ['pending_approval', 'rejected'] },
      }),
      Meeting.countDocuments({
        nutritionist: nutritionist._id,
        status: 'scheduled',
        scheduledAt: { $gte: startOfToday, $lt: endOfToday },
      }),
      User.countDocuments({
        assignedNutritionist: nutritionist._id,
        subscriptionTier: 'premium',
      }),
    ]);

  res.status(200).json({
    success: true,
    data: {
      profile: {
        _id: nutritionist._id,
        title: nutritionist.title,
        specialization: nutritionist.specialization,
        rating: nutritionist.rating,
        maxClients: nutritionist.maxClients,
        availability: nutritionist.availability,
      },
      totalClients,
      premiumClients,
      activeMealPlans,
      pendingApprovals,
      todaysConsultations,
    },
  });
});

// @desc    All meal plans authored by the logged-in nutritionist
// @route   GET /api/nutritionists/my-plans
// @access  Private (Nutritionist)
export const getMyMealPlans = asyncHandler(async (req, res) => {
  const nutritionist = await Nutritionist.findOne({ user: req.user.id });
  if (!nutritionist) {
    throw new ApiError(404, 'Nutritionist profile not found');
  }

  const query = { nutritionist: nutritionist._id };
  if (req.query.status) query.status = req.query.status;

  const plans = await MealPlan.find(query)
    .populate('user', 'fullName email avatar healthProfile subscriptionTier')
    .populate({ path: 'days.meals.meal', select: 'name calories protein carbs fat image' })
    .populate({ path: 'days.meals.restaurant', select: 'restaurantName' })
    .sort({ updatedAt: -1 });

  res.status(200).json({ success: true, count: plans.length, data: plans });
});
