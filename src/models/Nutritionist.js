import mongoose from 'mongoose';

const nutritionistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    specialization: String,
    experienceYears: Number,
    bio: String,
    image: String,
    rating: {
      type: Number,
      default: 4.8,
    },
    clientsCount: {
      type: Number,
      default: 0,
    },
    availability: String,
    maxClients: {
      type: Number,
      default: 50,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Nutritionist', nutritionistSchema);
