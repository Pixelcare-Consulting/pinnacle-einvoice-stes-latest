const express = require('express');
const router = express.Router();
const prisma = require('../src/lib/prisma');
const bcrypt = require('bcryptjs');
const moment = require('moment');
const loggingConfig = require('../config/logging.config');
const { checkActiveSession, updateActiveSession, removeActiveSession, checkLoginAttempts, trackLoginAttempt } = require('../middleware/auth-prisma.middleware');
const passport = require('passport');
const { LoggingService } = require('../services/logging-prisma.service');
const { getTokenSession } = require('../services/token-prisma.service');
const { LOG_TYPES, ACTIONS, STATUS, MODULES } = require('../services/logging-prisma.service');
const { updateUserActivity } = require('../middleware/auth-prisma.middleware');

// Move constants to top
const LOGIN_CONSTANTS = {
  MAX_ATTEMPTS: 5,
  BLOCK_DURATION: 5 * 60 * 1000, // 5 minutes
  CLEANUP_INTERVAL: 60000 // 1 minute
};

// Store for tracking failed attempts
const loginAttempts = new Map();

// Cleanup old login attempts
setInterval(() => {
  const now = Date.now();
  for (const [username, data] of loginAttempts.entries()) {
    if (data.blockedUntil && data.blockedUntil < now) {
      loginAttempts.delete(username);
    }
  }
}, LOGIN_CONSTANTS.CLEANUP_INTERVAL);

// Enhanced logging function
async function logAuthEvent(type, details, req) {
  if (!loggingConfig.auth[type]) return;

  const username = details.username || 'unknown';
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                  req.headers['x-real-ip'] ||
                  req.connection.remoteAddress ||
                  req.ip;

  const actionMap = {
    loginAttempts: 'Unknown',
    successfulLogins: 'LOGIN',
    failedLogins: 'LOGIN_FAILED',
    logouts: 'LOGOUT',
    errors: 'ERROR',
    sessionActivity: 'SESSION',
  };

  try {
    await prisma.wP_LOGS.create({
      data: {
        CreateTS: new Date(),
        LoggedUser: username,
        IPAddress: clientIP || '-1',
        Module: 'Authentication',
        Action: actionMap[type] || 'Unknown',
        Status: details.status || 'Unknown',
        Description: details.description || `Auth event: ${type}`,
        Details: JSON.stringify({
          eventType: type,
          timestamp: new Date().toISOString(),
          ...details,
          ...(loggingConfig.auth.ipTracking && { ip: clientIP }),
          ...(loggingConfig.auth.userAgentTracking && { userAgent: req.headers['user-agent'] }),
          sessionId: req.session?.id,
          requestPath: req.path,
          requestMethod: req.method
        })
      }
    });
  } catch (error) {
    console.error('Error logging auth event:', error);
  }
}

// Login page route (HTML)
router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }

  // Check if there's an active session for this user from the URL parameter
  const hasExistingSession = req.query.sessionCheck === 'true';

  res.render('auth/login', {
    title: 'Login',
    layout: 'auth/auth.layout',
    sessionError: hasExistingSession // Use a different variable name
  });
});

