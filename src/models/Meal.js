import mongoose from 'mongoose';

const mealSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: String,
    category: {
      type: String,
      required: true,
    },
    calories: Number,
    protein: Number,
    carbs: Number,
    fat: Number,
    price: Number,
    image: String,
    tags: [String],
    ingredients: [String],
    rating: {
      type: Number,
      default: 5.0,
      min: 1,
      max: 5,
    },
    prepTimeMinutes: Number,
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Meal', mealSchema);
