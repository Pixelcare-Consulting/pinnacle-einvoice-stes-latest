/**
 * Outbound Logging Service (Prisma Version)
 *
 * A dedicated service for logging outbound file submissions to LHDN.
 * This service provides comprehensive logging for all stages of the submission process.
 */

const prisma = require('../src/lib/prisma');
const { logger } = require('../utils/logger');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

// Log types
const LOG_TYPES = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  SUCCESS: 'SUCCESS',
  DEBUG: 'DEBUG',
  AUDIT: 'AUDIT',
  PERFORMANCE: 'PERFORMANCE',
  SECURITY: 'SECURITY'
};

// Log modules
const MODULES = {
  OUTBOUND: 'OUTBOUND',
  SUBMISSION: 'SUBMISSION',
  LHDN: 'LHDN',
  EXCEL: 'EXCEL',
  API: 'API',
  DATABASE: 'DATABASE',
  SYSTEM: 'SYSTEM',
  SECURITY: 'SECURITY'
};

// Log actions
const ACTIONS = {
  SUBMIT: 'SUBMIT',
  PREPARE: 'PREPARE',
  VALIDATE: 'VALIDATE',
  CANCEL: 'CANCEL',
  STATUS_UPDATE: 'STATUS_UPDATE',
  ERROR: 'ERROR',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  CREATE: 'CREATE',
  READ: 'READ',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  EXPORT: 'EXPORT',
  IMPORT: 'IMPORT'
};

// Log statuses
const STATUSES = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  PENDING: 'PENDING',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
  TIMEOUT: 'TIMEOUT',
  PARTIAL: 'PARTIAL'
};

class OutboundLoggingService {
  /**
   * Create a log entry
   *
   * @param {Object} options - Log options
   * @returns {Promise<Object>} - Created log entry
   */
  static async createLog({
    description,
    loggedUser = 'System',
    ipAddress = null,
    logType = LOG_TYPES.INFO,
    module = MODULES.OUTBOUND,
    action = ACTIONS.SUBMIT,
    status = STATUSES.SUCCESS,
    userId = null,
    details = null
  }) {
    try {
      // Create log entry in database using Prisma
      const logEntry = await prisma.wP_LOGS.create({
        data: {
          Description: description,
          CreateTS: new Date().toISOString(), // Convert Date to ISO string for SQL Server
          LoggedUser: loggedUser,
          IPAddress: ipAddress,
          LogType: logType,
          Module: module,
          Action: action,
          Status: status,
          UserID: userId
        }
      });

      // Also log to file using Winston logger
      logger.log({
        level: logType.toLowerCase(),
        message: description,
        user: loggedUser,
        ip: ipAddress,
        module,
        action,
        status,
        userId,
        details: details ? JSON.stringify(details) : null,
        timestamp: new Date().toISOString()
      });

      // Log to console in development
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[${module}][${action}][${status}] ${description}`);
        if (details) {
          console.log('Details:', details);
        }
      }

      return logEntry;
    } catch (error) {
      // Log the error to console
      console.error('Failed to create log entry:', error);

      // Attempt to write to fallback log file
      try {
        const fallbackLogPath = path.join(__dirname, '../logs/fallback_logs.txt');
        const logMessage = `${new Date().toISOString()} - [${module}][${action}][${status}] ${description} - ERROR: ${error.message}\n`;
        fs.appendFileSync(fallbackLogPath, logMessage);
      } catch (fallbackError) {
        console.error('Failed to write to fallback log:', fallbackError);
      }

      return null;
    }
  }

  /**
   * Get logs for a specific file
   *
   * @param {string} fileName - File name
   * @returns {Promise<Array>} - Array of logs
   */
  static async getLogsForFile(fileName) {
    try {
      const logs = await prisma.wP_LOGS.findMany({
        where: {
          Description: {
            contains: fileName
          }
        },
        orderBy: {
          CreateTS: 'desc'
        }
      });

      return logs;
    } catch (error) {
      console.error('Error fetching logs for file:', error);
      return [];
    }
  }

  /**
   * Log the start of the submission process
   *
   * @param {Object} req - Express request object
   * @param {Object} data - Information about the file being submitted
   * @returns {Promise<Object>} - Created log entry
   */
  static async logSubmissionStart(req, data) {
    const username = req.session?.user?.username || 'System';
    const userId = req.session?.user?.id;
    const ipAddress = req.ip;
    const { fileName, type, company, date } = data;

    return this.createLog({
      description: `Started submission process for ${fileName}`,
      loggedUser: username,
      ipAddress,
      logType: LOG_TYPES.INFO,
      module: MODULES.SUBMISSION,
      action: ACTIONS.SUBMIT,
      status: STATUSES.PENDING,
      userId,
      details: data
    });
  }

  /**
   * Log the successful submission to LHDN
   *
   * @param {Object} req - Express request object
   * @param {Object} result - Result from LHDN submission
   * @param {Object} data - Information about the submitted file
   * @returns {Promise<Object>} - Created log entry
   */
  static async logSubmissionSuccess(req, result, data) {
    const username = req.session?.user?.username || 'System';
    const userId = req.session?.user?.id;
    const ipAddress = req.ip;
    const { fileName, invoiceNumber } = data;

    return this.createLog({
      description: `Successfully submitted ${fileName} (Invoice: ${invoiceNumber})`,
      loggedUser: username,
      ipAddress,
      logType: LOG_TYPES.SUCCESS,
      module: MODULES.SUBMISSION,
      action: ACTIONS.SUBMIT,
      status: STATUSES.SUCCESS,
      userId,
      details: data
    });
  }

  /**
   * Log submission failure
   *
   * @param {Object} req - Express request object
   * @param {Error} error - Error object
   * @param {Object} data - Information about the file
   * @returns {Promise<Object>} - Created log entry
   */
  static async logSubmissionFailure(req, error, data) {
    const username = req.session?.user?.username || 'System';
    const userId = req.session?.user?.id;
    const ipAddress = req.ip;
    const { fileName, invoiceNumber } = data;

    return this.createLog({
      description: `Failed to submit ${fileName} (Invoice: ${invoiceNumber || 'unknown'})`,
      loggedUser: username,
      ipAddress,
      logType: LOG_TYPES.ERROR,
      module: MODULES.SUBMISSION,
      action: ACTIONS.SUBMIT,
      status: STATUSES.FAILED,
      userId,
      details: {
        ...data,
        error: error.message,
        stack: error.stack
      }
    });
  }

  /**
   * Log status update for a submission
   *
   * @param {Object} req - Express request object
   * @param {Object} statusData - Status data
   * @returns {Promise<Object>} - Created log entry
   */
  static async logStatusUpdate(req, statusData) {
    const username = req.session?.user?.username || 'System';
    const userId = req.session?.user?.id;
    const ipAddress = req.ip;
    const { fileName, status, invoice_number } = statusData;

    return this.createLog({
      description: `Updated status for ${fileName} (Invoice: ${invoice_number}) to ${status}`,
      loggedUser: username,
      ipAddress,
      logType: LOG_TYPES.INFO,
      module: MODULES.OUTBOUND,
      action: ACTIONS.STATUS_UPDATE,
      status: STATUSES.SUCCESS,
      userId,
      details: statusData
    });
  }
}

module.exports = {
  OutboundLoggingService,
  LOG_TYPES,
  MODULES,
  ACTIONS,
  STATUSES
};
