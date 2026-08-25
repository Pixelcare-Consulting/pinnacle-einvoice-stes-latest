module.exports = {
  // Session settings
  session: {
    secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
    timeout: parseInt(process.env.SESSION_TIMEOUT) || 30 * 60 * 1000, // 30 minutes
    cookie: {
      maxAge: parseInt(process.env.COOKIE_MAX_AGE) || 24 * 60 * 60 * 1000, // 24 hours
      secure: process.env.SECURE_COOKIE === 'true',
      httpOnly: true,
      sameSite: 'lax'
    },
    name: 'connect.sid',
    proxy: true,
    rolling: true,
    resave: true,
    saveUninitialized: true
  },

  // Login attempt settings
  login: {
    maxAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 3,
    lockoutDuration: parseInt(process.env.LOGIN_LOCKOUT_DURATION) || 5 * 60 * 1000, // 5 minutes
    cleanupInterval: parseInt(process.env.LOGIN_CLEANUP_INTERVAL) || 60 * 1000 // 1 minute
  },

  // Passport settings
  passport: {
    usernameField: 'username',
    passwordField: 'password',
    sessionFields: [
      'ID', 'Username', 'Email', 'Admin', 'ValidStatus',
      'LastLoginTime', 'TIN', 'IDType', 'IDValue', 'FullName',
    ]
  },

  // Public paths that don't require authentication
  publicPaths: [
    '/auth/login',
    '/auth/register',
    '/auth/logout',
    '/api/user/auth/logout',
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/auth/logout',
    '/assets',
    '/favicon.ico',
    '/public',
    '/uploads',
    '/vendor',
    '/api/health'
  ]
};