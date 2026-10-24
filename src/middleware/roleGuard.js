import { ApiError } from '../utils/apiError.js';

/**
 * Role-based access control middleware.
 * Usage: roleGuard('admin', 'nutritionist')
 */
const roleGuard = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role(s): ${allowedRoles.join(', ')}.`,
      });
    }
    next();
  };
};

export default roleGuard;
