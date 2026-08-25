const prisma = require('../src/lib/prisma');

class AdminSettingsService {
  // Cache for settings
  static settingsCache = new Map();
  static cacheTTL = 5 * 60 * 1000; // 5 minutes

  // Get all settings for a group
  static async getSettingsByGroup(group) {
    const cacheKey = `group_${group}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const settings = await prisma.wP_ADMIN_SETTINGS.findMany({
      where: {
        SettingGroup: group,
        IsActive: true
      }
    });

    this.setCache(cacheKey, settings);
    return settings;
  }

  // Get a single setting
  static async getSetting(key) {
    const cacheKey = `setting_${key}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const setting = await prisma.wP_ADMIN_SETTINGS.findFirst({
      where: {
        SettingKey: key,
        IsActive: true
      }
    });

    const value = setting ? setting.SettingValue : null;
    this.setCache(cacheKey, value);
    return value;
  }

  // Update or create a setting
  static async upsertSetting(key, value, group, description, userId) {
    const now = new Date();

    const setting = await prisma.wP_ADMIN_SETTINGS.upsert({
      where: {
        SettingKey: key
      },
      update: {
        SettingValue: value,
        SettingGroup: group,
        Description: description,
        UpdatedBy: userId ? String(userId) : null,
        UpdateTS: now
      },
      create: {
        SettingKey: key,
        SettingValue: value,
        SettingGroup: group,
        Description: description,
        IsActive: true,
        CreatedBy: userId ? String(userId) : null,
        UpdatedBy: userId ? String(userId) : null,
        CreateTS: now,
        UpdateTS: now
      }
    });

    this.clearCache();
    return setting;
  }

  // Bulk update settings
  static async bulkUpsertSettings(settings, userId) {
    const now = new Date();
    const results = [];

    // Use a transaction for bulk operations
    const result = await prisma.$transaction(async (tx) => {
      for (const setting of settings) {
        const { key, value, group, description } = setting;

        const upsertedSetting = await tx.wP_ADMIN_SETTINGS.upsert({
          where: {
            SettingKey: key
          },
          update: {
            SettingValue: value,
            SettingGroup: group,
            Description: description,
            UpdatedBy: userId ? String(userId) : null,
            UpdateTS: now
          },
          create: {
            SettingKey: key,
            SettingValue: value,
            SettingGroup: group,
            Description: description,
            IsActive: true,
            CreatedBy: userId ? String(userId) : null,
            UpdatedBy: userId ? String(userId) : null,
            CreateTS: now,
            UpdateTS: now
          }
        });

        results.push(upsertedSetting);
      }

      return results;
    });

    this.clearCache();
    return result;
  }

