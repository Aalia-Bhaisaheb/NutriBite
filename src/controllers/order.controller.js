import Order from '../models/Order.js';
import Meal from '../models/Meal.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';

// @desc    Create new on-demand order
// @route   POST /api/orders
// @access  Private
export const createOrder = asyncHandler(async (req, res) => {
  const { items, restaurantId, deliveryAddress } = req.body;

  if (!items || items.length === 0) {
    throw new ApiError(400, 'No order items');
  }

  // Calculate total amount (in a real app, verify prices against DB)
  let totalAmount = 0;
  for (const item of items) {
    const meal = await Meal.findById(item.meal);
    if (!meal) throw new ApiError(404, `Meal ${item.meal} not found`);
    totalAmount += (meal.price * item.quantity);
  }

  const order = await Order.create({
    orderNumber: `NB-${Math.floor(10000 + Math.random() * 90000)}`, // Random 5-digit
    user: req.user.id,
    restaurant: restaurantId,
    items,
    totalAmount,
    status: 'placed',
    deliveryAddress,
    isScheduled: false, // Explicitly false for on-demand
  });

  res.status(201).json({ success: true, data: order });
});

// @desc    Get logged in user orders
// @route   GET /api/orders/my
// @access  Private
export const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user.id })
    .populate('restaurant', 'restaurantName')
    .populate('items.meal', 'name image price')
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, count: orders.length, data: orders });
});

// @desc    Update order status
// @route   PATCH /api/orders/:id/status
// @access  Private (Restaurant or Admin)
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const order = await Order.findById(req.params.id);

  if (!order) {
    throw new ApiError(404, 'Order not found');
  }

  order.status = status;
  await order.save();

  res.status(200).json({ success: true, data: order });
});
