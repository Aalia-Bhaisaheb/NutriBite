import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { ApiError } from './utils/apiError.js';

const app = express();

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Base Route
app.get('/', (req, res) => {
  res.status(200).json({ message: 'NutriBite API is running.' });
});

// Routes Import
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import mealRoutes from './routes/meal.routes.js';
import nutritionistRoutes from './routes/nutritionist.routes.js';
import restaurantRoutes from './routes/restaurant.routes.js';
import organizationRoutes from './routes/organization.routes.js';
import adminRoutes from './routes/admin.routes.js';
import subscriptionRoutes from './routes/subscription.routes.js';
import mealPlanRoutes from './routes/mealPlan.routes.js';
import orderRoutes from './routes/order.routes.js';

// Route mounting
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/meals', mealRoutes);
app.use('/api/nutritionists', nutritionistRoutes);
app.use('/api/restaurants', restaurantRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/meal-plans', mealPlanRoutes);
app.use('/api/orders', orderRoutes);

// 404 handler
app.use((req, res, next) => {
  next(new ApiError(404, `Route ${req.originalUrl} not found`));
});

// Global Error Handler
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
});

export default app;
