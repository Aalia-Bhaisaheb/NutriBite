import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import MealPlan from '../models/MealPlan.js';
import Order from '../models/Order.js';
import connectDB from '../config/db.js';
import { runDailyScheduler } from '../jobs/dailyMealScheduler.js';

await connectDB();

const plans = await MealPlan.find({ status: { $in: ['confirmed', 'active'] } });
for (const p of plans) {
  console.log(p.title, '| status:', p.status, '| start:', p.startDate, '| end:', p.endDate,
    '| days:', p.days.map((d) => `${d.dayOfWeek}(${d.meals.length} meals)`).join(', '));
}
console.log('Tomorrow is', new Date(Date.now() + 864e5).toLocaleDateString('en-US', { weekday: 'long' }));

if (process.argv.includes('--run')) await runDailyScheduler();

console.log('Orders in DB:', await Order.countDocuments(),
  '| scheduled:', await Order.countDocuments({ isScheduled: true }));
await mongoose.connection.close();