import mongoose from 'mongoose';
import Meal from '../models/Meal.js';
import Restaurant from '../models/Restaurant.js';
import { ApiError, asyncHandler } from '../utils/apiError.js';

/**
 * Resolves which restaurant the current request may write to.
 * A restaurant owner may only touch their own menu; an admin may pass
 * ?restaurantId= / body.restaurantId to act on any kitchen.
 */
const resolveOwnedRestaurant = async (req) => {
  if (req.user.role === 'admin') {
    const restaurantId = req.body.restaurantId || req.query.restaurantId;
    if (!restaurantId) throw new ApiError(400, 'restaurantId is required when acting as admin.');
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) throw new ApiError(404, 'Restaurant not found.');
    return restaurant;
  }

  const restaurant = await Restaurant.findOne({ user: req.user.id });
  if (!restaurant) throw new ApiError(404, 'No restaurant profile is linked to this account.');
  return restaurant;
};

// @desc    Get all meals
// @route   GET /api/meals
// @access  Public
export const getMeals = asyncHandler(async (req, res) => {
  const { category, search, restaurant } = req.query;

  const query = { isAvailable: true };

  if (category && category !== 'All Meals') {
    // Match either the primary category or one of the tags
    query.$or = [{ category }, { tags: category }];
  }

  if (search && search.trim()) {
    const rx = new RegExp(search.trim(), 'i');
    const matchingRestaurants = await Restaurant.find({ restaurantName: rx }).select('_id').lean();
    const searchConditions = [
      { name: rx },
      { description: rx },
      { restaurant: { $in: matchingRestaurants.map((r) => r._id) } },
    ];
    // Combine with the category filter without clobbering it
    query.$and = [...(query.$or ? [{ $or: query.$or }] : []), { $or: searchConditions }];
    delete query.$or;
  }

  if (restaurant && mongoose.isValidObjectId(restaurant)) {
    query.restaurant = restaurant;
  }

  const meals = await Meal.find(query)
    .populate('restaurant', 'restaurantName location')
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, count: meals.length, data: meals });
});

// @desc    Get the list of categories currently present in the catalog
// @route   GET /api/meals/categories
// @access  Public
export const getMealCategories = asyncHandler(async (req, res) => {
  const [categories, tags] = await Promise.all([
    Meal.distinct('category', { isAvailable: true }),
    Meal.distinct('tags', { isAvailable: true }),
  ]);

  const merged = Array.from(new Set([...categories, ...tags].filter(Boolean))).sort();

  res.status(200).json({ success: true, data: ['All Meals', ...merged] });
});

// @desc    Get the menu belonging to the logged-in restaurant
// @route   GET /api/meals/my-menu
// @access  Private (Restaurant, Admin)
export const getMyMenu = asyncHandler(async (req, res) => {
  const restaurant = await resolveOwnedRestaurant(req);
  const meals = await Meal.find({ restaurant: restaurant._id }).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: meals.length,
    restaurant: { _id: restaurant._id, restaurantName: restaurant.restaurantName },
    data: meals,
  });
});

// @desc    Get single meal
// @route   GET /api/meals/:id
// @access  Public
export const getMealById = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw new ApiError(400, 'Invalid meal id.');
  }

  const meal = await Meal.findById(req.params.id).populate(
    'restaurant',
    'restaurantName location image'
  );

  if (!meal) {
    throw new ApiError(404, 'Meal not found');
  }

  res.status(200).json({ success: true, data: meal });
});

const parseList = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
};

// @desc    Add a meal to the menu
// @route   POST /api/meals
// @access  Private (Restaurant, Admin)
export const createMeal = asyncHandler(async (req, res) => {
  const restaurant = await resolveOwnedRestaurant(req);

  const { name, category, description, calories, protein, carbs, fat, price, image, tags, ingredients, prepTimeMinutes, isAvailable } = req.body;

  if (!name || !category) {
    throw new ApiError(400, 'Meal name and category are required.');
  }

  const meal = await Meal.create({
    name,
    category,
    description,
    calories: calories !== undefined ? Number(calories) : undefined,
    protein: protein !== undefined ? Number(protein) : undefined,
    carbs: carbs !== undefined ? Number(carbs) : undefined,
    fat: fat !== undefined ? Number(fat) : undefined,
    price: price !== undefined ? Number(price) : undefined,
    image,
    tags: parseList(tags),
    ingredients: parseList(ingredients),
    prepTimeMinutes: prepTimeMinutes !== undefined ? Number(prepTimeMinutes) : undefined,
    isAvailable: isAvailable === undefined ? true : Boolean(isAvailable),
    restaurant: restaurant._id,
  });

  res.status(201).json({ success: true, data: meal });
});

// @desc    Update a meal on the menu
// @route   PUT /api/meals/:id
// @access  Private (Restaurant, Admin)
export const updateMeal = asyncHandler(async (req, res) => {
  const meal = await Meal.findById(req.params.id);
  if (!meal) throw new ApiError(404, 'Meal not found.');

  if (req.user.role !== 'admin') {
    const restaurant = await Restaurant.findOne({ user: req.user.id });
    if (!restaurant || String(meal.restaurant) !== String(restaurant._id)) {
      throw new ApiError(403, 'You can only edit meals on your own menu.');
    }
  }

  const fields = ['name', 'category', 'description', 'image'];
  const numericFields = ['calories', 'protein', 'carbs', 'fat', 'price', 'prepTimeMinutes'];

  fields.forEach((f) => {
    if (req.body[f] !== undefined) meal[f] = req.body[f];
  });
  numericFields.forEach((f) => {
    if (req.body[f] !== undefined) meal[f] = Number(req.body[f]);
  });
  if (req.body.tags !== undefined) meal.tags = parseList(req.body.tags);
  if (req.body.ingredients !== undefined) meal.ingredients = parseList(req.body.ingredients);
  if (req.body.isAvailable !== undefined) meal.isAvailable = Boolean(req.body.isAvailable);

  await meal.save();
  res.status(200).json({ success: true, data: meal });
});

// @desc    Remove a meal from the menu
// @route   DELETE /api/meals/:id
// @access  Private (Restaurant, Admin)
export const deleteMeal = asyncHandler(async (req, res) => {
  const meal = await Meal.findById(req.params.id);
  if (!meal) throw new ApiError(404, 'Meal not found.');

  if (req.user.role !== 'admin') {
    const restaurant = await Restaurant.findOne({ user: req.user.id });
    if (!restaurant || String(meal.restaurant) !== String(restaurant._id)) {
      throw new ApiError(403, 'You can only remove meals from your own menu.');
    }
  }

  await meal.deleteOne();
  res.status(200).json({ success: true, message: 'Meal removed.', data: { _id: req.params.id } });
});
