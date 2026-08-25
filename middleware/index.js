const {
  authMiddleware,
  isAdmin,
  isApiAuthenticated,
  trackLoginAttempt,
  checkLoginAttempts,
  checkActiveSession,
  updateActiveSession,
  removeActiveSession,
  handleSessionExpiry,
  handleUnauthorized,
  updateUserActivity,
  getSessionActivity
} = require('./auth-prisma.middleware');

const errorMiddleware = require('./error.middleware');
const maintenanceMiddleware = require('./maintenance.middleware');
const validation = require('./validation');

module.exports = {
  auth: {
    middleware: authMiddleware,
    isAdmin,
    isApiAuthenticated,
    trackLoginAttempt,
    checkLoginAttempts,
    checkActiveSession,
    updateActiveSession,
    removeActiveSession,
    handleSessionExpiry,
    handleUnauthorized,
    updateUserActivity,
    getSessionActivity
  },
  error: errorMiddleware,
  maintenance: maintenanceMiddleware,
  validation
};
