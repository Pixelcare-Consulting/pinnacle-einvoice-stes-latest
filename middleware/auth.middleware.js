const prisma = require('../src/lib/prisma');
const { LoggingService, LOG_TYPES, MODULES, ACTIONS, STATUS } = require('../services/logging-prisma.service');
const authConfig = require('../config/auth.config');
const { getTokenSession } = require('../services/token-prisma.service'); // Import getTokenSession

// Active sessions and login attempts tracking
const activeSessions = new Map();
const loginAttempts = new Map();
const sessionActivity = new Map(); // Track detailed session activity

// Cleanup old login attempts and inactive sessions periodically
setInterval(() => {
  const now = Date.now();

  // Clean up login attempts
  for (const [key, data] of loginAttempts.entries()) {
    if (data.cooldownUntil && data.cooldownUntil < now) {
      loginAttempts.delete(key);
    }
  }

  // Clean up inactive sessions
  for (const [username, session] of activeSessions.entries()) {
    if (now - session.lastActivity > authConfig.session.timeout) {
      console.log(`Auto-removing inactive session for user: ${username}`);
      activeSessions.delete(username);

      // Log session timeout
      LoggingService.log({
        description: `Session timed out due to inactivity: ${username}`,
        username: username,
        ipAddress: session.ipAddress || 'unknown',
        logType: LOG_TYPES.INFO,
        module: MODULES.AUTH,
        action: ACTIONS.SESSION_TIMEOUT,
        status: STATUS.SUCCESS,
        details: {
          lastActivity: new Date(session.lastActivity).toISOString(),
          inactiveDuration: Math.floor((now - session.lastActivity) / 1000) + ' seconds'
        }
      }).catch(err => console.error('Error logging session timeout:', err));
    }
  }
}, authConfig.login.cleanupInterval);

// Helper function to handle unauthorized access
const handleUnauthorized = async (req, res, reason = 'unauthorized') => {
  await LoggingService.log({
    description: `Unauthorized access attempt - ${reason}`,
    username: req.session?.user?.username || 'anonymous',
    userId: req.session?.user?.id,
    ipAddress: req.ip,
    logType: LOG_TYPES.WARNING,
    module: MODULES.AUTH,
    action: ACTIONS.READ,
    status: STATUS.FAILED,
    details: {
      path: req.path,
      method: req.method,
      reason
    }
  });

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      reason: reason
    });
  }
  return res.redirect('/login');
};

// Helper function to handle session expiry
const handleSessionExpiry = (req, res, reason) => {
  return new Promise(async (resolve) => {
    const username = req.session?.user?.username;
    const userId = req.session?.user?.id;

    await LoggingService.log({
      description: `Session expired - ${reason}`,
      username: username || 'anonymous',
      userId: userId,
      ipAddress: req.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.AUTH,
      action: ACTIONS.LOGOUT,
      status: STATUS.SUCCESS,
      details: { reason }
    });

    req.session.destroy(() => {
      removeActiveSession(username);
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        resolve(res.status(401).json({
          success: false,
          message: reason || 'Session expired'
        }));
      } else {
        resolve(res.redirect('/auth/login?expired=true&reason=' + encodeURIComponent(reason || 'timeout')));
      }
    });
  });
};

// Login attempt tracking functions
const trackLoginAttempt = async (username, ip, success) => {
  const key = `${username}:${ip}`;
  const now = new Date();
  const attempts = loginAttempts.get(key) || { count: 0, lastAttempt: 0, cooldownUntil: 0 };

  if (success) {
    attempts.count = 0;
    attempts.cooldownUntil = 0;
  } else {
    attempts.count++;
    attempts.lastAttempt = now.getTime();

    if (attempts.count >= authConfig.login.maxAttempts) {
      attempts.cooldownUntil = now.getTime() + authConfig.login.lockoutDuration;
    }
  }

  loginAttempts.set(key, attempts);

  // Format the timestamp in SQL Server format
  const timestamp = now.toISOString()
    .replace('T', ' ')
    .replace('Z', '')
    .split('.')[0]; // Remove milliseconds

  await LoggingService.log({
    description: success ?
      `User login: ${username}` :
      `Login attempt for user ${username} - Failed (Attempt ${attempts.count})${attempts.cooldownUntil > now.getTime() ? ' - Account locked' : ''}`,
    username,
    ipAddress: ip,
    logType: success ? LOG_TYPES.INFO : LOG_TYPES.WARNING,
    module: MODULES.AUTH,
    action: success ? ACTIONS.LOGIN : ACTIONS.FAILED_LOGIN,
    status: success ? STATUS.SUCCESS : STATUS.FAILED,
    details: {
      attempts: attempts.count,
      inCooldown: attempts.cooldownUntil > now.getTime(),
      cooldownRemaining: Math.max(0, Math.ceil((attempts.cooldownUntil - now.getTime()) / 1000)),
      timestamp: timestamp
    }
  });

  return attempts;
};

