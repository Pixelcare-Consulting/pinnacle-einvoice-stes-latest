/**
 * Validation Settings Utility Module
 * Handles validation rules and requirements for invoices and documents
 */

import SettingsUtil from './settings.util.js';

const ValidationSettingsUtil = {
    // Default settings
    defaults: {
        invoice: {
            validateStructure: true,
        validateTaxId: true,
        validateDates: true,
        validateTotals: true,
        validateItems: true,
            validateCustomer: true,
            allowPartialValidation: false,
            rules: {
                minItems: 1,
                maxItems: 100,
                maxAmount: 9999999.99,
                minAmount: 0.01,
                allowNegativeQuantity: false,
                allowZeroAmount: false,
                requireItemCode: true,
                requireDescription: true,
                requireUnitPrice: true,
                requireQuantity: true
            }
        },
        customer: {
            validateCompanyName: true,
            validateTaxId: true,
            validateAddress: true,
            validateContact: true,
        rules: {
                minNameLength: 3,
                maxNameLength: 100,
                requireState: true,
                requirePostcode: true,
                requireCountry: true,
                requireEmail: true,
                requirePhone: true
            }
        },
        dates: {
            allowFutureDate: false,
            maxPastDays: 30,
            validateDueDate: true,
            minDueDays: 0,
            maxDueDays: 90,
            allowWeekends: true,
            allowHolidays: false
        },
        amounts: {
            validateTaxCalculation: true,
            validateDiscounts: true,
            validateRounding: true,
            rules: {
                maxDiscountPercent: 100,
                maxDiscountAmount: 9999999.99,
                roundingPrecision: 2,
                roundingMethod: 'round' // round, ceil, floor
            }
        },
        attachments: {
            enabled: true,
            required: false,
            rules: {
                maxSize: 5, // MB
                allowedTypes: ['pdf', 'jpg', 'png', 'doc', 'docx', 'xls', 'xlsx'],
                maxFiles: 5,
                validateContent: true
            }
        }
    },

    /**
     * Initialize validation settings
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            const settings = await this.loadSettings();
            this.populateForm(settings);
            this.setupEventListeners();
        } catch (error) {
            console.error('Failed to initialize validation settings:', error);
            throw error;
        }
    },

    /**
     * Load validation settings from server
     * @returns {Promise<Object>}
     */
    async loadSettings() {
        try {
            const response = await fetch('/api/settings/validation');
            if (response.status === 404) {
                console.warn('Validation settings endpoint not found, using defaults');
                return this.defaults;
            }
            const data = await SettingsUtil.handleApiResponse(response);
            return data.settings || this.defaults;
        } catch (error) {
            console.warn('Failed to load validation settings, using defaults:', error);
            return this.defaults;
        }
    },

    /**
     * Save validation settings to server
     * @param {Object} settings 
     * @returns {Promise<Object>}
     */
    async saveSettings(settings) {
        const errors = this.validateSettings(settings);
        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }

        const response = await fetch('/api/settings/validation', {
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

        if (settings.invoice?.rules) {
            const rules = settings.invoice.rules;

            if (typeof rules.minItems !== 'number' || rules.minItems < 1) {
                errors.push('Minimum items must be at least 1');
            }

            if (typeof rules.maxItems !== 'number' || rules.maxItems < rules.minItems) {
                errors.push('Maximum items must be greater than minimum items');
            }

            if (typeof rules.maxAmount !== 'number' || rules.maxAmount <= 0) {
                errors.push('Maximum amount must be greater than 0');
            }

            if (typeof rules.minAmount !== 'number' || rules.minAmount < 0) {
                errors.push('Minimum amount cannot be negative');
            }

            if (rules.minAmount >= rules.maxAmount) {
                errors.push('Minimum amount must be less than maximum amount');
            }
        }

        if (settings.customer?.rules) {
            const rules = settings.customer.rules;

            if (typeof rules.minNameLength !== 'number' || rules.minNameLength < 1) {
                errors.push('Minimum name length must be at least 1');
            }

            if (typeof rules.maxNameLength !== 'number' || 
                rules.maxNameLength < rules.minNameLength) {
                errors.push('Maximum name length must be greater than minimum length');
            }
        }

        if (settings.dates) {
            if (typeof settings.dates.maxPastDays !== 'number' || 
                settings.dates.maxPastDays < 0) {
                errors.push('Maximum past days cannot be negative');
            }

            if (settings.dates.validateDueDate) {
                if (typeof settings.dates.minDueDays !== 'number' || 
                    settings.dates.minDueDays < 0) {
                    errors.push('Minimum due days cannot be negative');
                }

                if (typeof settings.dates.maxDueDays !== 'number' || 
                    settings.dates.maxDueDays < settings.dates.minDueDays) {
                    errors.push('Maximum due days must be greater than minimum due days');
                }
            }
        }

        if (settings.amounts?.rules) {
            const rules = settings.amounts.rules;

            if (typeof rules.maxDiscountPercent !== 'number' || 
                rules.maxDiscountPercent < 0 || 
                rules.maxDiscountPercent > 100) {
                errors.push('Maximum discount percentage must be between 0 and 100');
            }

            if (typeof rules.maxDiscountAmount !== 'number' || 
                rules.maxDiscountAmount < 0) {
                errors.push('Maximum discount amount cannot be negative');
            }

            if (typeof rules.roundingPrecision !== 'number' || 
                rules.roundingPrecision < 0 || 
                rules.roundingPrecision > 4) {
                errors.push('Rounding precision must be between 0 and 4');
            }

            if (!['round', 'ceil', 'floor'].includes(rules.roundingMethod)) {
                errors.push('Invalid rounding method');
            }
        }

        if (settings.attachments?.rules) {
            const rules = settings.attachments.rules;

            if (typeof rules.maxSize !== 'number' || rules.maxSize <= 0) {
                errors.push('Maximum attachment size must be greater than 0');
            }

            if (!Array.isArray(rules.allowedTypes) || rules.allowedTypes.length === 0) {
                errors.push('At least one attachment type must be allowed');
            }

            if (typeof rules.maxFiles !== 'number' || rules.maxFiles < 1) {
                errors.push('Maximum number of files must be at least 1');
            }
        }

        return errors;
    },

    /**
     * Setup event listeners for validation settings form
     */
    setupEventListeners() {
        // Invoice validation
        const validateItemsElement = document.getElementById('validateItems');
        if (validateItemsElement) {
            validateItemsElement.addEventListener('change', (e) => {
                const dependentFields = [
                    'minItems', 'maxItems', 'maxAmount', 'minAmount',
                    'allowNegativeQuantity', 'allowZeroAmount', 'requireItemCode',
                    'requireDescription', 'requireUnitPrice', 'requireQuantity'
                ];
                dependentFields.forEach(field => {
                    const element = document.getElementById(field);
                    if (element) {
                        element.disabled = !e.target.checked;
                    }
                });
            });
        }

        // Customer validation
        const validateCustomerElement = document.getElementById('validateCustomer');
        if (validateCustomerElement) {
            validateCustomerElement.addEventListener('change', (e) => {
                const dependentFields = [
                    'minNameLength', 'maxNameLength', 'requireState',
                    'requirePostcode', 'requireCountry', 'requireEmail',
                    'requirePhone'
                ];
                dependentFields.forEach(field => {
                    const element = document.getElementById(field);
                    if (element) {
                        element.disabled = !e.target.checked;
                    }
                });
            });
        }

        // Due date validation
        const validateDueDateElement = document.getElementById('validateDueDate');
        if (validateDueDateElement) {
            validateDueDateElement.addEventListener('change', (e) => {
                const dependentFields = ['minDueDays', 'maxDueDays'];
                dependentFields.forEach(field => {
                    const element = document.getElementById(field);
                    if (element) {
                        element.disabled = !e.target.checked;
                    }
                });
            });
        }

        // Amount validation
        const validateDiscountsElement = document.getElementById('validateDiscounts');
        if (validateDiscountsElement) {
            validateDiscountsElement.addEventListener('change', (e) => {
                const dependentFields = ['maxDiscountPercent', 'maxDiscountAmount'];
                dependentFields.forEach(field => {
                    const element = document.getElementById(field);
                    if (element) {
                        element.disabled = !e.target.checked;
                    }
                });
            });
        }

        // Attachment validation
        const attachmentsEnabledElement = document.getElementById('attachmentsEnabled');
        if (attachmentsEnabledElement) {
            attachmentsEnabledElement.addEventListener('change', (e) => {
                const dependentFields = [
                    'attachmentsRequired', 'maxAttachmentSize', 'allowedTypes',
                    'maxFiles', 'validateContent'
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
            invoice: {
                validateStructure: SettingsUtil.getChecked('validateStructure'),
            validateTaxId: SettingsUtil.getChecked('validateTaxId'),
            validateDates: SettingsUtil.getChecked('validateDates'),
            validateTotals: SettingsUtil.getChecked('validateTotals'),
            validateItems: SettingsUtil.getChecked('validateItems'),
                validateCustomer: SettingsUtil.getChecked('validateCustomer'),
                allowPartialValidation: SettingsUtil.getChecked('allowPartialValidation'),
                rules: {
                    minItems: parseInt(SettingsUtil.getValue('minItems')) || 1,
                    maxItems: parseInt(SettingsUtil.getValue('maxItems')) || 100,
                    maxAmount: parseFloat(SettingsUtil.getValue('maxAmount')) || 9999999.99,
                    minAmount: parseFloat(SettingsUtil.getValue('minAmount')) || 0.01,
                    allowNegativeQuantity: SettingsUtil.getChecked('allowNegativeQuantity'),
                    allowZeroAmount: SettingsUtil.getChecked('allowZeroAmount'),
                    requireItemCode: SettingsUtil.getChecked('requireItemCode'),
                    requireDescription: SettingsUtil.getChecked('requireDescription'),
                    requireUnitPrice: SettingsUtil.getChecked('requireUnitPrice'),
                    requireQuantity: SettingsUtil.getChecked('requireQuantity')
                }
            },
            customer: {
                validateCompanyName: SettingsUtil.getChecked('validateCompanyName'),
                validateTaxId: SettingsUtil.getChecked('validateTaxId'),
                validateAddress: SettingsUtil.getChecked('validateAddress'),
                validateContact: SettingsUtil.getChecked('validateContact'),
            rules: {
                    minNameLength: parseInt(SettingsUtil.getValue('minNameLength')) || 3,
                    maxNameLength: parseInt(SettingsUtil.getValue('maxNameLength')) || 100,
                    requireState: SettingsUtil.getChecked('requireState'),
                    requirePostcode: SettingsUtil.getChecked('requirePostcode'),
                    requireCountry: SettingsUtil.getChecked('requireCountry'),
                    requireEmail: SettingsUtil.getChecked('requireEmail'),
                    requirePhone: SettingsUtil.getChecked('requirePhone')
                }
            },
            dates: {
                allowFutureDate: SettingsUtil.getChecked('allowFutureDate'),
                maxPastDays: parseInt(SettingsUtil.getValue('maxPastDays')) || 30,
                validateDueDate: SettingsUtil.getChecked('validateDueDate'),
                minDueDays: parseInt(SettingsUtil.getValue('minDueDays')) || 0,
                maxDueDays: parseInt(SettingsUtil.getValue('maxDueDays')) || 90,
                allowWeekends: SettingsUtil.getChecked('allowWeekends'),
                allowHolidays: SettingsUtil.getChecked('allowHolidays')
            },
            amounts: {
                validateTaxCalculation: SettingsUtil.getChecked('validateTaxCalculation'),
                validateDiscounts: SettingsUtil.getChecked('validateDiscounts'),
                validateRounding: SettingsUtil.getChecked('validateRounding'),
                rules: {
                    maxDiscountPercent: parseFloat(SettingsUtil.getValue('maxDiscountPercent')) || 100,
                    maxDiscountAmount: parseFloat(SettingsUtil.getValue('maxDiscountAmount')) || 9999999.99,
                    roundingPrecision: parseInt(SettingsUtil.getValue('roundingPrecision')) || 2,
                    roundingMethod: SettingsUtil.getValue('roundingMethod')
                }
            },
            attachments: {
                enabled: SettingsUtil.getChecked('attachmentsEnabled'),
                required: SettingsUtil.getChecked('attachmentsRequired'),
                rules: {
                    maxSize: parseInt(SettingsUtil.getValue('maxAttachmentSize')) || 5,
                    allowedTypes: SettingsUtil.getValue('allowedTypes')
                        .split('\n')
                        .map(type => type.trim().toLowerCase())
                        .filter(type => type),
                    maxFiles: parseInt(SettingsUtil.getValue('maxFiles')) || 5,
                    validateContent: SettingsUtil.getChecked('validateContent')
                }
            }
        };
    },

    /**
     * Populate form with validation settings
     * @param {Object} settings 
     */
    populateForm(settings) {
        // Invoice validation
        if (settings.invoice) {
            SettingsUtil.setChecked('validateStructure', settings.invoice.validateStructure);
            SettingsUtil.setChecked('validateTaxId', settings.invoice.validateTaxId);
            SettingsUtil.setChecked('validateDates', settings.invoice.validateDates);
            SettingsUtil.setChecked('validateTotals', settings.invoice.validateTotals);
            SettingsUtil.setChecked('validateItems', settings.invoice.validateItems);
            SettingsUtil.setChecked('validateCustomer', settings.invoice.validateCustomer);
            SettingsUtil.setChecked('allowPartialValidation', settings.invoice.allowPartialValidation);

            if (settings.invoice.rules) {
                SettingsUtil.setValue('minItems', settings.invoice.rules.minItems);
                SettingsUtil.setValue('maxItems', settings.invoice.rules.maxItems);
                SettingsUtil.setValue('maxAmount', settings.invoice.rules.maxAmount);
                SettingsUtil.setValue('minAmount', settings.invoice.rules.minAmount);
                SettingsUtil.setChecked('allowNegativeQuantity', settings.invoice.rules.allowNegativeQuantity);
                SettingsUtil.setChecked('allowZeroAmount', settings.invoice.rules.allowZeroAmount);
                SettingsUtil.setChecked('requireItemCode', settings.invoice.rules.requireItemCode);
                SettingsUtil.setChecked('requireDescription', settings.invoice.rules.requireDescription);
                SettingsUtil.setChecked('requireUnitPrice', settings.invoice.rules.requireUnitPrice);
                SettingsUtil.setChecked('requireQuantity', settings.invoice.rules.requireQuantity);
            }
        }

        // Customer validation
        if (settings.customer) {
            SettingsUtil.setChecked('validateCompanyName', settings.customer.validateCompanyName);
            SettingsUtil.setChecked('validateTaxId', settings.customer.validateTaxId);
            SettingsUtil.setChecked('validateAddress', settings.customer.validateAddress);
            SettingsUtil.setChecked('validateContact', settings.customer.validateContact);

            if (settings.customer.rules) {
                SettingsUtil.setValue('minNameLength', settings.customer.rules.minNameLength);
                SettingsUtil.setValue('maxNameLength', settings.customer.rules.maxNameLength);
                SettingsUtil.setChecked('requireState', settings.customer.rules.requireState);
                SettingsUtil.setChecked('requirePostcode', settings.customer.rules.requirePostcode);
                SettingsUtil.setChecked('requireCountry', settings.customer.rules.requireCountry);
                SettingsUtil.setChecked('requireEmail', settings.customer.rules.requireEmail);
                SettingsUtil.setChecked('requirePhone', settings.customer.rules.requirePhone);
            }
        }

        // Date validation
        if (settings.dates) {
            SettingsUtil.setChecked('allowFutureDate', settings.dates.allowFutureDate);
            SettingsUtil.setValue('maxPastDays', settings.dates.maxPastDays);
            SettingsUtil.setChecked('validateDueDate', settings.dates.validateDueDate);
            SettingsUtil.setValue('minDueDays', settings.dates.minDueDays);
            SettingsUtil.setValue('maxDueDays', settings.dates.maxDueDays);
            SettingsUtil.setChecked('allowWeekends', settings.dates.allowWeekends);
            SettingsUtil.setChecked('allowHolidays', settings.dates.allowHolidays);
        }

        // Amount validation
        if (settings.amounts) {
            SettingsUtil.setChecked('validateTaxCalculation', settings.amounts.validateTaxCalculation);
            SettingsUtil.setChecked('validateDiscounts', settings.amounts.validateDiscounts);
            SettingsUtil.setChecked('validateRounding', settings.amounts.validateRounding);

            if (settings.amounts.rules) {
                SettingsUtil.setValue('maxDiscountPercent', settings.amounts.rules.maxDiscountPercent);
                SettingsUtil.setValue('maxDiscountAmount', settings.amounts.rules.maxDiscountAmount);
                SettingsUtil.setValue('roundingPrecision', settings.amounts.rules.roundingPrecision);
                SettingsUtil.setValue('roundingMethod', settings.amounts.rules.roundingMethod);
            }
        }

        // Attachment validation
        if (settings.attachments) {
            SettingsUtil.setChecked('attachmentsEnabled', settings.attachments.enabled);
            SettingsUtil.setChecked('attachmentsRequired', settings.attachments.required);

            if (settings.attachments.rules) {
                SettingsUtil.setValue('maxAttachmentSize', settings.attachments.rules.maxSize);
                SettingsUtil.setValue('allowedTypes', settings.attachments.rules.allowedTypes.join('\n'));
                SettingsUtil.setValue('maxFiles', settings.attachments.rules.maxFiles);
                SettingsUtil.setChecked('validateContent', settings.attachments.rules.validateContent);
            }
        }

        // Initialize event listeners
        this.setupEventListeners();
    }
};

export default ValidationSettingsUtil; 