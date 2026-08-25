const { logger } = require('./logger');

class SettingsManager {
  constructor(models) {
    this.models = models;
  }

  async getUserSettings(userId) {
    try {
      const [userSettings, companySettings, einvoiceSettings, notificationSettings] = await Promise.all([
        this.models.WP_SETTINGS.findOne({ where: { UserID: userId } }),
        this.models.WP_COMPANY_SETTINGS.findOne({ where: { UserID: userId } }),
        this.models.einvoice_settings.findOne({ where: { userId: userId } }),
        this.models.notification_settings.findOne({ where: { userId: userId } })
      ]);

      return {
        userSettings,
        companySettings,
        einvoiceSettings,
        notificationSettings
      };
    } catch (error) {
      logger.error('Failed to fetch user settings', { userId, error: error.message });
      throw error;
    }
  }

  async updateUserSettings(userId, settings) {
    const t = await this.models.sequelize.transaction();

    try {
      const {
        userSettings,
        companySettings,
        einvoiceSettings,
        notificationSettings
      } = settings;

      const updates = [];

      if (userSettings) {
        updates.push(
          this.models.WP_SETTINGS.upsert(
            { ...userSettings, UserID: userId },
            { transaction: t }
          )
        );
      }

      if (companySettings) {
        updates.push(
          this.models.WP_COMPANY_SETTINGS.upsert(
            { ...companySettings, UserID: userId },
            { transaction: t }
          )
        );
      }

      if (einvoiceSettings) {
        updates.push(
          this.models.einvoice_settings.upsert(
            { ...einvoiceSettings, userId: userId },
            { transaction: t }
          )
        );
      }

      if (notificationSettings) {
        updates.push(
          this.models.notification_settings.upsert(
            { ...notificationSettings, userId: userId },
            { transaction: t }
          )
        );
      }

      await Promise.all(updates);
      await t.commit();

      logger.info('Settings updated successfully', { userId });
      return await this.getUserSettings(userId);
    } catch (error) {
      await t.rollback();
      logger.error('Failed to update settings', { userId, error: error.message });
      throw error;
    }
  }

  async getDefaultSettings() {
    return {
      einvoiceSettings: {
        apiVersion: 'v1',
        defaultTemplate: 'standard',
        logoPosition: 'top-left',
        showQRCode: true,
        invoiceFormat: 'INV-{YYYY}-{MM}-{0000}',
        startingNumber: 1,
        resetMonthly: false,
        defaultTaxRate: 0.00,
        includeTax: true
      },
      notificationSettings: {
        emailNewInvoice: true,
        emailStatusUpdate: true,
        emailPaymentReceived: true,
        emailDailyDigest: false,
        browserNotifications: true,
        soundNotifications: true,
        alertDuration: 5,
        smsNotifications: false,
        pushNotifications: true,
        quietHoursStart: '22:00:00',
        quietHoursEnd: '08:00:00',
        timezone: 'Asia/Kuala_Lumpur',
        workdaysOnly: false
      }
    };
  }
}

module.exports = SettingsManager; 