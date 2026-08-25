const express = require('express');
const router = express.Router();
const path = require('path');
const prisma = require('../../src/lib/prisma');
const { auth } = require('../../middleware/index-prisma');
const { OutboundLoggingService } = require('../../services/outboundLogging-prisma.service');
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

        const logEntry = await prisma.wP_LOGS.create({
            data: {
                Description,
                LogType,
                Module,
                Action,
                Status,
                LoggedUser,
                UserID,
                IPAddress,
                CreateTS: new Date()
            }
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
router.get('/recent', auth.isApiAuthenticated, async (req, res) => {
  try {
    // Get the most recent 10 logs
    const logs = await prisma.wP_LOGS.findMany({
      orderBy: {
        CreateTS: 'desc'
      },
      take: 10
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
router.get('/', auth.isApiAuthenticated, async (req, res) => {
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

    // Calculate skip value for pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
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
        whereClause.CreateTS.gte = new Date(startDate);
      }

      if (endDate) {
        whereClause.CreateTS.lte = new Date(endDate);
      }
    }

    // Search filter
    if (search) {
      whereClause.OR = [
        { Description: { contains: search } },
        { LoggedUser: { contains: search } },
        { Action: { contains: search } }
      ];
    }

    // Get logs with pagination
    const [logs, count] = await Promise.all([
      prisma.wP_LOGS.findMany({
        where: whereClause,
        orderBy: {
          CreateTS: 'desc'
        },
        take: parseInt(limit),
        skip: skip
      }),
      prisma.wP_LOGS.count({
        where: whereClause
      })
    ]);

    // Calculate total pages
    const totalPages = Math.ceil(count / parseInt(limit));

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

module.exports = router;
