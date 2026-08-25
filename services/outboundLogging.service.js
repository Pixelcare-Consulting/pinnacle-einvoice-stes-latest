/**
 * Outbound Logging Service
 *
 * A dedicated service for logging outbound file submissions to LHDN.
 * This service provides comprehensive logging for all stages of the submission process.
 *
 * Features:
 * - Detailed logging of all submission stages
 * - Error tracking and reporting
 * - Status change tracking
 * - Performance metrics
 * - Audit trail for compliance
 */

const { WP_LOGS, WP_OUTBOUND_STATUS, sequelize } = require('../models');
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
   * Create a log entry in the database
   *
   * @param {Object} options - Logging options
   * @param {string} options.description - Log description
   * @param {string} options.loggedUser - Username of the logged user
   * @param {string} options.ipAddress - IP address of the request
   * @param {string} options.logType - Type of log (INFO, WARNING, ERROR, SUCCESS)
   * @param {string} options.module - Module generating the log
   * @param {string} options.action - Action being performed
   * @param {string} options.status - Status of the action
   * @param {number} options.userId - User ID
   * @param {Object} options.details - Additional details to log
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
      // Create log entry in database
      const logEntry = await WP_LOGS.create({
        Description: description,
        CreateTS: sequelize.literal('GETDATE()'),
        LoggedUser: loggedUser,
        IPAddress: ipAddress,
        LogType: logType,
        Module: module,
        Action: action,
        Status: status,
        UserID: userId
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

      // Don't throw - we don't want logging failures to break the application
      return null;
    }
  }

  /**
   * Log the start of the submission process
   *
   * @param {Object} req - Express request object
   * @param {Object} fileInfo - Information about the file being submitted
   * @returns {Promise<Object>} - Created log entry
   */
  static async logSubmissionStart(req, fileInfo) {
    const user = req.session?.user || {};
    return this.createLog({
      description: `Starting submission process for file: ${fileInfo.fileName}`,
      loggedUser: user.username || 'System',
      ipAddress: req.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.SUBMISSION,
      action: ACTIONS.SUBMIT,
      status: STATUSES.PENDING,
      userId: user.id,
      details: {
        fileName: fileInfo.fileName,
        company: fileInfo.company,
        type: fileInfo.type,
        date: fileInfo.date
      }
    });
  }

  /**
   * Log the successful submission to LHDN
   *
   * @param {Object} req - Express request object
   * @param {Object} submissionResult - Result from LHDN submission
   * @param {Object} fileInfo - Information about the submitted file
   * @returns {Promise<Object>} - Created log entry
   */
  static async logSubmissionSuccess(req, submissionResult, fileInfo) {
    const user = req.session?.user || {};
    return this.createLog({
      description: `Successfully submitted file to LHDN: ${fileInfo.fileName}, UUID: ${submissionResult.data?.acceptedDocuments?.[0]?.uuid || 'N/A'}`,
      loggedUser: user.username || 'System',
      ipAddress: req.ip,
      logType: LOG_TYPES.SUCCESS,
      module: MODULES.LHDN,
      action: ACTIONS.SUBMIT,
      status: STATUSES.SUCCESS,
      userId: user.id,
      details: {
        fileName: fileInfo.fileName,
        submissionUid: submissionResult.data?.submissionUid,
        uuid: submissionResult.data?.acceptedDocuments?.[0]?.uuid,
        invoiceNumber: fileInfo.invoiceNumber
      }
    });
  }

  /**
   * Log a submission failure
   *
   * @param {Object} req - Express request object
   * @param {Error} error - Error that occurred
   * @param {Object} fileInfo - Information about the file
   * @returns {Promise<Object>} - Created log entry
   */
  static async logSubmissionFailure(req, error, fileInfo) {
    const user = req.session?.user || {};
    return this.createLog({
      description: `Failed to submit file to LHDN: ${fileInfo.fileName} - ${error.message}`,
      loggedUser: user.username || 'System',
      ipAddress: req.ip,
      logType: LOG_TYPES.ERROR,
      module: MODULES.LHDN,
      action: ACTIONS.SUBMIT,
      status: STATUSES.FAILED,
      userId: user.id,
      details: {
        fileName: fileInfo.fileName,
        error: error.message,
        stack: error.stack,
        invoiceNumber: fileInfo.invoiceNumber
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
    const user = req.session?.user || {};
    return this.createLog({
      description: `Updated submission status to ${statusData.status} for ${statusData.fileName || statusData.invoice_number}`,
      loggedUser: user?.username || 'System',
      ipAddress: req?.ip,
      logType: LOG_TYPES.INFO,
      module: MODULES.OUTBOUND,
      action: ACTIONS.STATUS_UPDATE,
      status: STATUSES.SUCCESS,
      userId: user?.id,
      details: statusData
    });
  }

  /**
   * Log performance metrics for a submission
   *
   * @param {Object} req - Express request object
   * @param {Object} metrics - Performance metrics
   * @param {number} metrics.processingTime - Time taken to process the submission in ms
   * @param {number} metrics.fileSize - Size of the file in bytes
   * @param {Object} fileInfo - Information about the file
   * @returns {Promise<Object>} - Created log entry
   */
  static async logPerformanceMetrics(req, metrics, fileInfo) {
    const user = req.session?.user || {};
    return this.createLog({
      description: `Performance metrics for ${fileInfo.fileName}: Processing time ${metrics.processingTime}ms, File size ${metrics.fileSize} bytes`,
      loggedUser: user.username || 'System',
      ipAddress: req.ip,
      logType: LOG_TYPES.PERFORMANCE,
      module: MODULES.OUTBOUND,
      action: ACTIONS.SUBMIT,
      status: STATUSES.SUCCESS,
      userId: user.id,
      details: {
        ...metrics,
        fileName: fileInfo.fileName,
        company: fileInfo.company,
        type: fileInfo.type
      }
    });
  }

  /**
   * Log security event
   *
   * @param {Object} req - Express request object
   * @param {string} eventDescription - Security event description
   * @param {string} severity - Severity of the event (high, medium, low)
   * @returns {Promise<Object>} - Created log entry
   */
  static async logSecurityEvent(req, eventDescription, severity = 'low') {
    const user = req.session?.user || {};
    return this.createLog({
      description: `Security event: ${eventDescription}`,
      loggedUser: user.username || 'System',
      ipAddress: req.ip,
      logType: LOG_TYPES.SECURITY,
      module: MODULES.SECURITY,
      action: ACTIONS.SUBMIT,
      status: STATUSES.SUCCESS,
      userId: user.id,
      details: {
        eventDescription,
        severity,
        userAgent: req.headers['user-agent'],
        method: req.method,
        url: req.originalUrl
      }
    });
  }

  /**
   * Log audit event for compliance
   *
   * @param {Object} req - Express request object
   * @param {string} action - Action being audited
   * @param {Object} data - Data related to the audit
   * @returns {Promise<Object>} - Created log entry
   */
  static async logAuditEvent(req, action, data) {
    const user = req.session?.user || {};
    const auditId = uuidv4();

    return this.createLog({
      description: `Audit: ${action}`,
      loggedUser: user.username || 'System',
      ipAddress: req.ip,
      logType: LOG_TYPES.AUDIT,
      module: MODULES.OUTBOUND,
      action,
      status: STATUSES.SUCCESS,
      userId: user.id,
      details: {
        auditId,
        timestamp: new Date().toISOString(),
        data,
        environment: process.env.NODE_ENV || 'development',
        hostname: os.hostname()
      }
    });
  }

  /**
   * Get logs for a specific file
   *
   * @param {string} fileName - Name of the file
   * @param {number} limit - Maximum number of logs to return
   * @returns {Promise<Array>} - Array of log entries
   */
  static async getLogsForFile(fileName, limit = 100) {
    try {
      const logs = await WP_LOGS.findAll({
        where: {
          Description: {
            [sequelize.Op.like]: `%${fileName}%`
          }
        },
        order: [['CreateTS', 'DESC']],
        limit,
        raw: true
      });

      return logs;
    } catch (error) {
      console.error('Failed to get logs for file:', error);
      return [];
    }
  }

  /**
   * Export logs to CSV
   *
   * @param {Object} filters - Filters to apply
   * @param {string} outputPath - Path to save the CSV file
   * @returns {Promise<string>} - Path to the exported file
   */
  static async exportLogsToCSV(filters = {}, outputPath) {
    try {
      // Build where clause based on filters
      const whereClause = {};

      if (filters.module) {
        whereClause.Module = filters.module;
      }

      if (filters.action) {
        whereClause.Action = filters.action;
      }

      if (filters.status) {
        whereClause.Status = filters.status;
      }

      if (filters.logType) {
        whereClause.LogType = filters.logType;
      }

      if (filters.startDate && filters.endDate) {
        whereClause.CreateTS = {
          [sequelize.Op.between]: [
            new Date(filters.startDate),
            new Date(filters.endDate)
          ]
        };
      }

      // Get logs
      const logs = await WP_LOGS.findAll({
        where: whereClause,
        order: [['CreateTS', 'DESC']],
        raw: true
      });

      if (logs.length === 0) {
        return null;
      }

      // Generate CSV content
      const header = 'Timestamp,Description,User,IP Address,Type,Module,Action,Status\n';
      const rows = logs.map(log => {
        return [
          log.CreateTS,
          `"${log.Description.replace(/"/g, '""')}"`,
          log.LoggedUser,
          log.IPAddress || '',
          log.LogType,
          log.Module,
          log.Action,
          log.Status
        ].join(',');
      }).join('\n');

      const csvContent = header + rows;

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Write to file
      fs.writeFileSync(outputPath, csvContent, 'utf8');

      return outputPath;
    } catch (error) {
      console.error('Failed to export logs to CSV:', error);
      return null;
    }
  }
}

module.exports = {
  OutboundLoggingService,
  LOG_TYPES,
  MODULES,
  ACTIONS,
  STATUSES
};
