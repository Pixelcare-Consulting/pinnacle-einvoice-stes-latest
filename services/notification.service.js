const { PrismaClient } = require('../src/generated/prisma');
const axios = require('axios');
const prisma = new PrismaClient();

// Notification types
const NOTIFICATION_TYPES = {
  SYSTEM: 'system',
  LHDN: 'lhdn',
  ANNOUNCEMENT: 'announcement',
  ALERT: 'alert'
};

// Priority levels
const PRIORITY_LEVELS = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent'
};

// Source types
const SOURCE_TYPES = {
  INTERNAL: 'internal',
  LHDN_API: 'lhdn_api',
  SYSTEM: 'system'
};

class NotificationService {
  /**
   * Create a new notification
   */
  static async createNotification({
    title,
    message,
    type = NOTIFICATION_TYPES.SYSTEM,
    priority = PRIORITY_LEVELS.NORMAL,
    targetUserId = null,
    targetRole = null,
    isGlobal = false,
    sourceType = SOURCE_TYPES.INTERNAL,
    sourceId = null,
    metadata = null,
    expiresAt = null,
    createdBy = null
  }) {
    try {
      const notification = await prisma.wP_NOTIFICATIONS.create({
        data: {
          title,
          message,
          type,
          priority,
          target_user_id: targetUserId,
          target_role: targetRole,
          is_global: isGlobal,
          source_type: sourceType,
          source_id: sourceId,
          metadata: metadata ? JSON.stringify(metadata) : null,
          expires_at: expiresAt,
          created_by: createdBy
        }
      });

      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Get notifications for a specific user
   */
  static async getUserNotifications(userId, options = {}) {
    try {
      const {
        limit = 50,
        offset = 0,
        unreadOnly = false,
        type = null,
        includeGlobal = true
      } = options;

      const whereConditions = {
        AND: [
          {
            OR: [
              { target_user_id: userId },
              includeGlobal ? { is_global: true } : { is_global: false }
            ]
          },
          {
            OR: [
              { expires_at: null },
              { expires_at: { gt: new Date() } }
            ]
          }
        ]
      };

      if (unreadOnly) {
        whereConditions.AND.push({ is_read: false });
      }

      if (type) {
        whereConditions.AND.push({ type });
      }

      const notifications = await prisma.wP_NOTIFICATIONS.findMany({
        where: whereConditions,
        orderBy: [
          { priority: 'desc' },
          { created_at: 'desc' }
        ],
        take: limit,
        skip: offset
      });

      return notifications;
    } catch (error) {
      console.error('Error fetching user notifications:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId, userId) {
    try {
      const notification = await prisma.wP_NOTIFICATIONS.updateMany({
        where: {
          id: notificationId,
          OR: [
            { target_user_id: userId },
            { is_global: true }
          ]
        },
        data: {
          is_read: true,
          updated_at: new Date()
        }
      });

      return notification;
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId) {
    try {
      const result = await prisma.wP_NOTIFICATIONS.updateMany({
        where: {
          OR: [
            { target_user_id: userId },
            { is_global: true }
          ],
          is_read: false
        },
        data: {
          is_read: true,
          updated_at: new Date()
        }
      });

      return result;
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      throw error;
    }
  }

  /**
   * Get unread notification count for a user
   */
  static async getUnreadCount(userId) {
    try {
      const count = await prisma.wP_NOTIFICATIONS.count({
        where: {
          OR: [
            { target_user_id: userId },
            { is_global: true }
          ],
          is_read: false,
          OR: [
            { expires_at: null },
            { expires_at: { gt: new Date() } }
          ]
        }
      });

      return count;
    } catch (error) {
      console.error('Error getting unread count:', error);
      throw error;
    }
  }

  /**
   * Create notification from WP_LOGS entry
   */
  static async createFromLog(logEntry, targetUserId = null) {
    try {
      // Determine notification type and priority based on log type
      let type = NOTIFICATION_TYPES.SYSTEM;
      let priority = PRIORITY_LEVELS.NORMAL;

      if (logEntry.LogType === 'ERROR') {
        type = NOTIFICATION_TYPES.ALERT;
        priority = PRIORITY_LEVELS.HIGH;
      } else if (logEntry.LogType === 'WARNING') {
        priority = PRIORITY_LEVELS.HIGH;
      }

      const notification = await this.createNotification({
        title: `${logEntry.Module} - ${logEntry.Action}`,
        message: logEntry.Description,
        type,
        priority,
        targetUserId,
        sourceType: SOURCE_TYPES.INTERNAL,
        sourceId: logEntry.ID.toString(),
        metadata: {
          logType: logEntry.LogType,
          module: logEntry.Module,
          action: logEntry.Action,
          status: logEntry.Status,
          ipAddress: logEntry.IPAddress
        },
        createdBy: logEntry.UserID
      });

      return notification;
    } catch (error) {
      console.error('Error creating notification from log:', error);
      throw error;
    }
  }

  /**
   * Fetch LHDN notifications from API
   */
  static async fetchLHDNNotifications(accessToken, lhdnConfig) {
    try {
      const response = await axios.get(
        `${lhdnConfig.baseUrl}/api/v1.0/notifications`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error fetching LHDN notifications:', error);
      throw error;
    }
  }

  /**
   * Sync LHDN notifications and create local notifications
   */
  static async syncLHDNNotifications(userId, accessToken, lhdnConfig) {
    try {
      const lhdnNotifications = await this.fetchLHDNNotifications(accessToken, lhdnConfig);

      if (!lhdnNotifications || !lhdnNotifications.result) {
        return { synced: 0, errors: 0 };
      }

      let synced = 0;
      let errors = 0;

      for (const lhdnNotif of lhdnNotifications.result) {
        try {
          // Check if notification already exists
          const existing = await prisma.wP_NOTIFICATIONS.findFirst({
            where: {
              source_type: SOURCE_TYPES.LHDN_API,
              source_id: lhdnNotif.id || lhdnNotif.notificationId
            }
          });

          if (!existing) {
            await this.createNotification({
              title: lhdnNotif.title || 'LHDN Notification',
              message: lhdnNotif.message || lhdnNotif.description,
              type: NOTIFICATION_TYPES.LHDN,
              priority: this.mapLHDNPriority(lhdnNotif.priority),
              targetUserId: userId,
              sourceType: SOURCE_TYPES.LHDN_API,
              sourceId: lhdnNotif.id || lhdnNotif.notificationId,
              metadata: {
                lhdnData: lhdnNotif,
                documentId: lhdnNotif.documentId,
                notificationType: lhdnNotif.type
              }
            });
            synced++;
          }
        } catch (error) {
          console.error('Error processing LHDN notification:', error);
          errors++;
        }
      }

      return { synced, errors, total: lhdnNotifications.result.length };
    } catch (error) {
      console.error('Error syncing LHDN notifications:', error);
      throw error;
    }
  }

  /**
   * Map LHDN priority to local priority
   */
  static mapLHDNPriority(lhdnPriority) {
    const priorityMap = {
      'low': PRIORITY_LEVELS.LOW,
      'normal': PRIORITY_LEVELS.NORMAL,
      'high': PRIORITY_LEVELS.HIGH,
      'urgent': PRIORITY_LEVELS.URGENT,
      'critical': PRIORITY_LEVELS.URGENT
    };

    return priorityMap[lhdnPriority?.toLowerCase()] || PRIORITY_LEVELS.NORMAL;
  }

  /**
   * Clean up expired notifications
   */
  static async cleanupExpiredNotifications() {
    try {
      const result = await prisma.wP_NOTIFICATIONS.deleteMany({
        where: {
          expires_at: {
            lt: new Date()
          }
        }
      });

      return result.count;
    } catch (error) {
      console.error('Error cleaning up expired notifications:', error);
      throw error;
    }
  }
}

module.exports = {
  NotificationService,
  NOTIFICATION_TYPES,
  PRIORITY_LEVELS,
  SOURCE_TYPES
};
