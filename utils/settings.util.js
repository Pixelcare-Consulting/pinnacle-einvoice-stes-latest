const AdminSettingsService = require('../services/adminSettings.service');

class SettingsUtil {
  static cache = new Map();
  static cacheExpiry = new Map();
  static cacheDuration = 5 * 60 * 1000; // 5 minutes

  /**
   * Get a setting value with caching
   * @param {string} key - The setting key
   * @param {*} defaultValue - Default value if setting not found
   * @returns {Promise<*>} The setting value
   */
  static async getSetting(key, defaultValue = null) {
    // Check cache first
    if (this.cache.has(key)) {
      const expiry = this.cacheExpiry.get(key);
      if (expiry > Date.now()) {
        return this.cache.get(key);
      }
      // Cache expired, remove it
      this.cache.delete(key);
      this.cacheExpiry.delete(key);
    }

    // Get from database
    const value = await AdminSettingsService.getSetting(key);
    
    // Cache the result
    if (value !== null) {
      this.cache.set(key, value);
      this.cacheExpiry.set(key, Date.now() + this.cacheDuration);
    }

    return value !== null ? value : defaultValue;
  }

  /**
   * Get all settings for a group with caching
   * @param {string} group - The settings group
   * @returns {Promise<Object>} The settings object
   */
  static async getGroupSettings(group) {
    const cacheKey = `group_${group}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      const expiry = this.cacheExpiry.get(cacheKey);
      if (expiry > Date.now()) {
        return this.cache.get(cacheKey);
      }
      // Cache expired, remove it
      this.cache.delete(cacheKey);
      this.cacheExpiry.delete(cacheKey);
    }

    // Get from database
    const settings = await AdminSettingsService.getSettingsByGroup(group);
    
    // Cache the result
    this.cache.set(cacheKey, settings);
    this.cacheExpiry.set(cacheKey, Date.now() + this.cacheDuration);

    return settings;
  }

  /**
   * Clear the settings cache
   */
  static clearCache() {
    this.cache.clear();
    this.cacheExpiry.clear();
  }

  // Convenience methods for common settings
  static async isMaintenanceMode() {
    return await this.getSetting('portal.maintenance_mode', false);
  }

  static async getMaxFileSize() {
    return await this.getSetting('portal.max_file_size', 10485760);
  }

  static async getAllowedFileTypes() {
    return await this.getSetting('portal.allowed_file_types', ['.pdf', '.jpg', '.png']);
  }

  static async getMaxLoginAttempts() {
    return await this.getSetting('security.max_login_attempts', 5);
  }

  static async getPasswordExpiryDays() {
    return await this.getSetting('security.password_expiry_days', 90);
  }

  static async getSessionTimeout() {
    return await this.getSetting('security.session_timeout', 30);
  }

  static async getEmailSettings() {
    return await this.getGroupSettings('email');
  }

  static async getInvoiceSettings() {
    return await this.getGroupSettings('invoice');
  }

  static async getApiSettings() {
    return await this.getGroupSettings('api');
  }

  static async getNotificationSettings() {
    return await this.getGroupSettings('notifications');
  }

  static async getAuditSettings() {
    return await this.getGroupSettings('audit');
  }

  // Helper method to validate file upload based on settings
  static async validateFileUpload(file) {
    const maxSize = await this.getMaxFileSize();
    const allowedTypes = await this.getAllowedFileTypes();
    
    const errors = [];
    
    if (file.size > maxSize) {
      errors.push(`File size exceeds maximum allowed size of ${maxSize / 1048576}MB`);
    }
    
    const fileExt = '.' + file.originalname.split('.').pop().toLowerCase();
    if (!allowedTypes.includes(fileExt)) {
      errors.push(`File type ${fileExt} is not allowed. Allowed types: ${allowedTypes.join(', ')}`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Helper method to check password requirements
  static async validatePassword(password) {
    const minLength = await this.getSetting('security.min_password_length', 8);
    const requireSpecialChars = await this.getSetting('security.require_special_chars', true);
    
    const errors = [];
    
    if (password.length < minLength) {
      errors.push(`Password must be at least ${minLength} characters long`);
    }
    
    if (requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = SettingsUtil; 