const winston = require('winston');
const path = require('path');
const prisma = require('../src/lib/prisma');

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/error.log'),
      level: 'error'
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/combined.log')
    })
  ]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

/**
 * Get client IP address from request
 * @param {Object} req - Express request object
 * @returns {string} IP address
 */
function getClientIP(req) {
  return req.ip ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         req.headers['x-forwarded-for']?.split(',')[0] ||
         'Unknown';
}

/**
 * Determine module name from action description
 * @param {string} description - Action description
 * @returns {string} Module name
 */
function getModuleName(description) {
  const desc = description.toLowerCase();
  if (desc.includes('login') || desc.includes('logout') || desc.includes('password')) return 'Authentication';
  if (desc.includes('invoice')) return 'Invoice';
  if (desc.includes('user') || desc.includes('profile')) return 'User Management';
  if (desc.includes('config') || desc.includes('setting')) return 'Configuration';
  if (desc.includes('sap')) return 'SAP Integration';
  if (desc.includes('lhdn')) return 'LHDN Integration';
  return 'System';
}

/**
 * Determine action type from description
 * @param {string} description - Action description
 * @returns {string} Action type
 */
function getActionType(description) {
  const desc = description.toLowerCase();
  if (desc.includes('login')) return 'LOGIN';
  if (desc.includes('logout')) return 'LOGOUT';
  if (desc.includes('create')) return 'CREATE';
  if (desc.includes('update')) return 'UPDATE';
  if (desc.includes('delete')) return 'DELETE';
  if (desc.includes('view')) return 'VIEW';
  if (desc.includes('download')) return 'DOWNLOAD';
  if (desc.includes('upload')) return 'UPLOAD';
  if (desc.includes('error') || desc.includes('failed')) return 'ERROR';
  return 'INFO';
}

/**
 * Determine status from description and any error
 * @param {string} description - Action description
 * @param {Error} error - Optional error object
 * @returns {string} Status
 */
function getStatus(description, error = null) {
  if (error) return 'Failed';
  const desc = description.toLowerCase();
  if (desc.includes('error') || desc.includes('failed') || desc.includes('invalid')) return 'Failed';
  if (desc.includes('success') || desc.includes('completed')) return 'Success';
  return 'Info';
}

/**
 * Log database operations to WP_LOGS table
 * @param {Object} models - Database models (not used with Prisma)
 * @param {Object} req - Express request object
 * @param {string} description - Description of the operation
 * @param {Object} options - Additional options
 */
async function logDBOperation(models, req, description, options = {}) {
  try {
    // Log to console in all cases
    console.log('DB Logging:', {
      description,
      ...options,
      timestamp: new Date().toISOString()
    });

    // Create log entry using Prisma
    const logEntry = {
      Description: description,
      CreateTS: new Date(), // Use JavaScript Date object instead of sequelize.literal
      LoggedUser: req?.session?.user?.username || 'System',
      IPAddress: req?.ip || null,
      LogType: options.status === 'FAILED' ? 'ERROR' : 'INFO',
      Module: options.module || 'SYSTEM',
      Action: options.action || 'GENERAL',
      Status: options.status || 'SUCCESS',
      UserID: req?.session?.user?.id || null
    };

    await prisma.wP_LOGS.create({
      data: logEntry
    });

  } catch (error) {
    console.error('Failed to log operation', {
      description,
      error: error.message,
      ...options,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Create middleware to log HTTP requests
 * @returns {Function} Express middleware
 */
function createRequestLogger() {
  return async (req, res, next) => {
    const startTime = Date.now();

    // Log after response is sent
    res.on('finish', async () => {
      const duration = Date.now() - startTime;
      const description = `${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`;

      await logDBOperation(null, req, description, {
        module: 'HTTP',
        action: req.method,
        duration,
        statusCode: res.statusCode
      });
    });

    next();
  };
}

module.exports = {
  logger,
  logDBOperation,
  createRequestLogger
};