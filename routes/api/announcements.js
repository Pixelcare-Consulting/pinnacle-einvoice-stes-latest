const express = require('express');
const router = express.Router();
const { AnnouncementService, ANNOUNCEMENT_TYPES, ANNOUNCEMENT_STATUS, TARGET_AUDIENCES } = require('../../services/announcement.service');
const { auth } = require('../../middleware');

// Get all announcements (admin only)
router.get('/admin', auth.isAdmin, async (req, res) => {
    try {
        const {
            status = null,
            type = null,
            targetAudience = null,
            isPinned = null,
            limit = 50,
            offset = 0,
            includeExpired = true
        } = req.query;

        const announcements = await AnnouncementService.getAnnouncements({
            status,
            type,
            targetAudience,
            isPinned: isPinned !== null ? isPinned === 'true' : null,
            limit: parseInt(limit),
            offset: parseInt(offset),
            includeExpired: includeExpired === 'true'
        });

        res.json({
            success: true,
            data: announcements,
            count: announcements.length
        });
    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch announcements',
            error: error.message
        });
    }
});

// Get active announcements for users
router.get('/', auth.middleware, async (req, res) => {
    try {
        const userRole = req.session.user.admin ? 'admin' : 'user';
        const announcements = await AnnouncementService.getActiveAnnouncements(userRole);

        res.json({
            success: true,
            data: announcements,
            count: announcements.length
        });
    } catch (error) {
        console.error('Error fetching active announcements:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch announcements',
            error: error.message
        });
    }
});

// Get popup announcements for users
router.get('/popup', auth.middleware, async (req, res) => {
    try {
        const userRole = req.session.user.admin ? 'admin' : 'user';
        const announcements = await AnnouncementService.getPopupAnnouncements(userRole);

        res.json({
            success: true,
            data: announcements,
            count: announcements.length
        });
    } catch (error) {
        console.error('Error fetching popup announcements:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch popup announcements',
            error: error.message
        });
    }
});

// Get single announcement by ID (admin only)
router.get('/:id', auth.isAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        if (isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid announcement ID'
            });
        }

        const announcement = await AnnouncementService.getAnnouncementById(id);

        if (!announcement) {
            return res.status(404).json({
                success: false,
                message: 'Announcement not found'
            });
        }

        res.json({
            success: true,
            data: announcement
        });
    } catch (error) {
        console.error('Error fetching announcement:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch announcement',
            error: error.message
        });
    }
});

// Create new announcement (admin only)
router.post('/', auth.isAdmin, async (req, res) => {
    try {
        const {
            title,
            content,
            summary = null,
            type = ANNOUNCEMENT_TYPES.GENERAL,
            priority = 'normal',
            targetAudience = TARGET_AUDIENCES.ALL,
            isPinned = false,
            isPopup = false,
            publishAt = null,
            expiresAt = null
        } = req.body;

        // Validate required fields
        if (!title || !content) {
            return res.status(400).json({
                success: false,
                message: 'Title and content are required'
            });
        }

        const createdBy = req.session.user.id;

        const announcement = await AnnouncementService.createAnnouncement({
            title,
            content,
            summary,
            type,
            priority,
            targetAudience,
            isPinned,
            isPopup,
            publishAt: publishAt ? new Date(publishAt) : null,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            createdBy
        });

        res.json({
            success: true,
            data: announcement,
            message: 'Announcement created successfully'
        });
    } catch (error) {
        console.error('Error creating announcement:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create announcement',
            error: error.message
        });
    }
});