// Check login attempts
const checkLoginAttempts = (username, ip) => {
  const key = `${username}:${ip}`;
  const attempts = loginAttempts.get(key);

  if (!attempts) return { allowed: true };

  const now = Date.now();

  if (now < attempts.cooldownUntil) {
    const remainingCooldown = Math.ceil((attempts.cooldownUntil - now) / 1000);
    return {
      allowed: false,
      cooldownRemaining: remainingCooldown,
      message: `Too many login attempts. Please try again in ${Math.ceil(remainingCooldown / 60)} minutes.`
    };
  }

  return {
    allowed: true,
    attemptsRemaining: authConfig.login.maxAttempts - attempts.count
  };
};

// Session management functions
const checkActiveSession = (username) => {
  const existingSession = activeSessions.get(username);
  if (existingSession) {
    const now = Date.now();
    if (now - existingSession.lastActivity < authConfig.session.timeout) {
      return true;
    }
    // Session has expired, remove it
    activeSessions.delete(username);

    // Log session expiry
    LoggingService.log({
      description: `Session expired for user: ${username}`,
      username: username,
      ipAddress: existingSession.ipAddress || 'unknown',
      logType: LOG_TYPES.INFO,
      module: MODULES.AUTH,
      action: ACTIONS.SESSION_EXPIRED,
      status: STATUS.SUCCESS,
      details: {
        lastActivity: new Date(existingSession.lastActivity).toISOString(),
        inactiveDuration: Math.floor((now - existingSession.lastActivity) / 1000) + ' seconds'
      }
    }).catch(err => console.error('Error logging session expiry:', err));
  }
  return false;
};

const updateActiveSession = (username, req = null) => {
  const now = Date.now();
  const existingSession = activeSessions.get(username);

  // Get IP address if request object is provided
  const ipAddress = req ?
    (req.headers['x-forwarded-for']?.split(',')[0].trim() ||
     req.headers['x-real-ip'] ||
     req.connection.remoteAddress ||
     req.ip) :
    (existingSession?.ipAddress || 'unknown');

  // Update session with new activity time and additional info
  activeSessions.set(username, {
    lastActivity: now,
    ipAddress: ipAddress,
    userAgent: req?.headers['user-agent'] || existingSession?.userAgent || 'unknown',
    createdAt: existingSession?.createdAt || now
  });

  // Only track activity for important paths to reduce logging
  if (req && isImportantPath(req.path)) {
    // Track detailed session activity (limit to 20 entries per user)
    const userActivity = sessionActivity.get(username) || [];
    userActivity.push({
      timestamp: now,
      path: req.path || 'api-call',
      method: req.method || 'UNKNOWN',
      ipAddress: ipAddress
    });

    // Keep only the last 20 activities instead of 100
    if (userActivity.length > 20) {
      userActivity.shift();
    }

    sessionActivity.set(username, userActivity);
  }
};

// Helper function to determine if a path is important enough to log
function isImportantPath(path) {
  if (!path) return false;

  // Only log important paths like login, logout, admin actions
  const importantPaths = [
    '/auth/login',
    '/auth/logout',
    '/api/admin',
    '/api/user/profile',
    '/api/user/session-info',
    '/settings',
    '/users',
    '/company/profile',
    '/api/company',
    '/api/user/users-list'
  ];

  return importantPaths.some(p => path.includes(p));
}