// Login handler with Passport
router.post('/login', async (req, res, next) => {
  const { username, reconnect } = req.body;
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                  req.headers['x-real-ip'] ||
                  req.connection.remoteAddress;
  try {
    // Check if there's an active session for this user
    const hasActiveSession = checkActiveSession(username);

    // Handle reconnection options
    if (hasActiveSession) {
      // If reconnect is 'force', we'll force logout the existing session
      if (reconnect === 'force') {
        // Force logout the existing session
        removeActiveSession(username);

        // Log the forced logout
        await LoggingService.log({
          description: `Forced logout of existing session for user: ${username}`,
          username: username,
          ipAddress: clientIP,
          logType: LOG_TYPES.WARNING,
          module: MODULES.AUTH,
          action: ACTIONS.SESSION_REMOVED,
          status: STATUS.SUCCESS,
          details: {
            reason: 'User requested new session',
            forcedBy: 'User',
            ipAddress: clientIP
          }
        });
      }
      // If reconnect is not 'true' and not 'force', we'll show the active session error
      else if (reconnect !== 'true') {
        // Check if this is an API request or form submission
        const isApiRequest = req.headers['accept'] && req.headers['accept'].includes('application/json');
        if (isApiRequest) {
          return res.status(409).json({
            success: false,
            message: 'User already has an active session',
            activeSession: true
          });
        } else {
          // Form submission - redirect with error
          return res.redirect('/auth/login?sessionCheck=true');
        }
      }
      // If reconnect is 'true', we'll continue with the login process and update the existing session
    }

    // Check login attempts
    const attemptCheck = checkLoginAttempts(username, clientIP);
    if (!attemptCheck.allowed) {
      // Check if this is an API request or form submission
      const isApiRequest = req.headers['accept'] && req.headers['accept'].includes('application/json');
      if (isApiRequest) {
        return res.status(429).json({
          success: false,
          message: attemptCheck.message
        });
      } else {
        // Form submission - redirect with error
        return res.redirect('/auth/login?error=too-many-attempts');
      }
    }

    // Use Passport authentication
    passport.authenticate('local', async (err, user, info) => {
      if (err) {
        await trackLoginAttempt(username, clientIP, false);
        return next(err);
      }

      if (!user) {
        await trackLoginAttempt(username, clientIP, false);

        // Check if this is an API request or form submission
        const isApiRequest = req.headers['accept'] && req.headers['accept'].includes('application/json');
        if (isApiRequest) {
          return res.status(401).json({
            success: false,
            message: info.message || 'Invalid credentials'
          });
        } else {
          // Form submission - redirect with error
          return res.redirect('/auth/login?error=invalid-credentials');
        }
      }

      // Log successful login
      await trackLoginAttempt(username, clientIP, true);

      // Update last login time
      await prisma.wP_USER_REGISTRATION.update({
        where: { ID: user.ID },
        data: { LastLoginTime: new Date() }
      });

      // Login with Passport
      req.logIn(user, async (loginErr) => {
        if (loginErr) {
          return next(loginErr);
        }

        try {
          // Set up session first to ensure user is logged in even if token acquisition fails
          req.session.user = {
            id: user.ID,
            username: user.Username,
            admin: user.Admin === 1,
            IDType: user.IDType,
            IDValue: user.IDValue,
            TIN: user.TIN,
            Email: user.Email,
            fullName: user.FullName,
            lastLoginTime: new Date(),
            isActive: true
          };

          // Update active session tracking
          updateActiveSession(user.Username, req);

          // Try to get token from LHDN
          let tokenData = null;
          try {
            tokenData = await getTokenSession();

            // Store token separately in session
            if (tokenData && tokenData.access_token) {
              req.session.accessToken = tokenData.access_token;
              req.session.tokenExpiryTime = Date.now() + (tokenData.expires_in * 1000);
            }
          } catch (tokenError) {
            console.error('Token acquisition error:', tokenError);
            // Log the token error but continue with login
            await LoggingService.log({
              description: `Token acquisition failed for user: ${user.Username}`,
              username: user.Username,
              userId: user.ID,
              ipAddress: clientIP,
              logType: LOG_TYPES.WARNING,
              module: MODULES.AUTH,
              action: ACTIONS.TOKEN_ACQUISITION,
              status: STATUS.FAILED,
              details: {
                error: tokenError.message,
                stack: tokenError.stack
              }
            });
          }

          // Log the login with reconnect info if applicable
          await LoggingService.log({
            description: reconnect === 'true' ?
              `User reconnected to existing session: ${user.Username}` :
              `User logged in: ${user.Username}`,
            username: user.Username,
            userId: user.ID,
            ipAddress: clientIP,
            logType: LOG_TYPES.INFO,
            module: MODULES.AUTH,
            action: reconnect === 'true' ? ACTIONS.SESSION_EXTENDED : ACTIONS.LOGIN,
            status: STATUS.SUCCESS,
            details: {
              reconnect: !!reconnect,
              forceNewSession: reconnect === 'force',
              userAgent: req.headers['user-agent'],
              tokenAcquired: !!tokenData
            }
          });

          // Check if this is an API request or form submission
          const isApiRequest = req.headers['accept'] && req.headers['accept'].includes('application/json');
          if (isApiRequest) {
            return res.json({
              success: true,
              message: 'Login successful',
              redirectUrl: '/dashboard',
              accessToken: tokenData?.access_token,
              user: {
                id: user.ID,
                username: user.Username,
                admin: user.Admin === 1,
                fullName: user.FullName,
                email: user.Email
              }
            });
          } else {
            // Form submission - redirect to dashboard
            return res.redirect('/dashboard');
          }
        } catch (error) {
          console.error('Login session setup error:', error);

          // Check if this is an API request or form submission
          const isApiRequest = req.headers['accept'] && req.headers['accept'].includes('application/json');
          if (isApiRequest) {
            return res.status(500).json({
              success: false,
              message: 'Login failed due to session setup error'
            });
          } else {
            // Form submission - redirect to login with error
            return res.redirect('/login?error=session-error');
          }
        }
      });
    })(req, res, next);

  } catch (error) {
    console.error('Login error:', error);

    // Log the error
    await LoggingService.log({
      description: `Login error for user: ${username}`,
      username: username,
      ipAddress: clientIP,
      logType: LOG_TYPES.ERROR,
      module: MODULES.AUTH,
      action: ACTIONS.LOGIN,
      status: STATUS.FAILED,
      details: {
        error: error.message,
        stack: error.stack
      }
    });

    next(error);
  }
});