// Update announcement (admin only)
router.put('/:id', auth.isAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        // Validate ID
        if (isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid announcement ID'
            });
        }

        // Validate session and user
        if (!req.session || !req.session.user || !req.session.user.id) {
            return res.status(401).json({
                success: false,
                message: 'User session not found'
            });
        }

        const updateData = { ...req.body };
        const updatedBy = req.session.user.id;

        // Remove fields that shouldn't be updated directly
        delete updateData.id;
        delete updateData.created_by;
        delete updateData.created_at;
        delete updateData.updated_by;
        delete updateData.updated_at;

        // Convert camelCase to snake_case for database fields
        if (updateData.targetAudience !== undefined) {
            updateData.target_audience = updateData.targetAudience;
            delete updateData.targetAudience;
        }
        if (updateData.isPinned !== undefined) {
            updateData.is_pinned = updateData.isPinned;
            delete updateData.isPinned;
        }
        if (updateData.isPopup !== undefined) {
            updateData.is_popup = updateData.isPopup;
            delete updateData.isPopup;
        }

        // Convert date strings to Date objects with validation
        if (updateData.publishAt) {
            try {
                updateData.publish_at = new Date(updateData.publishAt);
                if (isNaN(updateData.publish_at.getTime())) {
                    updateData.publish_at = null;
                }
            } catch (e) {
                updateData.publish_at = null;
            }
            delete updateData.publishAt;
        }
        if (updateData.expiresAt) {
            try {
                updateData.expires_at = new Date(updateData.expiresAt);
                if (isNaN(updateData.expires_at.getTime())) {
                    updateData.expires_at = null;
                }
            } catch (e) {
                updateData.expires_at = null;
            }
            delete updateData.expiresAt;
        }

        console.log('Updating announcement with data:', { id, updateData, updatedBy });

        const announcement = await AnnouncementService.updateAnnouncement(id, updateData, updatedBy);

        res.json({
            success: true,
            data: announcement,
            message: 'Announcement updated successfully'
        });
    } catch (error) {
        console.error('Error updating announcement:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update announcement',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Publish announcement (admin only)
router.put('/:id/publish', auth.isAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const updatedBy = req.session.user.id;

        const announcement = await AnnouncementService.publishAnnouncement(id, updatedBy);

        res.json({
            success: true,
            data: announcement,
            message: 'Announcement published successfully'
        });
    } catch (error) {
        console.error('Error publishing announcement:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to publish announcement',
            error: error.message
        });
    }
});

// Archive announcement (admin only)
router.put('/:id/archive', auth.isAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const updatedBy = req.session.user.id;

        const announcement = await AnnouncementService.archiveAnnouncement(id, updatedBy);

        res.json({
            success: true,
            data: announcement,
            message: 'Announcement archived successfully'
        });
    } catch (error) {
        console.error('Error archiving announcement:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to archive announcement',
            error: error.message
        });
    }
});

// Delete announcement (admin only)
router.delete('/:id', auth.isAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        await AnnouncementService.deleteAnnouncement(id);

        res.json({
            success: true,
            message: 'Announcement deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting announcement:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete announcement',
            error: error.message
        });
    }
});

// Get announcement statistics (admin only)
router.get('/admin/stats', auth.isAdmin, async (req, res) => {
    try {
        const stats = await AnnouncementService.getAnnouncementStats();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error fetching announcement stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch announcement statistics',
            error: error.message
        });
    }
});

// Get announcement types and constants
router.get('/constants', auth.middleware, async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                types: Object.values(ANNOUNCEMENT_TYPES),
                statuses: Object.values(ANNOUNCEMENT_STATUS),
                audiences: Object.values(TARGET_AUDIENCES),
                priorities: ['low', 'normal', 'high', 'urgent']
            }
        });
    } catch (error) {
        console.error('Error fetching constants:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch constants',
            error: error.message
        });
    }
});

// Cleanup expired announcements (admin only)
router.post('/admin/cleanup', auth.isAdmin, async (req, res) => {
    try {
        const count = await AnnouncementService.cleanupExpiredAnnouncements();

        res.json({
            success: true,
            message: `Cleaned up ${count} expired announcements`,
            count
        });
    } catch (error) {
        console.error('Error cleaning up announcements:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cleanup expired announcements',
            error: error.message
        });
    }
});

module.exports = router;