const removeActiveSession = (username) => {
  // Get session before removing for logging
  const session = activeSessions.get(username);

  // Remove session
  activeSessions.delete(username);

  // Remove session activity
  sessionActivity.delete(username);

  // Log session removal if session existed
  if (session) {
    LoggingService.log({
      description: `Session removed for user: ${username}`,
      username: username,
      ipAddress: session.ipAddress || 'unknown',
      logType: LOG_TYPES.INFO,
      module: MODULES.AUTH,
      action: ACTIONS.SESSION_REMOVED,
      status: STATUS.SUCCESS,
      details: {
        sessionDuration: Math.floor((Date.now() - session.createdAt) / 1000) + ' seconds',
        lastActivity: new Date(session.lastActivity).toISOString()
      }
    }).catch(err => console.error('Error logging session removal:', err));
  }
};

// Get session activity for a user
const getSessionActivity = (username) => {
  return sessionActivity.get(username) || [];
};

// Authentication middleware
const authMiddleware = (req, res, next) => {
  // Check if path is public
  if (authConfig.publicPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  // Check if user is authenticated via session
  if (req.session && req.session.user) {
    // Log session user data for debugging
    if (isImportantPath(req.path)) {
      console.log('=== SESSION USER DATA ===');
      console.log('Path:', req.path);
      console.log('User ID:', req.session.user.id);
      console.log('Username:', req.session.user.username);
      console.log('Admin Status:', req.session.user.admin);
      console.log('=== END SESSION USER DATA ===');
    }

    // Check if session is about to expire
    if (req.session.cookie && req.session.cookie.expires) {
      const sessionExpiryTime = req.session.cookie.expires;
      const now = new Date();
      const timeRemaining = sessionExpiryTime - now;

      // If session is about to expire (less than 2 minutes), extend it
      if (timeRemaining < 120000) {
        req.session.cookie.maxAge = authConfig.session.timeout;
        if (isImportantPath(req.path)) {
          console.log(`Extended session for user ${req.session.user.username} - was about to expire in ${Math.floor(timeRemaining / 1000)} seconds`);
        }
      }
    }

    // Update active session tracking
    updateActiveSession(req.session.user.username, req);

    return next();
  }

  // For API requests, return 401
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  // For regular requests, redirect to login page
  res.redirect('/auth/login?redirect=' + encodeURIComponent(req.originalUrl));
};

const isAdmin = (req, res, next) => {
  // Check if user is authenticated and is an admin
  if (req.session && req.session.user && (req.session.user.admin === 1 || req.session.user.admin === true)) {
    console.log('Admin access granted for user:', req.session.user.username);
    return next();
  }

  console.log('Admin access denied for user:', req.session?.user?.username, 'Admin value:', req.session?.user?.admin);

  // For API requests, return 403
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }

  // For regular requests, redirect to dashboard
  res.redirect('/dashboard?error=admin-required');
};

// Update to handle cases where req object isn't available
async function updateUserActivity(userId, isActive = true, req = null) {
  try {
    const updateData = {
      LastLoginTime: isActive ? sequelize.literal('GETDATE()') : null,
      isActive: isActive
    };

    // Only include IP address if req object is available
    if (req) {
      const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                      req.headers['x-real-ip'] ||
                      req.connection.remoteAddress ||
                      req.ip;
      updateData.LastIPAddress = clientIP;
    }

    await WP_USER_REGISTRATION.update(updateData, {
      where: { ID: userId }
    });

    return true;
  } catch (error) {
    console.error('Error updating user activity:', error);
    return false;
  }
}

const handleLogout = async (req, res) => {
    try {
        if (req.session?.user?.id) {
            // Update user's active status to false on logout
            req.session.user.isActive = false;
            await updateUserActivity(req.session.user.id, false);

            // Remove from active sessions
            removeActiveSession(req.session.user.username);

            // Format timestamp consistently
            const now = new Date();
            const timestamp = now.toISOString()
                .replace('T', ' ')
                .replace('Z', '')
                .split('.')[0];

            // Log the logout
            await LoggingService.log({
                description: 'User logged out',
                username: req.session.user.username,
                userId: req.session.user.id,
                ipAddress: req.ip,
                logType: LOG_TYPES.INFO,
                module: MODULES.AUTH,
                action: ACTIONS.LOGOUT,
                status: STATUS.SUCCESS,
                details: {
                    timestamp: timestamp
                }
            });
        }

        req.session.destroy(() => {
            if (req.xhr || req.headers.accept?.includes('application/json')) {
                res.json({ success: true });
            } else {
                res.redirect('/login');
            }
        });
    } catch (error) {
        console.error('Error during logout:', error);
        res.status(500).json({ success: false, error: 'Logout failed' });
    }
};

