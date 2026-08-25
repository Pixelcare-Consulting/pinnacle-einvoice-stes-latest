const { WP_LOGS } = require('../models');
const { sequelize } = require('../models');

// Log types
const LOG_TYPES = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG'
};

// Modules
const MODULES = {
  AUTH: 'Authentication',
  USER: 'User Management',
  COMPANY: 'Company Management',
  INVOICE: 'Invoice Management',
  SETTINGS: 'Settings',
  SYSTEM: 'System',
  AUDIT: 'Audit Trail',
  API: 'API'
};

// Actions
const ACTIONS = {
  CREATE: 'CREATE',
  READ: 'READ',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  FAILED_LOGIN: 'FAILED_LOGIN',
  EXPORT: 'EXPORT',
  IMPORT: 'IMPORT',
  UPLOAD: 'UPLOAD',
  DOWNLOAD: 'DOWNLOAD',
  VALIDATE: 'VALIDATE',
  SUBMIT: 'SUBMIT',
  // Session management actions
  SESSION_EXTENDED: 'SESSION_EXTENDED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_TIMEOUT: 'SESSION_TIMEOUT',
  SESSION_REMOVED: 'SESSION_REMOVED',
  SESSION_CHECK: 'SESSION_CHECK',
  // Document actions
  DOCUMENT_SUBMITTED: 'DOCUMENT_SUBMITTED',
  DOCUMENT_APPROVED: 'DOCUMENT_APPROVED',
  DOCUMENT_REJECTED: 'DOCUMENT_REJECTED',
  DOCUMENT_VIEWED: 'DOCUMENT_VIEWED',
  // User actions
  VIEW: 'VIEW',
  PROFILE_UPDATE: 'PROFILE_UPDATE',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  SETTINGS_CHANGE: 'SETTINGS_CHANGE',
  // Token actions
  TOKEN_ACQUISITION: 'TOKEN_ACQUISITION',
  TOKEN_REFRESH: 'TOKEN_REFRESH',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED'
};

// Status
const STATUS = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  PENDING: 'PENDING'
};

class LoggingService {
  static async log({
    description,
    username = 'System',
    userId = null,
    ipAddress = null,
    logType = LOG_TYPES.INFO,
    module = MODULES.SYSTEM,
    action = ACTIONS.CREATE,
    status = STATUS.SUCCESS,
    details = null
  }) {
    try {
      const logEntry = await WP_LOGS.create({
        Description: description,
        CreateTS: sequelize.literal("CONVERT(datetime, GETDATE(), 120)"),
        LoggedUser: username,
        IPAddress: ipAddress,
        LogType: logType,
        Module: module,
        Action: action,
        Status: status,
        UserID: userId,
        Details: details ? JSON.stringify(details) : null
      });

      return logEntry;
    } catch (error) {
      console.error('Error creating log entry:', error);
      // Don't throw - we don't want logging failures to break the application
      return null;
    }
  }

  static async getAuditLogs({
    page = 1,
    limit = 10,
    startDate = null,
    endDate = null,
    username = null,
    module = null,
    action = null,
    status = null
  }) {
    try {
      const whereClause = {};

      if (startDate && endDate) {
        whereClause.CreateTS = {
          [sequelize.Op.between]: [startDate, endDate]
        };
      }

      if (username) {
        whereClause.LoggedUser = username;
      }

      if (module) {
        whereClause.Module = module;
      }

      if (action) {
        whereClause.Action = action;
      }

      if (status) {
        whereClause.Status = status;
      }

      const offset = (page - 1) * limit;

      const { count, rows } = await WP_LOGS.findAndCountAll({
        where: whereClause,
        order: [['CreateTS', 'DESC']],
        limit,
        offset
      });

      return {
        logs: rows,
        total: count,
        totalPages: Math.ceil(count / limit),
        currentPage: page
      };
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      throw error;
    }
  }

  static async exportAuditLogs({
    startDate = null,
    endDate = null,
    username = null,
    module = null,
    action = null,
    status = null
  }) {
    try {
      const whereClause = {};

      if (startDate && endDate) {
        whereClause.CreateTS = {
          [sequelize.Op.between]: [startDate, endDate]
        };
      }

      if (username) {
        whereClause.LoggedUser = username;
      }

      if (module) {
        whereClause.Module = module;
      }

      if (action) {
        whereClause.Action = action;
      }

      if (status) {
        whereClause.Status = status;
      }

      const logs = await WP_LOGS.findAll({
        where: whereClause,
        order: [['CreateTS', 'DESC']]
      });

      return logs;
    } catch (error) {
      console.error('Error exporting audit logs:', error);
      throw error;
    }
  }
}

module.exports = {
  LoggingService,
  LOG_TYPES,
  MODULES,
  ACTIONS,
  STATUS
};