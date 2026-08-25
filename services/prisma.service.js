/**
 * Prisma Service - Provides a consistent API for accessing data
 * This service abstracts away the ORM details and provides a consistent interface
 * that can be used throughout the application.
 */

const prisma = require('../src/lib/prisma');

/**
 * User Service - Handles user-related operations
 */
const UserService = {
  /**
   * Find a user by ID
   * @param {number} id - User ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - User object
   */
  findById: async (id, options = {}) => {
    return prisma.wP_USER_REGISTRATION.findUnique({
      where: { ID: id },
      ...options
    });
  },

  /**
   * Find a user by username or email
   * @param {string} usernameOrEmail - Username or email
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - User object
   */
  findByUsernameOrEmail: async (usernameOrEmail, options = {}) => {
    return prisma.wP_USER_REGISTRATION.findFirst({
      where: {
        OR: [
          { Username: usernameOrEmail },
          { Email: usernameOrEmail }
        ]
      },
      ...options
    });
  },

  /**
   * Create a new user
   * @param {Object} userData - User data
   * @returns {Promise<Object>} - Created user
   */
  create: async (userData) => {
    return prisma.wP_USER_REGISTRATION.create({
      data: userData
    });
  },

  /**
   * Update a user
   * @param {number} id - User ID
   * @param {Object} userData - User data to update
   * @returns {Promise<Object>} - Updated user
   */
  update: async (id, userData) => {
    return prisma.wP_USER_REGISTRATION.update({
      where: { ID: id },
      data: userData
    });
  },

  /**
   * Delete a user
   * @param {number} id - User ID
   * @returns {Promise<Object>} - Deleted user
   */
  delete: async (id) => {
    return prisma.wP_USER_REGISTRATION.delete({
      where: { ID: id }
    });
  }
};

/**
 * Log Service - Handles log-related operations
 */
const LogService = {
  /**
   * Create a new log entry
   * @param {Object} logData - Log data
   * @returns {Promise<Object>} - Created log
   */
  create: async (logData) => {
    return prisma.wP_LOGS.create({
      data: logData
    });
  },

  /**
   * Find logs by user ID
   * @param {number} userId - User ID
   * @param {Object} options - Additional options
   * @returns {Promise<Array>} - Array of logs
   */
  findByUserId: async (userId, options = {}) => {
    return prisma.wP_LOGS.findMany({
      where: { UserID: userId },
      orderBy: { ID: 'desc' },
      ...options
    });
  }
};

/**
 * Admin Settings Service - Handles admin settings operations
 */
const AdminSettingsService = {
  /**
   * Get a setting by key
   * @param {string} key - Setting key
   * @returns {Promise<Object>} - Setting object
   */
  getSetting: async (key) => {
    const setting = await prisma.wP_ADMIN_SETTINGS.findFirst({
      where: {
        SettingKey: key,
        IsActive: true
      }
    });
    return setting ? setting.SettingValue : null;
  },

  /**
   * Update or create a setting
   * @param {string} key - Setting key
   * @param {string} value - Setting value
   * @param {string} group - Setting group
   * @param {string} description - Setting description
   * @param {string} username - Username of the user making the change
   * @returns {Promise<Object>} - Updated or created setting
   */
  upsertSetting: async (key, value, group, description, username) => {
    return prisma.wP_ADMIN_SETTINGS.upsert({
      where: { SettingKey: key },
      update: {
        SettingValue: value,
        SettingGroup: group,
        Description: description,
        UpdatedBy: username,
        UpdateTS: new Date()
      },
      create: {
        SettingKey: key,
        SettingValue: value,
        SettingGroup: group,
        Description: description,
        IsActive: true,
        CreatedBy: username,
        UpdatedBy: username,
        CreateTS: new Date(),
        UpdateTS: new Date()
      }
    });
  }
};

/**
 * Company Settings Service - Handles company settings operations
 */
const CompanySettingsService = {
  /**
   * Get company settings by user ID
   * @param {number} userId - User ID
   * @returns {Promise<Object>} - Company settings
   */
  getByUserId: async (userId) => {
    return prisma.wP_COMPANY_SETTINGS.findFirst({
      where: { UserID: userId.toString() }
    });
  },

  /**
   * Update or create company settings
   * @param {Object} data - Company settings data
   * @returns {Promise<Object>} - Updated or created company settings
   */
  upsert: async (data) => {
    if (data.ID) {
      return prisma.wP_COMPANY_SETTINGS.update({
        where: { ID: data.ID },
        data
      });
    } else {
      return prisma.wP_COMPANY_SETTINGS.create({
        data
      });
    }
  }
};

module.exports = {
  prisma,
  UserService,
  LogService,
  AdminSettingsService,
  CompanySettingsService
};
