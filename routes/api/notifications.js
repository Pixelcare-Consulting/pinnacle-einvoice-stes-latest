const express = require('express');
const router = express.Router();
const { NotificationService, NOTIFICATION_TYPES, PRIORITY_LEVELS } = require('../../services/notification.service');
const { auth } = require('../../middleware');
const axios = require('axios');

// Get LHDN configuration helper
async function getLHDNConfig() {
    const { PrismaClient } = require('../../src/generated/prisma');
    const prisma = new PrismaClient();

    const config = await prisma.wP_CONFIGURATION.findFirst({
        where: {
            Type: 'LHDN',
            IsActive: true
        },
        orderBy: {
            CreateTS: 'desc'
        }
    });

    if (!config || !config.Settings) {
        throw new Error('LHDN configuration not found');
    }

    let settings = typeof config.Settings === 'string' ? JSON.parse(config.Settings) : config.Settings;

    const baseUrl = settings.environment === 'production'
        ? settings.productionUrl || settings.middlewareUrl
        : settings.sandboxUrl || settings.middlewareUrl;

    if (!baseUrl) {
        throw new Error('LHDN API URL not configured');
    }

    return { ...settings, baseUrl };
}

// Get user notifications
router.get('/', auth.middleware, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const {
            limit = 50,
            offset = 0,
            unreadOnly = false,
            type = null,
            includeGlobal = true
        } = req.query;

        const notifications = await NotificationService.getUserNotifications(userId, {
            limit: parseInt(limit),
            offset: parseInt(offset),
            unreadOnly: unreadOnly === 'true',
            type,
            includeGlobal: includeGlobal === 'true'
        });

        res.json({
            success: true,
            data: notifications,
            count: notifications.length
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch notifications',
            error: error.message
        });
    }
});

// Get unread notification count
router.get('/unread-count', auth.middleware, async (req, res) => {
    try {
        const userId = req.session.user.id;
      //  const count = await NotificationService.getUnreadCount(userId);

        res.json({
            success: true,
            count
        });
    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch unread count',
            error: error.message
        });
    }
});

// Mark notification as read
router.put('/:id/read', auth.middleware, async (req, res) => {
    try {
        const notificationId = parseInt(req.params.id);
        const userId = req.session.user.id;

        await NotificationService.markAsRead(notificationId, userId);

        res.json({
            success: true,
            message: 'Notification marked as read'
        });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark notification as read',
            error: error.message
        });
    }
});

// Mark all notifications as read
router.put('/mark-all-read', auth.middleware, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const result = await NotificationService.markAllAsRead(userId);

        res.json({
            success: true,
            message: 'All notifications marked as read',
            count: result.count
        });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark all notifications as read',
            error: error.message
        });
    }
});

// Create notification (admin only)
router.post('/', auth.isAdmin, async (req, res) => {
    try {
        const {
            title,
            message,
            type = NOTIFICATION_TYPES.SYSTEM,
            priority = PRIORITY_LEVELS.NORMAL,
            targetUserId = null,
            targetRole = null,
            isGlobal = false,
            expiresAt = null
        } = req.body;

        const createdBy = req.session.user.id;

        const notification = await NotificationService.createNotification({
            title,
            message,
            type,
            priority,
            targetUserId,
            targetRole,
            isGlobal,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            createdBy
        });

        res.json({
            success: true,
            data: notification,
            message: 'Notification created successfully'
        });
    } catch (error) {
        console.error('Error creating notification:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create notification',
            error: error.message
        });
    }
});

// Sync LHDN notifications
router.post('/sync-lhdn', auth.middleware, async (req, res) => {
    try {
        const userId = req.session.user.id;

        // Get access token from session
        const accessToken = req.session.accessToken || req.session.lhdn?.accessToken;
        if (!accessToken) {
            return res.status(401).json({
                success: false,
                message: 'LHDN access token not found'
            });
        }

        // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();

        // Sync notifications
        const result = await NotificationService.syncLHDNNotifications(userId, accessToken, lhdnConfig);

        res.json({
            success: true,
            data: result,
            message: `Synced ${result.synced} LHDN notifications`
        });
    } catch (error) {
        console.error('Error syncing LHDN notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to sync LHDN notifications',
            error: error.message
        });
    }
});

