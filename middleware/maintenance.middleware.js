const SettingsUtil = require('../utils/settings.util');

module.exports = async (req, res, next) => {
  try {
    // Check if headers have already been sent
    if (res.headersSent) {
      console.error('Headers already sent, cannot check maintenance mode');
      return next();
    }

    // Skip maintenance check for admin users
    if (req.session?.user?.admin) {
      return next();
    }

    // Skip maintenance check for login/logout routes
    const bypassRoutes = ['/login', '/logout', '/maintenance'];
    if (bypassRoutes.includes(req.path)) {
      return next();
    }

    const isMaintenanceMode = await SettingsUtil.isMaintenanceMode();

    if (isMaintenanceMode) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        // For API requests
        return res.status(503).json({
          success: false,
          message: 'System is currently under maintenance. Please try again later.'
        });
      } else {
        // For web requests
        return res.render('/', {
          title: 'System Maintenance',
          message: 'System is currently under maintenance. Please try again later.'
        });
      }
    }

    next();
  } catch (error) {
    console.error('Error in maintenance middleware:', error);
    next();
  }
};