import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    items: [
      {
        meal: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Meal',
          required: true,
        },
        quantity: {
          type: Number,
          default: 1,
        },
        price: Number,
        specialRequirements: String,
      },
    ],
    totalAmount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: [
        'placed',
        'confirmed',
        'preparing',
        'out_for_delivery',
        'delivered',
        'cancelled',
      ],
      default: 'placed',
    },
    deliveryAddress: String,
    estimatedDelivery: String,

    // For Meal Plan Automated Orders via Cron
    isScheduled: {
      type: Boolean,
      default: false,
    },
    mealPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MealPlan',
      default: null,
    },
    scheduledDate: Date,
  },
  { timestamps: true }
);

export default mongoose.model('Order', orderSchema);
