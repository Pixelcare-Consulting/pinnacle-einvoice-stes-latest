const express = require('express');
const router = express.Router();
const AdminSettingsService = require('../../services/adminSettings.service');
const { auth } = require('../../middleware');
const prisma = require('../../src/lib/prisma');

// Get all settings with pagination and filtering
router.get('/settings', auth.isAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const filter = {
      group: req.query.group,
      search: req.query.search
    };

    const result = await AdminSettingsService.getAllSettings(page, limit, filter);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error fetching admin settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin settings'
    });
  }
});

// Get settings by group
router.get('/settings/:group', auth.isAdmin, async (req, res) => {
  try {
    const settings = await AdminSettingsService.getSettingsByGroup(req.params.group);
    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Error fetching settings group:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings group'
    });
  }
});

// Get a single setting
router.get('/settings/key/:key', auth.isAdmin, async (req, res) => {
  try {
    const value = await AdminSettingsService.getSetting(req.params.key);
    res.json({
      success: true,
      data: value
    });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch setting'
    });
  }
});

// Create or update a setting
router.post('/settings', auth.isAdmin, async (req, res) => {
  try {
    const { key, value, group, description } = req.body;

    if (!key || !group) {
      return res.status(400).json({
        success: false,
        message: 'Key and group are required'
      });
    }

    const setting = await AdminSettingsService.upsertSetting(
      key,
      value,
      group,
      description,
      req.user.id
    );

    // Log the action
    await prisma.wP_LOGS.create({
      data: {
        Description: `Admin ${req.user.Username} updated setting: ${key}`,
        CreateTS: new Date().toISOString(),
        LoggedUser: req.user.Username,
        LogType: 'INFO',
        Module: 'ADMIN_SETTINGS',
        Action: 'UPDATE',
        Status: 'SUCCESS'
      }
    });

    res.json({
      success: true,
      data: setting,
      message: 'Setting saved successfully'
    });
  } catch (error) {
    console.error('Error saving setting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save setting'
    });
  }
});

// Bulk update settings
router.post('/settings/bulk', auth.isAdmin, async (req, res) => {
  try {
    const { settings } = req.body;

    if (!Array.isArray(settings)) {
      return res.status(400).json({
        success: false,
        message: 'Settings must be an array'
      });
    }

    const result = await AdminSettingsService.bulkUpsertSettings(settings, req.user.id);

    // Log the action
    await prisma.wP_LOGS.create({
      data: {
        Description: `Admin ${req.user.Username} performed bulk settings update`,
        CreateTS: new Date().toISOString(),
        LoggedUser: req.user.Username,
        LogType: 'INFO',
        Module: 'ADMIN_SETTINGS',
        Action: 'BULK_UPDATE',
        Status: 'SUCCESS'
      }
    });


    res.json({
      success: true,
      data: result,
      message: 'Settings updated successfully'
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update settings'
    });
  }
});

// Initialize default settings
router.post('/settings/initialize', auth.isAdmin, async (req, res) => {
  try {
    await AdminSettingsService.initializeDefaultSettings(req.user.id);

    // Log the action
    await prisma.wP_LOGS.create({
      data: {
        Description: `Admin ${req.user.Username} initialized default settings`,
        CreateTS: new Date().toISOString(),
        LoggedUser: req.user.Username,
        LogType: 'INFO',
        Module: 'ADMIN_SETTINGS',
        Action: 'INITIALIZE',
        Status: 'SUCCESS'
      }
    });

    res.json({
      success: true,
      message: 'Default settings initialized successfully'
    });
  } catch (error) {
    console.error('Error initializing settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize settings'
    });
  }
});

module.exports = router;