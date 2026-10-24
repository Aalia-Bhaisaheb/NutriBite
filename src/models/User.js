import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Please add a name'],
    },
    email: {
      type: String,
      required: [true, 'Please add an email'],
      unique: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please add a valid email',
      ],
    },
    password: {
      type: String,
      required: [true, 'Please add a password'],
      minlength: 6,
      select: false, // Don't return password by default
    },
    role: {
      type: String,
      enum: ['user', 'nutritionist', 'restaurant', 'organization', 'admin'],
      default: 'user',
    },
    phone: String,
    avatar: String,
    deliveryAddress: String,

    // Embedded health profile for regular users
    healthProfile: {
      age: Number,
      gender: String,
      heightCm: Number,
      weightKg: Number,
      bmi: Number,
      medicalConditions: String,
      allergies: String,
      dietaryRestrictions: String,
      activityLevel: String,
      sleepHours: Number,
      exerciseFrequency: String,
      primaryGoal: String,
      foodPreferences: String,
      caloriesTarget: Number,
      proteinTarget: Number,
    },

    subscriptionTier: {
      type: String,
      enum: ['free', 'premium'],
      default: 'free',
    },
    assignedNutritionist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Nutritionist',
      default: null, // Null for free users
    },
    // Set when a member joins through a partner gym / clinic / company
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
    },
  },
  { timestamps: true }
);

// Encrypt password using bcrypt
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.model('User', userSchema);
