/**
 * Logging & Monitoring Settings Utility Module
 * Handles audit trail and error tracking settings
 */

import SettingsUtil from './settings.util.js';

const LoggingSettingsUtil = {
    // Default settings
    defaults: {
        auditTrail: {
            enabled: true,
            logChanges: true,
            logAccess: true,
            retentionDays: 90,
            detailedLogging: true,
            logUserActions: true
        },
        monitoring: {
            enabled: true,
            monitorPerformance: true,
            monitorQuota: true,
            alertThreshold: 80, // percentage
            responseTimeThreshold: 5000, // milliseconds
            errorRateThreshold: 5 // percentage
        },
        notifications: {
            enabled: true,
            notifyErrors: true,
            notifyWarnings: true,
            notifyQuota: true,
            notifyEmails: [],
            notificationDelay: 5 // minutes
        }
    },

    /**
     * Initialize logging settings
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            const settings = await this.loadSettings();
            this.populateForm(settings);
            this.setupEventListeners();
        } catch (error) {
            console.error('Failed to initialize logging settings:', error);
            throw error;
        }
    },

    /**
     * Load logging settings from server
     * @returns {Promise<Object>}
     */
    async loadSettings() {
        try {
            const response = await fetch('/api/logging/settings');
            if (response.status === 404) {
                console.warn('Logging settings endpoint not found, using defaults');
                return this.defaults;
            }
            const data = await SettingsUtil.handleApiResponse(response);
            return data.settings || this.defaults;
        } catch (error) {
            console.warn('Failed to load logging settings, using defaults:', error);
            return this.defaults;
        }
    },

    /**
     * Save logging settings to server
     * @param {Object} settings 
     * @returns {Promise<Object>}
     */
    async saveSettings(settings) {
        const errors = this.validateSettings(settings);
        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }

        const response = await fetch('/api/logging/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        return SettingsUtil.handleApiResponse(response);
    },

    /**
     * Validate settings object
     * @param {Object} settings 
     * @returns {Array<string>} Array of error messages
     */
    validateSettings(settings) {
        const errors = [];

        if (settings.auditTrail) {
            if (typeof settings.auditTrail.retentionDays !== 'number' || settings.auditTrail.retentionDays < 1) {
                errors.push('Audit trail retention days must be at least 1');
            }
        }

        if (settings.monitoring) {
            if (typeof settings.monitoring.alertThreshold !== 'number' || 
                settings.monitoring.alertThreshold < 0 || 
                settings.monitoring.alertThreshold > 100) {
                errors.push('Alert threshold must be between 0 and 100');
            }

            if (typeof settings.monitoring.responseTimeThreshold !== 'number' || 
                settings.monitoring.responseTimeThreshold < 0) {
                errors.push('Response time threshold must be a positive number');
            }

            if (typeof settings.monitoring.errorRateThreshold !== 'number' || 
                settings.monitoring.errorRateThreshold < 0 || 
                settings.monitoring.errorRateThreshold > 100) {
                errors.push('Error rate threshold must be between 0 and 100');
            }
        }

        if (settings.notifications) {
            if (typeof settings.notifications.notificationDelay !== 'number' || 
                settings.notifications.notificationDelay < 1) {
                errors.push('Notification delay must be at least 1 minute');
            }

            if (settings.notifications.enabled && settings.notifications.notifyEmails.length === 0) {
                errors.push('At least one notification email is required when notifications are enabled');
            }
        }

        return errors;
    },

    /**
     * Setup event listeners for logging settings form
     */
    setupEventListeners() {
        // Audit trail settings
        const auditTrailEnabledElement = document.getElementById('auditTrailEnabled');
        if (auditTrailEnabledElement) {
            auditTrailEnabledElement.addEventListener('change', (e) => {
                const dependentFields = ['logChanges', 'logAccess', 'retentionDays', 'detailedLogging', 'logUserActions'];
                dependentFields.forEach(field => {
                    const element = document.getElementById(field);
                    if (element) {
                        element.disabled = !e.target.checked;
                    }
                });
            });
        }

        // Monitoring settings
        const monitoringEnabledElement = document.getElementById('monitoringEnabled');
        if (monitoringEnabledElement) {
            monitoringEnabledElement.addEventListener('change', (e) => {
                const dependentFields = [
                    'monitorPerformance', 'monitorQuota', 'alertThreshold',
                    'responseTimeThreshold', 'errorRateThreshold'
                ];
                dependentFields.forEach(field => {
                    const element = document.getElementById(field);
                    if (element) {
                        element.disabled = !e.target.checked;
                    }
                });
            });
        }

        // Notification settings
        const notificationsEnabledElement = document.getElementById('notificationsEnabled');
        if (notificationsEnabledElement) {
            notificationsEnabledElement.addEventListener('change', (e) => {
                const dependentFields = [
                    'notifyErrors', 'notifyWarnings', 'notifyQuota',
                    'notifyEmails', 'notificationDelay'
                ];
                dependentFields.forEach(field => {
                    const element = document.getElementById(field);
                    if (element) {
                        element.disabled = !e.target.checked;
                    }
                });
            });
        }
    },

    /**
     * Get current settings from form
     * @returns {Object}
     */
    getFormSettings() {
        return {
            auditTrail: {
                enabled: SettingsUtil.getChecked('auditTrailEnabled'),
                logChanges: SettingsUtil.getChecked('logChanges'),
                logAccess: SettingsUtil.getChecked('logAccess'),
                retentionDays: parseInt(SettingsUtil.getValue('retentionDays')) || 90,
                detailedLogging: SettingsUtil.getChecked('detailedLogging'),
                logUserActions: SettingsUtil.getChecked('logUserActions')
            },
            monitoring: {
                enabled: SettingsUtil.getChecked('monitoringEnabled'),
                monitorPerformance: SettingsUtil.getChecked('monitorPerformance'),
                monitorQuota: SettingsUtil.getChecked('monitorQuota'),
                alertThreshold: parseInt(SettingsUtil.getValue('alertThreshold')) || 80,
                responseTimeThreshold: parseInt(SettingsUtil.getValue('responseTimeThreshold')) || 5000,
                errorRateThreshold: parseInt(SettingsUtil.getValue('errorRateThreshold')) || 5
            },
            notifications: {
                enabled: SettingsUtil.getChecked('notificationsEnabled'),
                notifyErrors: SettingsUtil.getChecked('notifyErrors'),
                notifyWarnings: SettingsUtil.getChecked('notifyWarnings'),
                notifyQuota: SettingsUtil.getChecked('notifyQuota'),
                notifyEmails: SettingsUtil.getValue('notifyEmails')
                    .split('\n')
                    .map(email => email.trim())
                    .filter(email => email),
                notificationDelay: parseInt(SettingsUtil.getValue('notificationDelay')) || 5
            }
        };
    },

    /**
     * Populate form with logging settings
     * @param {Object} settings 
     */
    populateForm(settings) {
        // Audit trail settings
        if (settings.auditTrail) {
            SettingsUtil.setChecked('auditTrailEnabled', settings.auditTrail.enabled);
            SettingsUtil.setChecked('logChanges', settings.auditTrail.logChanges);
            SettingsUtil.setChecked('logAccess', settings.auditTrail.logAccess);
            SettingsUtil.setValue('retentionDays', settings.auditTrail.retentionDays);
            SettingsUtil.setChecked('detailedLogging', settings.auditTrail.detailedLogging);
            SettingsUtil.setChecked('logUserActions', settings.auditTrail.logUserActions);
        }

        // Monitoring settings
        if (settings.monitoring) {
            SettingsUtil.setChecked('monitoringEnabled', settings.monitoring.enabled);
            SettingsUtil.setChecked('monitorPerformance', settings.monitoring.monitorPerformance);
            SettingsUtil.setChecked('monitorQuota', settings.monitoring.monitorQuota);
            SettingsUtil.setValue('alertThreshold', settings.monitoring.alertThreshold);
            SettingsUtil.setValue('responseTimeThreshold', settings.monitoring.responseTimeThreshold);
            SettingsUtil.setValue('errorRateThreshold', settings.monitoring.errorRateThreshold);
        }

        // Notification settings
        if (settings.notifications) {
            SettingsUtil.setChecked('notificationsEnabled', settings.notifications.enabled);
            SettingsUtil.setChecked('notifyErrors', settings.notifications.notifyErrors);
            SettingsUtil.setChecked('notifyWarnings', settings.notifications.notifyWarnings);
            SettingsUtil.setChecked('notifyQuota', settings.notifications.notifyQuota);
            SettingsUtil.setValue('notifyEmails', settings.notifications.notifyEmails.join('\n'));
            SettingsUtil.setValue('notificationDelay', settings.notifications.notificationDelay);
        }

        // Initialize dependent fields
        this.setupEventListeners();
    }
};

export default LoggingSettingsUtil; 