// Get LHDN notifications directly from API
router.get('/lhdn-direct', auth.middleware, async (req, res) => {
    try {
        // Get access token from session
        const accessToken = req.session.accessToken || req.session.lhdn?.accessToken;
        if (!accessToken) {
            return res.status(401).json({
                success: false,
                message: 'LHDN access token not found'
            });
        }

        // Get LHDN configuration
        const lhdnConfig = await getLHDNConfig();

        // Fetch notifications directly from LHDN API
        const lhdnNotifications = await NotificationService.fetchLHDNNotifications(accessToken, lhdnConfig);

        res.json({
            success: true,
            data: lhdnNotifications,
            source: 'lhdn_api'
        });
    } catch (error) {
        console.error('Error fetching LHDN notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch LHDN notifications',
            error: error.message
        });
    }
});

// Get notifications from WP_LOGS for current user
router.get('/logs', auth.middleware, async (req, res) => {
    try {
        const { PrismaClient } = require('../../src/generated/prisma');
        const prisma = new PrismaClient();

        const userId = req.session.user.id;
        const username = req.session.user.username;

        const {
            limit = 20,
            offset = 0,
            logType = null
        } = req.query;

        const whereConditions = {
            OR: [
                { UserID: userId },
                { LoggedUser: username }
            ]
        };

        if (logType) {
            whereConditions.LogType = logType;
        }

        const logs = await prisma.wP_LOGS.findMany({
            where: whereConditions,
            orderBy: {
                CreateTS: 'desc'
            },
            take: parseInt(limit),
            skip: parseInt(offset)
        });

        // Convert logs to notification format
        const notifications = logs.map(log => ({
            id: `log_${log.ID}`,
            title: `${log.Module} - ${log.Action}`,
            message: log.Description,
            type: 'system',
            priority: log.LogType === 'ERROR' ? 'high' : 'normal',
            source_type: 'internal',
            source_id: log.ID.toString(),
            created_at: log.CreateTS,
            metadata: {
                logType: log.LogType,
                module: log.Module,
                action: log.Action,
                status: log.Status,
                ipAddress: log.IPAddress
            }
        }));

        res.json({
            success: true,
            data: notifications,
            count: notifications.length,
            source: 'wp_logs'
        });
    } catch (error) {
        console.error('Error fetching log notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch log notifications',
            error: error.message
        });
    }
});

// Get combined notifications (internal + LHDN)
router.get('/combined', auth.middleware, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const {
            limit = 50,
            includeLogNotifications = true,
            includeLHDNSync = true
        } = req.query;

        const results = {
            internal: [],
            lhdn: [],
            logs: [],
            combined: []
        };

        // Get internal notifications
        const internalNotifications = await NotificationService.getUserNotifications(userId, {
            limit: parseInt(limit),
            type: null,
            includeGlobal: true
        });
        results.internal = internalNotifications;

        // Get LHDN notifications if requested
        if (includeLHDNSync === 'true') {
            const lhdnNotifications = await NotificationService.getUserNotifications(userId, {
                limit: parseInt(limit),
                type: NOTIFICATION_TYPES.LHDN,
                includeGlobal: false
            });
            results.lhdn = lhdnNotifications;
        }

        // Get log notifications if requested
        if (includeLogNotifications === 'true') {
            const { PrismaClient } = require('../../src/generated/prisma');
            const prisma = new PrismaClient();

            const username = req.session.user.username;
            const logs = await prisma.wP_LOGS.findMany({
                where: {
                    OR: [
                        { UserID: userId },
                        { LoggedUser: username }
                    ]
                },
                orderBy: {
                    CreateTS: 'desc'
                },
                take: 20
            });

            results.logs = logs.map(log => ({
                id: `log_${log.ID}`,
                title: `${log.Module} - ${log.Action}`,
                message: log.Description,
                type: 'system',
                priority: log.LogType === 'ERROR' ? 'high' : 'normal',
                source_type: 'internal',
                created_at: log.CreateTS,
                metadata: {
                    logType: log.LogType,
                    module: log.Module,
                    action: log.Action,
                    status: log.Status
                }
            }));
        }

        // Combine and sort all notifications
        results.combined = [
            ...results.internal,
            ...results.lhdn,
            ...results.logs
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
         .slice(0, parseInt(limit));

        res.json({
            success: true,
            data: results,
            totalCount: results.combined.length
        });
    } catch (error) {
        console.error('Error fetching combined notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch combined notifications',
            error: error.message
        });
    }
});

module.exports = router;
