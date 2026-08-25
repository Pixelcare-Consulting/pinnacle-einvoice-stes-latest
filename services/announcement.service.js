const { PrismaClient } = require('../src/generated/prisma');
const { NotificationService, NOTIFICATION_TYPES, PRIORITY_LEVELS } = require('./notification.service');
const prisma = new PrismaClient();

// Announcement types
const ANNOUNCEMENT_TYPES = {
  GENERAL: 'general',
  MAINTENANCE: 'maintenance',
  FEATURE: 'feature',
  SECURITY: 'security'
};

// Announcement status
const ANNOUNCEMENT_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived'
};

// Target audiences
const TARGET_AUDIENCES = {
  ALL: 'all',
  ADMIN: 'admin',
  USERS: 'users'
};

class AnnouncementService {
  /**
   * Create a new announcement
   */
  static async createAnnouncement({
    title,
    content,
    summary = null,
    type = ANNOUNCEMENT_TYPES.GENERAL,
    priority = PRIORITY_LEVELS.NORMAL,
    targetAudience = TARGET_AUDIENCES.ALL,
    isPinned = false,
    isPopup = false,
    publishAt = null,
    expiresAt = null,
    createdBy
  }) {
    try {
      const announcement = await prisma.wP_ANNOUNCEMENTS.create({
        data: {
          title,
          content,
          summary,
          type,
          priority,
          target_audience: targetAudience,
          is_pinned: isPinned,
          is_popup: isPopup,
          publish_at: publishAt,
          expires_at: expiresAt,
          created_by: createdBy,
          status: publishAt ? ANNOUNCEMENT_STATUS.DRAFT : ANNOUNCEMENT_STATUS.PUBLISHED
        }
      });

      // If published immediately and is popup, create notifications
      if (!publishAt && isPopup) {
        await this.createNotificationsFromAnnouncement(announcement);
      }

      return announcement;
    } catch (error) {
      console.error('Error creating announcement:', error);
      throw error;
    }
  }

  /**
   * Update an existing announcement
   */
  static async updateAnnouncement(id, updateData, updatedBy) {
    try {
      // Validate inputs
      if (!id || isNaN(id)) {
        throw new Error('Invalid announcement ID');
      }

      if (!updatedBy) {
        throw new Error('Updated by user ID is required');
      }

      // Check if announcement exists first
      const existingAnnouncement = await prisma.wP_ANNOUNCEMENTS.findUnique({
        where: { id }
      });

      if (!existingAnnouncement) {
        throw new Error('Announcement not found');
      }

      console.log('Updating announcement:', { id, updateData, updatedBy });

      const announcement = await prisma.wP_ANNOUNCEMENTS.update({
        where: { id },
        data: {
          ...updateData,
          updated_by: updatedBy,
          updated_at: new Date()
        }
      });

      // If status changed to published and is popup, create notifications
      if (updateData.status === ANNOUNCEMENT_STATUS.PUBLISHED && announcement.is_popup) {
        try {
          await this.createNotificationsFromAnnouncement(announcement);
        } catch (notificationError) {
          console.error('Error creating notifications for announcement:', notificationError);
          // Don't fail the update if notification creation fails
        }
      }

      return announcement;
    } catch (error) {
      console.error('Error updating announcement:', error);

      // Provide more specific error messages
      if (error.code === 'P2025') {
        throw new Error('Announcement not found');
      } else if (error.code === 'P2002') {
        throw new Error('Duplicate announcement data');
      } else if (error.message.includes('Invalid')) {
        throw error;
      } else {
        throw new Error(`Failed to update announcement: ${error.message}`);
      }
    }
  }

  /**
   * Get a single announcement by ID
   */
  static async getAnnouncementById(id) {
    try {
      const announcement = await prisma.wP_ANNOUNCEMENTS.findUnique({
        where: { id },
        include: {
          // Add user information if needed
        }
      });

      return announcement;
    } catch (error) {
      console.error('Error fetching announcement by ID:', error);
      throw error;
    }
  }

  /**
   * Get announcements with filtering
   */
  static async getAnnouncements(options = {}) {
    try {
      const {
        status = null,
        type = null,
        targetAudience = null,
        isPinned = null,
        limit = 50,
        offset = 0,
        includeExpired = false
      } = options;

      const whereConditions = {};

      if (status) {
        whereConditions.status = status;
      }

      if (type) {
        whereConditions.type = type;
      }

      if (targetAudience) {
        whereConditions.target_audience = targetAudience;
      }

      if (isPinned !== null) {
        whereConditions.is_pinned = isPinned;
      }

      if (!includeExpired) {
        whereConditions.OR = [
          { expires_at: null },
          { expires_at: { gt: new Date() } }
        ];
      }

      const announcements = await prisma.wP_ANNOUNCEMENTS.findMany({
        where: whereConditions,
        orderBy: [
          { is_pinned: 'desc' },
          { priority: 'desc' },
          { created_at: 'desc' }
        ],
        take: limit,
        skip: offset,
        include: {
          // Add user information if needed
        }
      });

      return announcements;
    } catch (error) {
      console.error('Error fetching announcements:', error);
      throw error;
    }
  }

