const express = require('express');
const router = express.Router();
const { auth } = require('../../middleware');
const { LoggingService, MODULES, ACTIONS, STATUS } = require('../../services/logging-prisma.service');
const excel = require('exceljs');
const prisma = require('../../src/lib/prisma');

/**
 * @route GET /api/logs/recent
 * @desc Get recent logs for dashboard display
 * @access Private
 */
router.get('/recent', async (req, res) => {
  try {
    // Get the most recent 10 logs using Prisma
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

// Get audit logs with filtering and pagination
router.get('/audit', auth.isAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      startDate,
      endDate,
      username,
      module,
      action,
      status
    } = req.query;

    const result = await LoggingService.getAuditLogs({
      page: parseInt(page),
      limit: parseInt(limit),
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      username,
      module,
      action,
      status
    });

    // Log this audit log view
    await LoggingService.log({
      description: 'Viewed audit logs',
      username: req.session.user.username,
      userId: req.session.user.id,
      ipAddress: req.ip,
      module: MODULES.AUDIT,
      action: ACTIONS.READ,
      status: STATUS.SUCCESS
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);

    await LoggingService.log({
      description: 'Failed to view audit logs',
      username: req.session?.user?.username || 'Unknown',
      userId: req.session?.user?.id,
      ipAddress: req.ip,
      module: MODULES.AUDIT,
      action: ACTIONS.READ,
      status: STATUS.ERROR,
      details: { error: error.message }
    });

    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit logs'
    });
  }
});

// Export audit logs
router.get('/audit/export', auth.isAdmin, async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      username,
      module,
      action,
      status
    } = req.query;

    const logs = await LoggingService.exportAuditLogs({
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      username,
      module,
      action,
      status
    });

    // Create Excel workbook
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Audit Logs');

    // Add headers
    worksheet.columns = [
      { header: 'Timestamp', key: 'timestamp', width: 20 },
      { header: 'User', key: 'user', width: 20 },
      { header: 'Module', key: 'module', width: 15 },
      { header: 'Action', key: 'action', width: 15 },
      { header: 'Status', key: 'status', width: 10 },
      { header: 'Description', key: 'description', width: 50 },
      { header: 'IP Address', key: 'ipAddress', width: 15 },
      { header: 'Details', key: 'details', width: 30 }
    ];

    // Add data
    logs.forEach(log => {
      worksheet.addRow({
        timestamp: log.CreateTS,
        user: log.LoggedUser,
        module: log.Module,
        action: log.Action,
        status: log.Status,
        description: log.Description,
        ipAddress: log.IPAddress,
        details: log.Details
      });
    });

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Log the export
    await LoggingService.log({
      description: 'Exported audit logs',
      username: req.session.user.username,
      userId: req.session.user.id,
      ipAddress: req.ip,
      module: MODULES.AUDIT,
      action: ACTIONS.EXPORT,
      status: STATUS.SUCCESS,
      details: {
        filters: { startDate, endDate, username, module, action, status },
        recordCount: logs.length
      }
    });

    // Set response headers
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=audit_logs_${new Date().toISOString().split('T')[0]}.xlsx`
    );

    // Send workbook
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Error exporting audit logs:', error);

    await LoggingService.log({
      description: 'Failed to export audit logs',
      username: req.session?.user?.username || 'Unknown',
      userId: req.session?.user?.id,
      ipAddress: req.ip,
      module: MODULES.AUDIT,
      action: ACTIONS.EXPORT,
      status: STATUS.ERROR,
      details: { error: error.message }
    });

    res.status(500).json({
      success: false,
      message: 'Failed to export audit logs'
    });
  }
});

// Get audit log statistics
router.get('/audit/stats', auth.isAdmin, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = {
      todayCount: await LoggingService.getAuditLogs({
        startDate: today,
        endDate: new Date()
      }).then(result => result.total),

      totalCount: await LoggingService.getAuditLogs({}).then(result => result.total),

      errorCount: await LoggingService.getAuditLogs({
        status: STATUS.ERROR
      }).then(result => result.total),

      warningCount: await LoggingService.getAuditLogs({
        status: STATUS.WARNING
      }).then(result => result.total)
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching audit log statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit log statistics'
    });
  }
});

module.exports = router;