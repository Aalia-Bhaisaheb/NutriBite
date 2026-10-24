import cron from 'node-cron';
import MealPlan from '../models/MealPlan.js';
import Order from '../models/Order.js';
import Notification from '../models/Notification.js';
import Meal from '../models/Meal.js';
import Restaurant from '../models/Restaurant.js';

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Core Logic Strategy:
// Runs daily at 8:00 PM to prepare for the *next* day.
export const runDailyScheduler = async () => {
  console.log('🔄 Running daily meal scheduler (Cron Job)...');

  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDayName = DAYS_OF_WEEK[tomorrow.getDay()];

    // Find all meal plans that are active or confirmed
    const activePlans = await MealPlan.find({
      status: { $in: ['confirmed', 'active'] },
      $or: [
        { endDate: { $gte: new Date() } },
        { endDate: null } // Just in case
      ]
    }).populate('user', 'fullName deliveryAddress');

    let ordersCreated = 0;

    for (const plan of activePlans) {
      // Find tomorrow's config in the plan
      const tomorrowSchedule = plan.days.find(d => d.dayOfWeek === tomorrowDayName);

      if (tomorrowSchedule && tomorrowSchedule.meals.length > 0) {

        // Group meals by restaurant so they can be dispatched together
        const mealsByRestaurant = {};

        for (const meal of tomorrowSchedule.meals) {
          if (!meal.restaurant) continue;

          const restId = meal.restaurant.toString();
          if (!mealsByRestaurant[restId]) {
            mealsByRestaurant[restId] = [];
          }

          // Record the meal's real catalogue price so kitchens can reconcile,
          // even though the member pays through their subscription.
          const catalogueMeal = meal.meal ? await Meal.findById(meal.meal).select('price') : null;

          mealsByRestaurant[restId].push({
            meal: meal.meal, // The meal _id
            quantity: 1,
            price: catalogueMeal?.price || 0,
            specialRequirements: meal.specialRequirements
          });
        }

        // Create an Order object for each restaurant
        for (const [restaurantId, items] of Object.entries(mealsByRestaurant)) {
          const itemsTotal = items.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);

          await Order.create({
            orderNumber: `SCH-${Math.floor(10000 + Math.random() * 90000)}`,
            user: plan.user._id,
            restaurant: restaurantId,
            items: items,
            totalAmount: itemsTotal,
            status: 'confirmed',
            deliveryAddress: plan.user.deliveryAddress || 'Address not set — contact member',
            isScheduled: true,
            mealPlan: plan._id,
            scheduledDate: tomorrow
          });
          ordersCreated++;

          // Let the kitchen know what it has to prep
          const restaurant = await Restaurant.findById(restaurantId).select('user restaurantName');
          if (restaurant) {
            await Notification.create({
              recipient: restaurant.user,
              title: `${items.length} meal(s) scheduled for ${tomorrowDayName}`,
              message: `A confirmed meal plan has scheduled ${items.length} meal(s) with your kitchen for tomorrow. Check your dashboard for prep details.`,
              type: 'info',
            });
          }
        }

        // Notify the user about tomorrow's meals being locked in
        await Notification.create({
          recipient: plan.user._id,
          title: "Tomorrow's Meals Scheduled",
          message: `Your meals for ${tomorrowDayName} have been automatically coordinated with partner kitchens.`,
          type: 'info'
        });
      }
    }

    console.log(`✅ Daily Scheduler Complete. Created ${ordersCreated} automated scheduled orders for tomorrow (${tomorrowDayName}).`);
  } catch (error) {
    console.error('❌ Error in daily meal scheduler:', error);
  }
};

// Setup cron trigger (0 20 * * * = 8:00 PM every day)
// For testing purposes, you could change this to '* * * * *' (every minute)
export const setupCronJobs = () => {
  console.log('⏰ Setting up cron jobs (Daily Meal Scheduler)');
  cron.schedule('0 20 * * *', runDailyScheduler);
};

export default setupCronJobs;
