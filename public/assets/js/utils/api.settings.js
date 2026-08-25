/**
 * API Settings Utility Module
 * Handles API configuration and rate limiting settings
 */

import SettingsUtil from './settings.util.js';

const APISettingsUtil = {
    // Default settings
    defaults: {
        rateLimit: {
            enabled: true,
            requestsPerMinute: 100,
            burstLimit: 200,
            throttleEnabled: true,
            throttleThreshold: 80 // percentage
        },
        timeout: {
            enabled: true,
            requestTimeout: 30000, // milliseconds
            longRunningTimeout: 300000 // 5 minutes
        },
        retry: {
            enabled: true,
            maxAttempts: 3,
            backoffMultiplier: 2,
            initialDelay: 1000 // milliseconds
        },
        security: {
            requireApiKey: true,
            keyExpiryDays: 90,
            ipWhitelist: [],
            enforceHttps: true,
            corsEnabled: false,
            allowedOrigins: []
        }
    },

    /**
     * Initialize API settings
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            const settings = await this.loadSettings();
            this.populateForm(settings);
            this.setupEventListeners();
        } catch (error) {
            console.error('Failed to initialize API settings:', error);
            throw error;
        }
    },

    /**
     * Load API settings from server
     * @returns {Promise<Object>}
     */
    async loadSettings() {
        try {
            const response = await fetch('/api/settings/api');
            if (response.status === 404) {
                console.warn('API settings endpoint not found, using defaults');
                return this.defaults;
            }
            const data = await SettingsUtil.handleApiResponse(response);
            return data.settings || this.defaults;
        } catch (error) {
            console.warn('Failed to load API settings, using defaults:', error);
            return this.defaults;
        }
    },

    /**
     * Save API settings to server
     * @param {Object} settings 
     * @returns {Promise<Object>}
     */
    async saveSettings(settings) {
        const errors = this.validateSettings(settings);
        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }

        const response = await fetch('/api/settings/api', {
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

        if (settings.rateLimit) {
            if (typeof settings.rateLimit.requestsPerMinute !== 'number' || 
                settings.rateLimit.requestsPerMinute < 1) {
                errors.push('Requests per minute must be at least 1');
            }

            if (typeof settings.rateLimit.burstLimit !== 'number' || 
                settings.rateLimit.burstLimit < settings.rateLimit.requestsPerMinute) {
                errors.push('Burst limit must be greater than or equal to requests per minute');
            }

            if (typeof settings.rateLimit.throttleThreshold !== 'number' || 
                settings.rateLimit.throttleThreshold < 0 || 
                settings.rateLimit.throttleThreshold > 100) {
                errors.push('Throttle threshold must be between 0 and 100');
            }
        }

        if (settings.timeout) {
            if (typeof settings.timeout.requestTimeout !== 'number' || 
                settings.timeout.requestTimeout < 1000) {
                errors.push('Request timeout must be at least 1000ms');
            }

            if (typeof settings.timeout.longRunningTimeout !== 'number' || 
                settings.timeout.longRunningTimeout < settings.timeout.requestTimeout) {
                errors.push('Long running timeout must be greater than request timeout');
            }
        }

        if (settings.retry) {
            if (typeof settings.retry.maxAttempts !== 'number' || 
                settings.retry.maxAttempts < 1) {
                errors.push('Maximum retry attempts must be at least 1');
            }

            if (typeof settings.retry.backoffMultiplier !== 'number' || 
                settings.retry.backoffMultiplier < 1) {
                errors.push('Backoff multiplier must be at least 1');
            }

            if (typeof settings.retry.initialDelay !== 'number' || 
                settings.retry.initialDelay < 100) {
                errors.push('Initial retry delay must be at least 100ms');
            }
        }

        if (settings.security) {
            if (typeof settings.security.keyExpiryDays !== 'number' || 
                settings.security.keyExpiryDays < 1) {
                errors.push('API key expiry days must be at least 1');
            }

            if (settings.security.corsEnabled && 
                (!Array.isArray(settings.security.allowedOrigins) || 
                settings.security.allowedOrigins.length === 0)) {
                errors.push('At least one allowed origin is required when CORS is enabled');
            }
        }

        return errors;
    },

    /**
     * Setup event listeners for API settings form
     */
    setupEventListeners() {
        // Rate limit settings
        const rateLimitEnabledElement = document.getElementById('rateLimitEnabled');
        if (rateLimitEnabledElement) {
            rateLimitEnabledElement.addEventListener('change', (e) => {
                const dependentFields = [
                    'requestsPerMinute', 'burstLimit', 'throttleEnabled',
                    'throttleThreshold'
                ];
                dependentFields.forEach(field => {
                    const element = document.getElementById(field);
                    if (element) {
                        element.disabled = !e.target.checked;
                    }
                });
            });
        }

        // Timeout settings
        const timeoutEnabledElement = document.getElementById('timeoutEnabled');
        if (timeoutEnabledElement) {
            timeoutEnabledElement.addEventListener('change', (e) => {
                const dependentFields = ['requestTimeout', 'longRunningTimeout'];
                dependentFields.forEach(field => {
                    const element = document.getElementById(field);
                    if (element) {
                        element.disabled = !e.target.checked;
                    }
                });
            });
        }

        // Retry settings
        const retryEnabledElement = document.getElementById('retryEnabled');
        if (retryEnabledElement) {
            retryEnabledElement.addEventListener('change', (e) => {
                const dependentFields = ['maxAttempts', 'backoffMultiplier', 'initialDelay'];
                dependentFields.forEach(field => {
                    const element = document.getElementById(field);
                    if (element) {
                        element.disabled = !e.target.checked;
                    }
                });
            });
        }

        // CORS settings
        const corsEnabledElement = document.getElementById('corsEnabled');
        if (corsEnabledElement) {
            corsEnabledElement.addEventListener('change', (e) => {
                const allowedOriginsElement = document.getElementById('allowedOrigins');
                if (allowedOriginsElement) {
                    allowedOriginsElement.disabled = !e.target.checked;
                }
            });
        }
    },

    /**
     * Get current settings from form
     * @returns {Object}
     */
    getFormSettings() {
        return {
            rateLimit: {
                enabled: SettingsUtil.getChecked('rateLimitEnabled'),
                requestsPerMinute: parseInt(SettingsUtil.getValue('requestsPerMinute')) || 100,
                burstLimit: parseInt(SettingsUtil.getValue('burstLimit')) || 200,
                throttleEnabled: SettingsUtil.getChecked('throttleEnabled'),
                throttleThreshold: parseInt(SettingsUtil.getValue('throttleThreshold')) || 80
            },
            timeout: {
                enabled: SettingsUtil.getChecked('timeoutEnabled'),
                requestTimeout: parseInt(SettingsUtil.getValue('requestTimeout')) || 30000,
                longRunningTimeout: parseInt(SettingsUtil.getValue('longRunningTimeout')) || 300000
            },
            retry: {
                enabled: SettingsUtil.getChecked('retryEnabled'),
                maxAttempts: parseInt(SettingsUtil.getValue('maxAttempts')) || 3,
                backoffMultiplier: parseFloat(SettingsUtil.getValue('backoffMultiplier')) || 2,
                initialDelay: parseInt(SettingsUtil.getValue('initialDelay')) || 1000
            },
            security: {
                requireApiKey: SettingsUtil.getChecked('requireApiKey'),
                keyExpiryDays: parseInt(SettingsUtil.getValue('keyExpiryDays')) || 90,
                ipWhitelist: SettingsUtil.getValue('ipWhitelist')
                    .split('\n')
                    .map(ip => ip.trim())
                    .filter(ip => ip),
                enforceHttps: SettingsUtil.getChecked('enforceHttps'),
                corsEnabled: SettingsUtil.getChecked('corsEnabled'),
                allowedOrigins: SettingsUtil.getValue('allowedOrigins')
                    .split('\n')
                    .map(origin => origin.trim())
                    .filter(origin => origin)
            }
        };
    },

    /**
     * Populate form with API settings
     * @param {Object} settings 
     */
    populateForm(settings) {
        // Rate limit settings
        if (settings.rateLimit) {
            SettingsUtil.setChecked('rateLimitEnabled', settings.rateLimit.enabled);
            SettingsUtil.setValue('requestsPerMinute', settings.rateLimit.requestsPerMinute);
            SettingsUtil.setValue('burstLimit', settings.rateLimit.burstLimit);
            SettingsUtil.setChecked('throttleEnabled', settings.rateLimit.throttleEnabled);
            SettingsUtil.setValue('throttleThreshold', settings.rateLimit.throttleThreshold);
        }

        // Timeout settings
        if (settings.timeout) {
            SettingsUtil.setChecked('timeoutEnabled', settings.timeout.enabled);
            SettingsUtil.setValue('requestTimeout', settings.timeout.requestTimeout);
            SettingsUtil.setValue('longRunningTimeout', settings.timeout.longRunningTimeout);
        }

        // Retry settings
        if (settings.retry) {
            SettingsUtil.setChecked('retryEnabled', settings.retry.enabled);
            SettingsUtil.setValue('maxAttempts', settings.retry.maxAttempts);
            SettingsUtil.setValue('backoffMultiplier', settings.retry.backoffMultiplier);
            SettingsUtil.setValue('initialDelay', settings.retry.initialDelay);
        }

        // Security settings
        if (settings.security) {
            SettingsUtil.setChecked('requireApiKey', settings.security.requireApiKey);
            SettingsUtil.setValue('keyExpiryDays', settings.security.keyExpiryDays);
            SettingsUtil.setValue('ipWhitelist', settings.security.ipWhitelist.join('\n'));
            SettingsUtil.setChecked('enforceHttps', settings.security.enforceHttps);
            SettingsUtil.setChecked('corsEnabled', settings.security.corsEnabled);
            SettingsUtil.setValue('allowedOrigins', settings.security.allowedOrigins.join('\n'));
        }

        // Initialize dependent fields
        this.setupEventListeners();
    }
};

export default APISettingsUtil; 