  /**
   * Get active announcements for display
   */
  static async getActiveAnnouncements(userRole = 'user') {
    try {
      const now = new Date();

      const announcements = await prisma.wP_ANNOUNCEMENTS.findMany({
        where: {
          status: ANNOUNCEMENT_STATUS.PUBLISHED,
          AND: [
            {
              OR: [
                { publish_at: null },
                { publish_at: { lte: now } }
              ]
            },
            {
              OR: [
                { expires_at: null },
                { expires_at: { gt: now } }
              ]
            },
            {
              OR: [
                { target_audience: TARGET_AUDIENCES.ALL },
                { target_audience: userRole }
              ]
            }
          ]
        },
        orderBy: [
          { is_pinned: 'desc' },
          { priority: 'desc' },
          { created_at: 'desc' }
        ]
      });

      return announcements;
    } catch (error) {
      console.error('Error fetching active announcements:', error);
      throw error;
    }
  }

  /**
   * Get popup announcements for a user
   */
  static async getPopupAnnouncements(userRole = 'user') {
    try {
      const now = new Date();

      const announcements = await prisma.wP_ANNOUNCEMENTS.findMany({
        where: {
          status: ANNOUNCEMENT_STATUS.PUBLISHED,
          is_popup: true,
          AND: [
            {
              OR: [
                { publish_at: null },
                { publish_at: { lte: now } }
              ]
            },
            {
              OR: [
                { expires_at: null },
                { expires_at: { gt: now } }
              ]
            },
            {
              OR: [
                { target_audience: TARGET_AUDIENCES.ALL },
                { target_audience: userRole }
              ]
            }
          ]
        },
        orderBy: [
          { priority: 'desc' },
          { created_at: 'desc' }
        ]
      });

      return announcements;
    } catch (error) {
      console.error('Error fetching popup announcements:', error);
      throw error;
    }
  }

  /**
   * Delete an announcement
   */
  static async deleteAnnouncement(id) {
    try {
      // First delete related notifications
      await prisma.wP_NOTIFICATIONS.deleteMany({
        where: {
          type: NOTIFICATION_TYPES.ANNOUNCEMENT,
          source_id: id.toString()
        }
      });

      // Then delete the announcement
      const result = await prisma.wP_ANNOUNCEMENTS.delete({
        where: { id }
      });

      return result;
    } catch (error) {
      console.error('Error deleting announcement:', error);
      throw error;
    }
  }

  /**
   * Archive an announcement
   */
  static async archiveAnnouncement(id, updatedBy) {
    try {
      const announcement = await prisma.wP_ANNOUNCEMENTS.update({
        where: { id },
        data: {
          status: ANNOUNCEMENT_STATUS.ARCHIVED,
          updated_by: updatedBy,
          updated_at: new Date()
        }
      });

      return announcement;
    } catch (error) {
      console.error('Error archiving announcement:', error);
      throw error;
    }
  }

  /**
   * Publish a draft announcement
   */
  static async publishAnnouncement(id, updatedBy) {
    try {
      const announcement = await prisma.wP_ANNOUNCEMENTS.update({
        where: { id },
        data: {
          status: ANNOUNCEMENT_STATUS.PUBLISHED,
          publish_at: new Date(),
          updated_by: updatedBy,
          updated_at: new Date()
        }
      });

      // Create notifications if it's a popup announcement
      if (announcement.is_popup) {
        await this.createNotificationsFromAnnouncement(announcement);
      }

      return announcement;
    } catch (error) {
      console.error('Error publishing announcement:', error);
      throw error;
    }
  }

  /**
   * Create notifications from announcement
   */
  static async createNotificationsFromAnnouncement(announcement) {
    try {
      const isGlobal = announcement.target_audience === TARGET_AUDIENCES.ALL;
      const targetRole = announcement.target_audience !== TARGET_AUDIENCES.ALL
        ? announcement.target_audience
        : null;

      await NotificationService.createNotification({
        title: announcement.title,
        message: announcement.summary || announcement.content.substring(0, 200) + '...',
        type: NOTIFICATION_TYPES.ANNOUNCEMENT,
        priority: announcement.priority,
        targetRole,
        isGlobal,
        sourceType: 'announcement',
        sourceId: announcement.id.toString(),
        metadata: {
          announcementType: announcement.type,
          isPopup: announcement.is_popup,
          isPinned: announcement.is_pinned
        },
        expiresAt: announcement.expires_at,
        createdBy: announcement.created_by
      });
    } catch (error) {
      console.error('Error creating notifications from announcement:', error);
      throw error;
    }
  }

  /**
   * Get announcement statistics
   */
  static async getAnnouncementStats() {
    try {
      const stats = await prisma.wP_ANNOUNCEMENTS.groupBy({
        by: ['status', 'type'],
        _count: {
          id: true
        }
      });

      const total = await prisma.wP_ANNOUNCEMENTS.count();
      const active = await prisma.wP_ANNOUNCEMENTS.count({
        where: {
          status: ANNOUNCEMENT_STATUS.PUBLISHED,
          OR: [
            { expires_at: null },
            { expires_at: { gt: new Date() } }
          ]
        }
      });

      return {
        total,
        active,
        breakdown: stats
      };
    } catch (error) {
      console.error('Error getting announcement stats:', error);
      throw error;
    }
  }

  /**
   * Clean up expired announcements
   */
  static async cleanupExpiredAnnouncements() {
    try {
      const result = await prisma.wP_ANNOUNCEMENTS.updateMany({
        where: {
          expires_at: {
            lt: new Date()
          },
          status: ANNOUNCEMENT_STATUS.PUBLISHED
        },
        data: {
          status: ANNOUNCEMENT_STATUS.ARCHIVED
        }
      });

      return result.count;
    } catch (error) {
      console.error('Error cleaning up expired announcements:', error);
      throw error;
    }
  }
}

module.exports = {
  AnnouncementService,
  ANNOUNCEMENT_TYPES,
  ANNOUNCEMENT_STATUS,
  TARGET_AUDIENCES
};
