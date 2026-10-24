/**
 * NutriBite — Demo data seed
 *
 * Restores the original demo content: 2 nutritionists, 2 restaurants,
 * 3 meals and a demo member (Alex), all with the password "password123".
 *
 * Safe to re-run: it never deletes anything. Each record is created only if
 * it does not already exist (users by email, restaurants by name, meals by
 * name + restaurant). The admin account is NOT created here — use
 * `npm run seed` for that.
 *
 * Usage (from the server/ folder):
 *   npm run seed:demo                      -> add whatever demo data is missing
 *   npm run seed:demo -- --reset-passwords -> also set every demo user's
 *                                             password back to password123
 *                                             (use this if old demo users
 *                                             exist but can't log in)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

import User from '../models/User.js';
import Restaurant from '../models/Restaurant.js';
import Meal from '../models/Meal.js';
import Nutritionist from '../models/Nutritionist.js';
import connectDB from '../config/db.js';

const DEMO_PASSWORD = 'password123';
const resetPasswords = process.argv.includes('--reset-passwords');

const created = [];
const skipped = [];
const warnings = [];

// Create a user if missing. The plain password is passed on purpose:
// User.pre('save') hashes it once. Hashing here too would double-hash it.
const ensureUser = async (data) => {
  const email = data.email.toLowerCase();
  let user = await User.findOne({ email }).select('+password');

  if (!user) {
    user = await User.create({ ...data, email, password: DEMO_PASSWORD });
    created.push(`user ${email}`);
    return user;
  }

  skipped.push(`user ${email}`);

  if (resetPasswords) {
    user.password = DEMO_PASSWORD;
    await user.save();
    console.log(`🔑 Password reset for ${email}`);
  } else if (!(await user.matchPassword(DEMO_PASSWORD))) {
    warnings.push(
      `${email} exists but "${DEMO_PASSWORD}" does not log in. ` +
        'Re-run with: npm run seed:demo -- --reset-passwords'
    );
  }
  return user;
};

const ensureNutritionist = async (user, data) => {
  let doc = await Nutritionist.findOne({ user: user._id });
  if (!doc) {
    doc = await Nutritionist.create({ user: user._id, ...data });
    created.push(`nutritionist ${user.email}`);
  } else {
    skipped.push(`nutritionist ${user.email}`);
  }
  return doc;
};

const ensureRestaurant = async (user, data) => {
  let doc = await Restaurant.findOne({ restaurantName: data.restaurantName });
  if (!doc) {
    doc = await Restaurant.create({ user: user._id, ...data });
    created.push(`restaurant ${data.restaurantName}`);
  } else {
    skipped.push(`restaurant ${data.restaurantName}`);
  }
  return doc;
};

const ensureMeal = async (data) => {
  const exists = await Meal.findOne({ name: data.name, restaurant: data.restaurant });
  if (!exists) {
    await Meal.create(data);
    created.push(`meal ${data.name}`);
  } else {
    skipped.push(`meal ${data.name}`);
  }
};

const seedDemo = async () => {
  try {
    await connectDB();

    // 1. Users
    const nutritionistUser1 = await ensureUser({
      fullName: 'Dr. Neha Verma',
      email: 'neha@nutribite.com',
      role: 'nutritionist',
      avatar:
        'https://images.unsplash.com/photo-1594824813576-905bbfa16f02?auto=format&fit=crop&q=80&w=800',
    });

    const nutritionistUser2 = await ensureUser({
      fullName: 'Dr. Sophia Lin',
      email: 'sophia@nutribite.com',
      role: 'nutritionist',
      avatar:
        'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=800',
    });

    const restaurantUser = await ensureUser({
      fullName: 'GreenGourmet Manager',
      email: 'manager@greengourmet.com',
      role: 'restaurant',
    });

    // The original seed pointed Oceanic at the admin account "just for mock".
    // It now gets its own restaurant login instead.
    const oceanicUser = await ensureUser({
      fullName: 'Oceanic Manager',
      email: 'manager@oceaniceats.com',
      role: 'restaurant',
    });

    const regularUser = await ensureUser({
      fullName: 'Alex Morgan',
      email: 'alex@example.com',
      role: 'user',
      subscriptionTier: 'premium',
    });

    // 2. Nutritionists
    const nutritionist1 = await ensureNutritionist(nutritionistUser1, {
      title: 'Clinical Nutritionist',
      specialization: 'Weight Management',
      clientsCount: 128,
    });

    await ensureNutritionist(nutritionistUser2, {
      title: 'Endocrinologist',
      specialization: 'Diabetes Management',
      clientsCount: 420,
    });

    // Assign Alex to Neha, but only if Alex has no nutritionist yet
    if (!regularUser.assignedNutritionist) {
      regularUser.assignedNutritionist = nutritionist1._id;
      await regularUser.save();
      created.push('assignment alex -> neha');
    }

    // 3. Restaurants
    const greengourmet = await ensureRestaurant(restaurantUser, {
      restaurantName: 'GreenGourmet Kitchen',
      location: 'Downtown Hub',
      isPartner: true,
      status: 'active',
    });

    const oceanic = await ensureRestaurant(oceanicUser, {
      restaurantName: 'Oceanic Clean Eats',
      location: 'Westside',
      isPartner: true,
      status: 'active',
    });

    // 4. Meals
    await ensureMeal({
      name: 'Grilled Chicken Quinoa Bowl',
      category: 'High Protein',
      calories: 520,
      protein: 42,
      carbs: 42,
      fat: 14,
      price: 349,
      restaurant: greengourmet._id,
      image:
        'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&q=80&w=800',
    });

    await ensureMeal({
      name: 'Mediterranean Salmon Power Bowl',
      category: 'Low Carb',
      calories: 540,
      protein: 40,
      carbs: 28,
      fat: 22,
      price: 399,
      restaurant: oceanic._id,
      image:
        'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&q=80&w=800',
    });

    await ensureMeal({
      name: 'Avocado Tofu Power Salad',
      category: 'Vegan',
      calories: 480,
      protein: 28,
      carbs: 38,
      fat: 19,
      price: 349,
      restaurant: greengourmet._id,
      image:
        'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=800',
    });

    // Summary
    console.log(`\n✅ Created (${created.length}):`);
    created.forEach((c) => console.log(`   + ${c}`));
    console.log(`ℹ️  Already existed (${skipped.length}), left untouched.`);

    if (warnings.length) {
      console.log('\n⚠️  Warnings:');
      warnings.forEach((w) => console.log(`   - ${w}`));
    }

    console.log('\n🔐 Demo logins (password for all: ' + DEMO_PASSWORD + ')');
    console.log('   neha@nutribite.com          nutritionist');
    console.log('   sophia@nutribite.com        nutritionist');
    console.log('   manager@greengourmet.com    restaurant');
    console.log('   manager@oceaniceats.com     restaurant');
    console.log('   alex@example.com            member (premium)\n');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error in demo seeder:', error.message);
    process.exit(1);
  }
};

seedDemo();