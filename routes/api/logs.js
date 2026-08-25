const express = require('express');
const router = express.Router();
const path = require('path');
const { WP_LOGS } = require('../../models');
const { Op } = require('sequelize');
const { isAuthenticated } = require('../../middleware/auth');
const { OutboundLoggingService } = require('../../services/outboundLogging.service');
const fs = require('fs');
const os = require('os');

// Create log entry
router.post('/', async (req, res) => {
    try {
        const {
            Description,
            LogType,
            Module,
            Action,
            Status
        } = req.body;

        // Get user info from session if available
        const LoggedUser = req.session?.user?.username || 'System';
        const UserID = req.session?.user?.id || null;
        const IPAddress = req.ip;

        const logEntry = await WP_LOGS.create({
            Description,
            LogType,
            Module,
            Action,
            Status,
            LoggedUser,
            UserID,
            IPAddress,
            CreateTS: new Date().toISOString(),
        });

        res.json({
            success: true,
            data: logEntry
        });
    } catch (error) {
        console.error('Error creating log entry:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create log entry'
        });
    }
});

/**
 * @route GET /api/logs/recent
 * @desc Get recent logs for dashboard display
 * @access Private
 */
router.get('/recent', isAuthenticated, async (req, res) => {
  try {
    // Get the most recent 10 logs
    const logs = await WP_LOGS.findAll({
      order: [['CreateTS', 'DESC']],
      limit: 10
    });

    res.json(logs);
  } catch (error) {
    console.error('Error fetching recent logs:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route GET /api/logs
 * @desc Get logs with pagination and filtering
 * @access Private
 */
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      type,
      module,
      startDate,
      endDate,
      search
    } = req.query;

    // Calculate offset
    const offset = (page - 1) * limit;

    // Build where clause
    const whereClause = {};

    if (type) {
      whereClause.LogType = type;
    }

    if (module) {
      whereClause.Module = module;
    }

    // Date range filter
    if (startDate || endDate) {
      whereClause.CreateTS = {};

      if (startDate) {
        whereClause.CreateTS[Op.gte] = new Date(startDate);
      }

      if (endDate) {
        whereClause.CreateTS[Op.lte] = new Date(endDate);
      }
    }

    // Search filter
    if (search) {
      whereClause[Op.or] = [
        { Description: { [Op.like]: `%${search}%` } },
        { LoggedUser: { [Op.like]: `%${search}%` } },
        { Action: { [Op.like]: `%${search}%` } }
      ];
    }

    // Get logs with pagination
    const { count, rows: logs } = await WP_LOGS.findAndCountAll({
      where: whereClause,
      order: [['CreateTS', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Calculate total pages
    const totalPages = Math.ceil(count / limit);

    res.json({
      logs,
      pagination: {
        total: count,
        totalPages,
        currentPage: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * Get outbound logs with filtering
 */
router.get('/outbound', isAuthenticated, async (req, res) => {
    try {
        // Build where clause based on filters
        const whereClause = {};

        // Module filter
        if (req.query.module) {
            whereClause.Module = req.query.module;
        } else {
            // Default to outbound-related modules
            whereClause.Module = {
                [Op.in]: ['OUTBOUND', 'SUBMISSION', 'LHDN']
            };
        }

        // Action filter
        if (req.query.action) {
            whereClause.Action = req.query.action;
        }

        // Status filter
        if (req.query.status) {
            whereClause.Status = req.query.status;
        }

        // Log type filter
        if (req.query.logType) {
            whereClause.LogType = req.query.logType;
        }

        // Date range filter
        if (req.query.startDate && req.query.endDate) {
            whereClause.CreateTS = {
                [Op.between]: [
                    new Date(req.query.startDate),
                    new Date(req.query.endDate)
                ]
            };
        }

        // Search filter
        if (req.query.search) {
            whereClause.Description = {
                [Op.like]: `%${req.query.search}%`
            };
        }

        // Get logs
        const logs = await WP_LOGS.findAll({
            where: whereClause,
            order: [['CreateTS', 'DESC']],
            limit: 500, // Limit to 500 logs
            raw: true
        });

        // Log this request for audit purposes
        await OutboundLoggingService.logAuditEvent(req, 'READ', {
            endpoint: '/api/logs/outbound',
            filters: req.query,
            resultCount: logs.length
        });

        return res.json({
            success: true,
            logs
        });
    } catch (error) {
        console.error('Error fetching outbound logs:', error);

        return res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to fetch logs',
                details: error.message
            }
        });
    }
});

/**
 * Export logs to CSV
 */
router.get('/outbound/export', isAuthenticated, async (req, res) => {
    try {
        // Build where clause based on filters
        const whereClause = {};

        // Module filter
        if (req.query.module) {
            whereClause.Module = req.query.module;
        } else {
            // Default to outbound-related modules
            whereClause.Module = {
                [Op.in]: ['OUTBOUND', 'SUBMISSION', 'LHDN']
            };
        }

        // Action filter
        if (req.query.action) {
            whereClause.Action = req.query.action;
        }

        // Status filter
        if (req.query.status) {
            whereClause.Status = req.query.status;
        }

        // Log type filter
        if (req.query.logType) {
            whereClause.LogType = req.query.logType;
        }

        // Date range filter
        if (req.query.startDate && req.query.endDate) {
            whereClause.CreateTS = {
                [Op.between]: [
                    new Date(req.query.startDate),
                    new Date(req.query.endDate)
                ]
            };
        }

        // Search filter
        if (req.query.search) {
            whereClause.Description = {
                [Op.like]: `%${req.query.search}%`
            };
        }

        // Get logs
        const logs = await WP_LOGS.findAll({
            where: whereClause,
            order: [['CreateTS', 'DESC']],
            limit: 5000, // Limit to 5000 logs for export
            raw: true
        });

        if (logs.length === 0) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'NO_LOGS',
                    message: 'No logs found matching the criteria'
                }
            });
        }

        // Generate CSV content
        const header = 'Timestamp,Description,User,IP Address,Type,Module,Action,Status\n';
        const rows = logs.map(log => {
            return [
                log.CreateTS,
                `"${(log.Description || '').replace(/"/g, '""')}"`,
                log.LoggedUser || 'System',
                log.IPAddress || '',
                log.LogType || '',
                log.Module || '',
                log.Action || '',
                log.Status || ''
            ].join(',');
        }).join('\n');

        const csvContent = header + rows;

        // Create a temporary file
        const tempDir = os.tmpdir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `outbound_logs_${timestamp}.csv`;
        const filePath = path.join(tempDir, fileName);

        // Write to file
        fs.writeFileSync(filePath, csvContent, 'utf8');

        // Log this export for audit purposes
        await OutboundLoggingService.logAuditEvent(req, 'EXPORT', {
            endpoint: '/api/logs/outbound/export',
            filters: req.query,
            resultCount: logs.length,
            fileName
        });

        // Set headers for file download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);

        // Send the file
        res.sendFile(filePath, err => {
            if (err) {
                console.error('Error sending file:', err);
            }

            // Delete the temporary file after sending
            fs.unlink(filePath, unlinkErr => {
                if (unlinkErr) {
                    console.error('Error deleting temporary file:', unlinkErr);
                }
            });
        });
    } catch (error) {
        console.error('Error exporting logs:', error);

        return res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to export logs',
                details: error.message
            }
        });
    }
});

/**
 * Get logs for a specific file
 */
router.get('/outbound/file/:fileName', isAuthenticated, async (req, res) => {
    try {
        const { fileName } = req.params;

        if (!fileName) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_PARAM',
                    message: 'File name is required'
                }
            });
        }

        // Get logs for the file
        const logs = await OutboundLoggingService.getLogsForFile(fileName);

        return res.json({
            success: true,
            logs
        });
    } catch (error) {
        console.error('Error fetching file logs:', error);

        return res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to fetch file logs',
                details: error.message
            }
        });
    }
});

module.exports = router;