// Update the isApiAuthenticated middleware to pass the req object - optimized to reduce logging
async function isApiAuthenticated(req, res, next) {
  try {
    // Check if session exists
    if (!req.session?.user) {
      // Don't force logout, just return 401 for API requests
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
        needsLogin: true
      });
    }

    // Get LHDN access token and attach to headers
    try {
      // First try to get token from file
      const fs = require('fs');
      const path = require('path');
      const tokenFilePath = path.join(__dirname, '../config/AuthorizeToken.ini');
      let lhdnToken = null;

      if (fs.existsSync(tokenFilePath)) {
        try {
          const tokenData = fs.readFileSync(tokenFilePath, 'utf8');

          // Try different possible token formats in the file
          let tokenMatch = tokenData.match(/AccessToken=(.+)/i) ||
                          tokenData.match(/access_token=(.+)/i) ||
                          tokenData.match(/token=(.+)/i);

          if (tokenMatch && tokenMatch[1]) {
            lhdnToken = tokenMatch[1].trim();
            console.log('Using token from AuthorizeToken.ini file');
          } else {
            // Try to parse as JSON if no match found
            try {
              const jsonData = JSON.parse(tokenData);
              if (jsonData.access_token) {
                lhdnToken = jsonData.access_token;
                console.log('Using token from JSON format in AuthorizeToken.ini file');
              }
            } catch (jsonError) {
              // Not JSON format, continue
            }
          }
        } catch (fileError) {
          console.error('Error reading token from file:', fileError);
        }
      }

      // If no token from file, try to get from session
      if (!lhdnToken && req.session.accessToken) {
        lhdnToken = req.session.accessToken;
        console.log('Using token from session');
      }

      // If still no token, try to get a fresh one
      if (!lhdnToken) {
        lhdnToken = await getTokenSession();
        console.log('Generated fresh token');

        // Save the token to session for future use
        if (lhdnToken) {
          req.session.accessToken = lhdnToken;
        }
      }

      if (lhdnToken) {
        req.headers['Authorization'] = `Bearer ${lhdnToken}`;
        console.log('Attached LHDN token to request headers');
      } else {
        console.warn('LHDN token not available. Proceeding without token.');
      }
    } catch (tokenError) {
      console.error('Error getting LHDN token in middleware:', tokenError);
      // Continue even if token acquisition fails, but log the error
    }

    // Check if session is about to expire
    if (req.session.cookie && req.session.cookie.expires) {
      const sessionExpiryTime = req.session.cookie.expires;
      const now = new Date();
      const timeRemaining = sessionExpiryTime - now;

      // If session is about to expire (less than 2 minutes), extend it
      if (timeRemaining < 120000) {
        req.session.cookie.maxAge = authConfig.session.timeout;
        // Only log session extensions for important paths
        if (isImportantPath(req.path)) {
          console.log(`Extended session for user ${req.session.user.username} - was about to expire in ${Math.floor(timeRemaining / 1000)} seconds`);
        }
      }
    }

    // Only update user activity for important paths to reduce database load
    if (isImportantPath(req.path)) {
      try {
        // Update user activity in database - but don't block if it fails
        await updateUserActivity(req.session.user.id, true, req);
      } catch (activityError) {
        console.error('Error updating user activity:', activityError);
        // Continue despite error
      }
    }

    // Always update active session tracking but with reduced logging
    try {
      updateActiveSession(req.session.user.username, req);
    } catch (sessionError) {
      console.error('Error updating active session:', sessionError);
      // Continue despite error
    }

    // Allow the request to proceed
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    // Don't block the request on error, just log it
    next();
  }
}

module.exports = {
  middleware: authMiddleware, // Export as middleware for backward compatibility
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
  handleLogout,
  updateUserActivity,
  getSessionActivity
};
