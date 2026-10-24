/**
 * NutriBite — Admin bootstrap
 *
 * This script does NOT create any demo/mock content. All real data
 * (nutritionists, restaurants, meals, users, subscriptions) is created at
 * runtime: users sign up themselves, and the admin creates nutritionists,
 * restaurants and organizations from the Admin Console.
 *
 * The only thing this script does is make sure ONE administrator account
 * exists so that you can log in and start onboarding partners. It is
 * idempotent — running it twice will not duplicate or wipe anything.
 *
 * Usage:
 *   npm run seed                 -> creates the admin from .env (or defaults)
 *   npm run seed -- --reset-password  -> also resets the admin password
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

import User from '../models/User.js';
import connectDB from '../config/db.js';

const ADMIN_NAME = process.env.ADMIN_NAME || 'Platform Administrator';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@nutribite.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe@123';

const resetPassword = process.argv.includes('--reset-password');

const bootstrapAdmin = async () => {
  try {
    await connectDB();

    if (ADMIN_PASSWORD.length < 6) {
      throw new Error('ADMIN_PASSWORD must be at least 6 characters long.');
    }

    let admin = await User.findOne({ email: ADMIN_EMAIL }).select('+password');

    if (!admin) {
      // Pass the plain password — User.pre('save') hashes it automatically.
      // (Hashing it here too would double-hash it and break login.)
      admin = await User.create({
        fullName: ADMIN_NAME,
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        role: 'admin',
      });

      console.log('✅ Administrator account created.');
      console.log(`   Email:    ${ADMIN_EMAIL}`);
      console.log(`   Password: ${ADMIN_PASSWORD}`);
      console.log('   ⚠️  Change this password after your first login.');
    } else {
      if (admin.role !== 'admin') {
        admin.role = 'admin';
        await admin.save();
        console.log(`ℹ️  Existing account ${ADMIN_EMAIL} promoted to admin.`);
      }

      if (resetPassword) {
        admin.password = ADMIN_PASSWORD;
        await admin.save();
        console.log(`🔑 Password reset for ${ADMIN_EMAIL}.`);
      } else {
        console.log(`ℹ️  Administrator ${ADMIN_EMAIL} already exists — nothing to do.`);
        console.log('   Run `npm run seed -- --reset-password` if you forgot the password.');
      }
    }

    const counts = {
      users: await User.countDocuments({ role: 'user' }),
      nutritionists: await User.countDocuments({ role: 'nutritionist' }),
      restaurants: await User.countDocuments({ role: 'restaurant' }),
      organizations: await User.countDocuments({ role: 'organization' }),
    };

    console.log('\n📊 Current live database:');
    console.log(`   Members:       ${counts.users}`);
    console.log(`   Nutritionists: ${counts.nutritionists}`);
    console.log(`   Restaurants:   ${counts.restaurants}`);
    console.log(`   Organizations: ${counts.organizations}`);
    console.log('\n🎉 Done. Start the API with `npm run dev`, log in as admin and');
    console.log('   add your nutritionists and restaurants from the Admin Console.\n');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error in admin bootstrap:', error.message);
    process.exit(1);
  }
};

bootstrapAdmin();
