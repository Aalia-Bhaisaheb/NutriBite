import mongoose from 'mongoose';

const mealPlanSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    nutritionist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Nutritionist',
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    startDate: Date,
    endDate: Date,
    status: {
      type: String,
      enum: [
        'draft',
        'pending_approval',
        'rejected',
        'approved',
        'confirmed',
        'active',
        'completed',
      ],
      default: 'draft',
    },
    days: [
      {
        dayOfWeek: {
          type: String,
          required: true, // e.g., 'Monday'
        },
        meals: [
          {
            mealType: {
              type: String,
              enum: ['breakfast', 'lunch', 'snack', 'dinner'],
              required: true,
            },
            meal: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'Meal',
            },
            customName: String, // If not picking from catalog directly
            calories: Number,
            protein: Number,
            carbs: Number,
            fat: Number,
            restaurant: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'Restaurant',
            },
            specialRequirements: String,
            deliveryTime: String,
          },
        ],
        totalCalories: Number,
        totalProtein: Number,
      },
    ],
    rejectionHistory: [
      {
        rejectedAt: Date,
        feedback: String,
        revisedAt: Date,
      },
    ],
    approvedAt: Date,
    confirmedAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model('MealPlan', mealPlanSchema);
