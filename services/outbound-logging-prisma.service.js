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

// Actions
const ACTIONS = {
  FILE_PROCESSED: 'FILE_PROCESSED',
  FILE_SUBMITTED: 'FILE_SUBMITTED',
  FILE_DELETED: 'FILE_DELETED',
  FILE_CANCELLED: 'FILE_CANCELLED',
  FILE_REJECTED: 'FILE_REJECTED',
  FILE_APPROVED: 'FILE_APPROVED',
  FILE_DOWNLOADED: 'FILE_DOWNLOADED',
  FILE_UPLOADED: 'FILE_UPLOADED',
  FILE_MAPPED: 'FILE_MAPPED',
  FILE_VALIDATED: 'FILE_VALIDATED',
  API_CALL: 'API_CALL',
  DATABASE_OPERATION: 'DATABASE_OPERATION',
  SYSTEM_EVENT: 'SYSTEM_EVENT',
  SECURITY_EVENT: 'SECURITY_EVENT'
};

// Statuses
const STATUSES = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
  APPROVED: 'APPROVED'
};

class OutboundLoggingService {
  static async log({
    description,
    username = 'System',
    userId = null,
    ipAddress = null,
    logType = LOG_TYPES.INFO,
    module = MODULES.OUTBOUND,
    action = ACTIONS.SYSTEM_EVENT,
    status = STATUSES.SUCCESS,
    details = null,
    fileId = null,
    submissionId = null
  }) {
    try {
      // Format current date/time for SQL Server
      const now = new Date();
      const formattedDate = now.toISOString();

      const logEntry = await prisma.wP_LOGS.create({
        data: {
          Description: description,
          CreateTS: formattedDate,
          LoggedUser: username,
          IPAddress: ipAddress,
          LogType: logType,
          Module: module,
          Action: action,
          Status: status,
          UserID: userId
        }
      });

      // Also log to console and file for debugging
      const logMessage = `[${logType}] [${module}] [${action}] [${status}] ${description}`;

      if (logType === LOG_TYPES.ERROR) {
        console.error(logMessage, details ? JSON.stringify(details) : '');
        logger.error(logMessage, details);
      } else if (logType === LOG_TYPES.WARNING) {
        console.warn(logMessage, details ? JSON.stringify(details) : '');
        logger.warn(logMessage, details);
      } else {
        console.log(logMessage, details ? JSON.stringify(details) : '');
        logger.info(logMessage, details);
      }

      return logEntry;
    } catch (error) {
      console.error('Error creating outbound log entry:', error);
      // Log to file as fallback
      logger.error(`Failed to create DB log: ${description}`, { error: error.message, details });
      return null;
    }
  }

  static async updateOutboundStatus({
    filePath,
    status,
    submissionId = null,
    submittedBy = null,
    cancelledBy = null,
    cancellationReason = null
  }) {
    try {
      if (!filePath) {
        throw new Error('File path is required to update outbound status');
      }

      const updateData = { status };

      if (submissionId) {
        updateData.submissionUid = submissionId;
      }

      if (status === 'Submitted' && submittedBy) {
        updateData.submitted_by = submittedBy;
        updateData.date_submitted = new Date();
      }

      if (status === 'Cancelled' && cancelledBy) {
        updateData.cancelled_by = cancelledBy;
        updateData.cancellation_reason = cancellationReason || 'No reason provided';
        updateData.date_cancelled = new Date();
      }

      if (status === 'Synced') {
        updateData.date_sync = new Date();
      }

      // Always update the updated_at timestamp
      updateData.updated_at = new Date();

      const result = await prisma.wP_OUTBOUND_STATUS.update({
        where: { filePath },
        data: updateData
      });

      return result;
    } catch (error) {
      console.error('Error updating outbound status:', error);
      throw error;
    }
  }

  static async getOutboundLogs(fileId) {
    try {
      // Get logs related to this file - note that we can't filter by Details since it's not in the schema
      const logs = await prisma.wP_LOGS.findMany({
        where: {
          Description: {
            contains: fileId
          }
        },
        orderBy: {
          CreateTS: 'desc'
        }
      });

      return logs;
    } catch (error) {
      console.error('Error getting outbound logs:', error);
      return [];
    }
  }

  static async logSubmissionStart(req, data) {
    const username = req.session?.user?.username || 'System';
    const userId = req.session?.user?.id;
    const ipAddress = req.ip;
    const { fileName, type, company, date } = data;

    return this.log({
      description: `Started submission process for ${fileName}`,
      username,
      userId,
      ipAddress,
      logType: LOG_TYPES.INFO,
      module: MODULES.SUBMISSION,
      action: ACTIONS.FILE_SUBMITTED,
      status: STATUSES.IN_PROGRESS,
      details: data
    });
  }

  static async logSubmissionSuccess(req, result, data) {
    const username = req.session?.user?.username || 'System';
    const userId = req.session?.user?.id;
    const ipAddress = req.ip;
    const { fileName, invoiceNumber } = data;

    return this.log({
      description: `Successfully submitted ${fileName} (Invoice: ${invoiceNumber})`,
      username,
      userId,
      ipAddress,
      logType: LOG_TYPES.INFO,
      module: MODULES.SUBMISSION,
      action: ACTIONS.FILE_SUBMITTED,
      status: STATUSES.SUCCESS,
      details: data
    });
  }

  static async logSubmissionFailure(req, error, data) {
    const username = req.session?.user?.username || 'System';
    const userId = req.session?.user?.id;
    const ipAddress = req.ip;
    const { fileName, invoiceNumber } = data;

    return this.log({
      description: `Failed to submit ${fileName} (Invoice: ${invoiceNumber}): ${error.message}`,
      username,
      userId,
      ipAddress,
      logType: LOG_TYPES.ERROR,
      module: MODULES.SUBMISSION,
      action: ACTIONS.FILE_SUBMITTED,
      status: STATUSES.FAILED,
      details: {
        ...data,
        error: error.message,
        stack: error.stack
      }
    });
  }

  static async logStatusUpdate(req, statusData) {
    const username = req.session?.user?.username || 'System';
    const userId = req.session?.user?.id;
    const ipAddress = req.ip;
    const { fileName, status, invoice_number } = statusData;

    return this.log({
      description: `Updated status for ${fileName} (Invoice: ${invoice_number}) to ${status}`,
      username,
      userId,
      ipAddress,
      logType: LOG_TYPES.INFO,
      module: MODULES.OUTBOUND,
      action: ACTIONS.FILE_PROCESSED,
      status: STATUSES.SUCCESS,
      details: statusData
    });
  }

  static async createLog(logData) {
    return this.log(logData);
  }
}

module.exports = {
  OutboundLoggingService,
  LOG_TYPES,
  MODULES,
  ACTIONS,
  STATUSES
};