// Registration page route (HTML)
router.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('auth/register', {
    title: 'Register',
    layout: 'auth/auth.layout'
  });
});

router.post('/register', async (req, res) => {
  const { username, password, email, tin, idType, idValue } = req.body;

  try {
    // Check if username already exists
    const existingUser = await prisma.wP_USER_REGISTRATION.findFirst({
      where: { Username: username }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Username already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = await prisma.wP_USER_REGISTRATION.create({
      data: {
        Username: username,
        Password: hashedPassword,
        Email: email,
        TIN: tin,
        IDType: idType,
        IDValue: idValue,
        Admin: 0, // Default to non-admin
        ValidStatus: '1', // Set as active
        CreateTS: new Date(),
        LastLoginTime: null
      }
    });

    // Log registration event
    await logAuthEvent('successfulLogins', {
      username,
      description: `New user registration: ${username}`,
      status: 'Success',
      action: 'REGISTER',
      userId: newUser.ID
    }, req);

    return res.json({
      success: true,
      message: 'Registration successful'
    });

  } catch (error) {
    console.error('Registration error:', error);
    await logAuthEvent('errors', {
      username,
      description: 'Registration error',
      error: error.message,
      stack: error.stack
    }, req);

    return res.status(500).json({
      success: false,
      message: 'An error occurred during registration'
    });
  }
});

// Enhanced logout endpoint - supports both GET and POST
const handleLogout = async (req, res) => {
  const username = req.session?.user?.username;
  const userId = req.session?.user?.id;

  if (req.session) {
    try {
      if (username) {
        // Update user's last activity time to null on logout
        await updateUserActivity(userId, false);

        // Remove from active sessions
        removeActiveSession(username || req.session.user.username);

        // Log the logout
        await LoggingService.log({
          description: 'User logged out',
          username: req.session.user.username,
          userId: req.session.user.id,
          ipAddress: req.ip,
          logType: LOG_TYPES.INFO,
          action: ACTIONS.LOGOUT,
          status: STATUS.SUCCESS
        });

        await logAuthEvent('logouts', {
          username,
          userId,
          description: `User ${username} signed out successfully`,
          status: 'Success',
          action: 'LOGOUT',
          sessionDuration: req.session.user?.lastLoginTime ?
            moment().diff(moment(req.session.user.lastLoginTime), 'seconds') : null
        }, req);
      }

      // Clear the session cookie first
      res.clearCookie('connect.sid');

      // Then destroy the session
      req.session.destroy(err => {
        if (err) {
          console.error('Session destruction error:', err);
          logAuthEvent('errors', {
            username,
            description: `Logout error for user ${username}`,
            error: err.message
          }, req);
          return res.status(500).json({
            success: false,
            message: 'Failed to logout'
          });
        }

        // Check if this is an AJAX request
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.json({
            success: true,
            message: 'Logged out successfully',
            redirectUrl: '/auth/login'
          });
        } else {
          // For regular requests, redirect to login page
          res.redirect('/auth/login');
        }
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'An error occurred during logout'
      });
    }
  } else {
    res.clearCookie('connect.sid');
    res.redirect('/auth/login');
  }
};

// Register both GET and POST routes for logout
router.get('/logout', handleLogout);
router.post('/logout', handleLogout);

// Add a catch-all route for /auth/* to handle 404s
router.use((req, res) => {
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    res.status(404).json({ success: false, message: 'Auth endpoint not found' });
  } else {
    res.redirect('/auth/login');
  }
});

module.exports = router;