  // Get all settings with pagination and filtering
  static async getAllSettings(page = 1, limit = 10, filter = {}) {
    const skip = (page - 1) * limit;
    const where = { IsActive: true };

    if (filter.group) where.SettingGroup = filter.group;
    if (filter.search) {
      where.OR = [
        { SettingKey: { contains: filter.search } },
        { Description: { contains: filter.search } }
      ];
    }

    // Get total count
    const count = await prisma.wP_ADMIN_SETTINGS.count({ where });

    // Get paginated settings
    const settings = await prisma.wP_ADMIN_SETTINGS.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { SettingGroup: 'asc' },
        { SettingKey: 'asc' }
      ]
    });

    return {
      settings,
      total: count,
      page,
      totalPages: Math.ceil(count / limit)
    };
  }

  // Cache management
  static getCached(key) {
    const cached = this.settingsCache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.settingsCache.delete(key);
      return null;
    }

    return cached.value;
  }

  static setCache(key, value) {
    this.settingsCache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  static clearCache() {
    this.settingsCache.clear();
  }

  // Helper methods for common settings
  static async getPortalSettings() {
    return this.getSettingsByGroup('portal');
  }

  static async getSecuritySettings() {
    return this.getSettingsByGroup('security');
  }

  static async getNotificationSettings() {
    return this.getSettingsByGroup('notifications');
  }

  static async getIntegrationSettings() {
    return this.getSettingsByGroup('integrations');
  }

  // Initialize default settings if not exists
  static async initializeDefaultSettings(userId) {
    const defaultSettings = [
      // Portal Settings
      {
        key: 'portal.maintenance_mode',
        value: false,
        group: 'portal',
        description: 'Enable/disable portal maintenance mode'
      },
      {
        key: 'portal.company_registration',
        value: true,
        group: 'portal',
        description: 'Allow new company registrations'
      },
      {
        key: 'portal.max_file_size',
        value: 10485760, // 10MB in bytes
        group: 'portal',
        description: 'Maximum file upload size in bytes'
      },
      {
        key: 'portal.allowed_file_types',
        value: ['.pdf', '.jpg', '.png', '.xml', '.json'],
        group: 'portal',
        description: 'Allowed file upload types'
      },

      // Security Settings
      {
        key: 'security.max_login_attempts',
        value: 5,
        group: 'security',
        description: 'Maximum number of failed login attempts before account lockout'
      },
      {
        key: 'security.lockout_duration',
        value: 30,
        group: 'security',
        description: 'Account lockout duration in minutes'
      },
      {
        key: 'security.password_expiry_days',
        value: 90,
        group: 'security',
        description: 'Number of days before password expiration'
      },
      {
        key: 'security.min_password_length',
        value: 8,
        group: 'security',
        description: 'Minimum password length'
      },
      {
        key: 'security.require_special_chars',
        value: true,
        group: 'security',
        description: 'Require special characters in password'
      },
      {
        key: 'security.session_timeout',
        value: 30,
        group: 'security',
        description: 'Session timeout in minutes'
      },

      // Email Settings
      {
        key: 'email.smtp_host',
        value: 'smtp.gmail.com',
        group: 'email',
        description: 'SMTP server host'
      },
      {
        key: 'email.smtp_port',
        value: 587,
        group: 'email',
        description: 'SMTP server port'
      },
      {
        key: 'email.from_address',
        value: 'noreply@yourdomain.com',
        group: 'email',
        description: 'Default from email address'
      },
      {
        key: 'email.require_verification',
        value: true,
        group: 'email',
        description: 'Require email verification for new accounts'
      },

      // Invoice Settings
      {
        key: 'invoice.default_currency',
        value: 'MYR',
        group: 'invoice',
        description: 'Default currency for invoices'
      },
      {
        key: 'invoice.tax_rate',
        value: 6,
        group: 'invoice',
        description: 'Default tax rate percentage'
      },
      {
        key: 'invoice.number_format',
        value: 'INV-{YYYY}-{MM}-{0000}',
        group: 'invoice',
        description: 'Invoice number format pattern'
      },
      {
        key: 'invoice.auto_numbering',
        value: true,
        group: 'invoice',
        description: 'Enable automatic invoice numbering'
      },

      // API Settings
      {
        key: 'api.rate_limit',
        value: 100,
        group: 'api',
        description: 'API rate limit per minute'
      },
      {
        key: 'api.timeout',
        value: 30000,
        group: 'api',
        description: 'API timeout in milliseconds'
      },
      {
        key: 'api.retry_attempts',
        value: 3,
        group: 'api',
        description: 'Number of API retry attempts'
      },

      // Notification Settings
      {
        key: 'notifications.email_enabled',
        value: true,
        group: 'notifications',
        description: 'Enable email notifications'
      },
      {
        key: 'notifications.admin_email',
        value: 'admin@yourdomain.com',
        group: 'notifications',
        description: 'Admin notification email address'
      },
      {
        key: 'notifications.error_alerts',
        value: true,
        group: 'notifications',
        description: 'Send notifications for system errors'
      },

      // Audit Settings
      {
        key: 'audit.log_retention_days',
        value: 90,
        group: 'audit',
        description: 'Number of days to retain audit logs'
      },
      {
        key: 'audit.detailed_logging',
        value: true,
        group: 'audit',
        description: 'Enable detailed audit logging'
      },
      {
        key: 'audit.log_user_actions',
        value: true,
        group: 'audit',
        description: 'Log all user actions'
      },

      // LHDN e-Invoice Settings
      {
        key: 'lhdn.api_environment',
        value: 'sandbox',
        group: 'lhdn',
        description: 'LHDN API environment (sandbox/production)'
      },
      {
        key: 'lhdn.api_version',
        value: 'v1.0',
        group: 'lhdn',
        description: 'LHDN API version'
      },
      {
        key: 'lhdn.sandbox_url',
        value: 'https://preprod-api.myinvois.hasil.gov.my/api',
        group: 'lhdn',
        description: 'LHDN sandbox API endpoint'
      },
      {
        key: 'lhdn.production_url',
        value: 'https://api.myinvois.hasil.gov.my/api',
        group: 'lhdn',
        description: 'LHDN production API endpoint'
      },
      {
        key: 'lhdn.auto_submission',
        value: true,
        group: 'lhdn',
        description: 'Automatically submit invoices to LHDN'
      },
      {
        key: 'lhdn.submission_delay',
        value: 0,
        group: 'lhdn',
        description: 'Delay in minutes before submitting to LHDN (0 for immediate)'
      },
      {
        key: 'lhdn.batch_size',
        value: 100,
        group: 'lhdn',
        description: 'Maximum number of invoices to submit in one batch'
      },
      {
        key: 'lhdn.retry_count',
        value: 3,
        group: 'lhdn',
        description: 'Number of retry attempts for failed submissions'
      },
      {
        key: 'lhdn.retry_delay',
        value: 5,
        group: 'lhdn',
        description: 'Delay in minutes between retry attempts'
      },
      {
        key: 'lhdn.validate_before_submit',
        value: true,
        group: 'lhdn',
        description: 'Validate invoice format before submission'
      },
      {
        key: 'lhdn.store_responses',
        value: true,
        group: 'lhdn',
        description: 'Store LHDN API responses for audit'
      },
      {
        key: 'lhdn.response_retention_days',
        value: 90,
        group: 'lhdn',
        description: 'Number of days to retain API responses'
      },
      {
        key: 'lhdn.notify_errors',
        value: true,
        group: 'lhdn',
        description: 'Send notifications for submission errors'
      },
      {
        key: 'lhdn.allowed_tax_codes',
        value: ['SR', 'ZR', 'ES', 'OS', 'DS', 'RS', 'GS', 'AJS'],
        group: 'lhdn',
        description: 'Allowed tax codes for invoices'
      },
      {
        key: 'lhdn.business_process',
        value: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'],
        group: 'lhdn',
        description: 'Supported business processes'
      },
      {
        key: 'lhdn.schema_validation',
        value: true,
        group: 'lhdn',
        description: 'Validate against LHDN JSON schema'
      },
      {
        key: 'lhdn.digital_signature',
        value: true,
        group: 'lhdn',
        description: 'Enable digital signature for submissions'
      },
      {
        key: 'lhdn.signature_type',
        value: 'SHA256withRSA',
        group: 'lhdn',
        description: 'Digital signature algorithm'
      }
    ];

    await this.bulkUpsertSettings(defaultSettings, userId);
  }

  // Add LHDN specific helper methods
  static async getLHDNSettings() {
    return this.getSettingsByGroup('lhdn');
  }

  static async getLHDNApiUrl() {
    const settings = await this.getLHDNSettings();
    const environment = settings['lhdn.api_environment'];
    return environment === 'production'
      ? settings['lhdn.production_url']
      : settings['lhdn.sandbox_url'];
  }

  static async validateTaxCode(taxCode) {
    const settings = await this.getLHDNSettings();
    const allowedCodes = settings['lhdn.allowed_tax_codes'];
    return allowedCodes.includes(taxCode);
  }

  static async validateBusinessProcess(process) {
    const settings = await this.getLHDNSettings();
    const allowedProcesses = settings['lhdn.business_process'];
    return allowedProcesses.includes(process);
  }
}

module.exports = AdminSettingsService;