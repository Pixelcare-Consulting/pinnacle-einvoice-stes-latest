/**
 * Invoice Settings Utility Module
 * Handles invoice configuration and formatting settings
 */

import SettingsUtil from './settings.util.js';

const InvoiceSettingsUtil = {
    // Default settings
    defaults: {
        general: {
            defaultCurrency: 'MYR',
        taxRate: 6,
            roundingMethod: 'round', // round, ceil, floor
            decimalPlaces: 2,
            showCents: true
        },
        numbering: {
            format: 'INV-{YYYY}-{MM}-{0000}',
            prefix: 'INV',
            startNumber: 1,
            yearFormat: 'YYYY',
            monthFormat: 'MM',
            separator: '-',
            autoIncrement: true,
            resetMonthly: false
        },
        display: {
            showLogo: true,
            showCompanyDetails: true,
            showCustomerDetails: true,
            showTaxDetails: true,
            showPaymentDetails: true,
            showFooter: true,
            showWatermark: false
        },
        content: {
            headerNotes: '',
            footerNotes: '',
            termsAndConditions: '',
            paymentInstructions: '',
            bankDetails: {
                bankName: '',
                accountName: '',
                accountNumber: '',
                swiftCode: ''
            }
        },
        email: {
            sendCopy: true,
            defaultSubject: 'Invoice from {COMPANY_NAME} - {INVOICE_NUMBER}',
            defaultMessage: 'Dear {CUSTOMER_NAME},\n\nPlease find attached invoice {INVOICE_NUMBER} for your reference.\n\nBest regards,\n{COMPANY_NAME}',
            ccEmails: [],
            attachFormat: 'pdf' // pdf, html
        },
        lhdn: {
            enabled: true,
            autoSubmit: false,
            submitDelay: 5, // minutes
            validateBeforeSubmit: true,
            storeResponses: true,
            allowedTaxCodes: [],
            businessProcesses: {
                invoice: true,
                creditNote: true,
                debitNote: true
            }
        }
    },

    /**
     * Initialize invoice settings
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            const settings = await this.loadSettings();
            this.populateForm(settings);
            this.setupEventListeners();
        } catch (error) {
            console.error('Failed to initialize invoice settings:', error);
            throw error;
        }
    },

    /**
     * Load invoice settings from server
     * @returns {Promise<Object>}
     */
    async loadSettings() {
        try {
            const response = await fetch('/api/settings/invoice');
            if (response.status === 404) {
                console.warn('Invoice settings endpoint not found, using defaults');
                return this.defaults;
            }
            const data = await SettingsUtil.handleApiResponse(response);
            return data.settings || this.defaults;
        } catch (error) {
            console.warn('Failed to load invoice settings, using defaults:', error);
            return this.defaults;
        }
    },

    /**
     * Save invoice settings to server
     * @param {Object} settings 
     * @returns {Promise<Object>}
     */
    async saveSettings(settings) {
        const errors = this.validateSettings(settings);
        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }

        const response = await fetch('/api/settings/invoice', {
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

        if (settings.general) {
            if (!settings.general.defaultCurrency?.trim()) {
            errors.push('Default currency is required');
        }

            if (typeof settings.general.taxRate !== 'number' || 
                settings.general.taxRate < 0 || 
                settings.general.taxRate > 100) {
                errors.push('Tax rate must be between 0 and 100');
            }

            if (!['round', 'ceil', 'floor'].includes(settings.general.roundingMethod)) {
                errors.push('Invalid rounding method');
            }

            if (typeof settings.general.decimalPlaces !== 'number' || 
                settings.general.decimalPlaces < 0 || 
                settings.general.decimalPlaces > 4) {
                errors.push('Decimal places must be between 0 and 4');
            }
        }

        if (settings.numbering) {
            if (!settings.numbering.format?.trim()) {
            errors.push('Invoice number format is required');
        }

            if (!settings.numbering.prefix?.trim()) {
                errors.push('Invoice number prefix is required');
            }

            if (typeof settings.numbering.startNumber !== 'number' || 
                settings.numbering.startNumber < 1) {
                errors.push('Start number must be greater than 0');
            }
        }

        if (settings.content?.bankDetails) {
            if (settings.content.bankDetails.bankName && 
                !settings.content.bankDetails.accountNumber) {
                errors.push('Bank account number is required when bank name is provided');
            }

            if (settings.content.bankDetails.accountNumber && 
                !settings.content.bankDetails.accountName) {
                errors.push('Account name is required when account number is provided');
            }
        }

        if (settings.email) {
            if (settings.email.ccEmails) {
                for (const email of settings.email.ccEmails) {
                    if (!this.isValidEmail(email)) {
                        errors.push(`Invalid CC email format: ${email}`);
                    }
                }
            }

            if (!['pdf', 'html'].includes(settings.email.attachFormat)) {
                errors.push('Invalid attachment format');
            }
        }

        if (settings.lhdn) {
            if (settings.lhdn.enabled) {
                if (settings.lhdn.autoSubmit && 
                    (typeof settings.lhdn.submitDelay !== 'number' || 
                    settings.lhdn.submitDelay < 1)) {
                    errors.push('Submit delay must be at least 1 minute');
                }

                if (!Array.isArray(settings.lhdn.allowedTaxCodes) || 
                    settings.lhdn.allowedTaxCodes.length === 0) {
                    errors.push('At least one tax code must be selected');
                }

                if (!Object.values(settings.lhdn.businessProcesses).some(v => v)) {
                    errors.push('At least one business process must be enabled');
                }
            }
        }

        return errors;
    },

    /**
     * Setup event listeners for invoice settings form
     */
    setupEventListeners() {
        // Numbering format preview
        const updateNumberingPreview = () => {
            const previewElement = document.getElementById('numberingPreview');
            if (!previewElement) return; // Skip if element doesn't exist

            const format = SettingsUtil.getValue('numberingFormat') || 'INV-{YYYY}-{MM}-{0000}';
            const prefix = SettingsUtil.getValue('numberingPrefix') || 'INV';
            const yearFormat = SettingsUtil.getValue('yearFormat') || 'YYYY';
            const monthFormat = SettingsUtil.getValue('monthFormat') || 'MM';
            const separator = SettingsUtil.getValue('numberingSeparator') || '-';
            const startNumber = parseInt(SettingsUtil.getValue('startNumber')) || 1;

            const now = new Date();
            const year = now.getFullYear().toString();
            const month = (now.getMonth() + 1).toString().padStart(2, '0');
            const number = startNumber.toString().padStart(4, '0');

            let preview = format
                .replace('{PREFIX}', prefix)
                .replace('{YYYY}', year)
                .replace('{YY}', year.slice(-2))
                .replace('{MM}', month)
                .replace('{M}', month.replace(/^0/, ''))
                .replace('{0000}', number)
                .replace(/-+/g, separator);

            previewElement.textContent = preview;
        };

        // Add event listeners only if elements exist
        ['numberingFormat', 'numberingPrefix', 'yearFormat', 'monthFormat', 
         'numberingSeparator', 'startNumber'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('input', updateNumberingPreview);
            }
        });

        // Bank details
        const bankNameElement = document.getElementById('bankName');
        if (bankNameElement) {
            bankNameElement.addEventListener('input', (e) => {
                const accountFields = ['accountName', 'accountNumber', 'swiftCode'];
                accountFields.forEach(field => {
                    const element = document.getElementById(field);
                    if (element) {
                        element.required = e.target.value.trim() !== '';
                    }
                });
            });
        }

        // LHDN settings
        const lhdnEnabledElement = document.getElementById('lhdnEnabled');
        if (lhdnEnabledElement) {
            lhdnEnabledElement.addEventListener('change', (e) => {
                const dependentFields = [
                    'autoSubmit', 'submitDelay', 'validateBeforeSubmit',
                    'storeResponses', 'allowedTaxCodes', 'businessProcessInvoice',
                    'businessProcessCreditNote', 'businessProcessDebitNote'
                ];
                dependentFields.forEach(field => {
                    const element = document.getElementById(field);
                    if (element) {
                        element.disabled = !e.target.checked;
                    }
                });
            });
        }

        // Auto submit settings
        const autoSubmitElement = document.getElementById('autoSubmit');
        if (autoSubmitElement) {
            autoSubmitElement.addEventListener('change', (e) => {
                const submitDelayElement = document.getElementById('submitDelay');
                if (submitDelayElement) {
                    submitDelayElement.disabled = !e.target.checked;
                }
            });
        }

        // Initialize preview if element exists
        if (document.getElementById('numberingPreview')) {
            updateNumberingPreview();
        }
    },

    /**
     * Get current settings from form
     * @returns {Object}
     */
    getFormSettings() {
        return {
            general: {
                defaultCurrency: SettingsUtil.getValue('defaultCurrency'),
            taxRate: parseFloat(SettingsUtil.getValue('taxRate')) || 0,
                roundingMethod: SettingsUtil.getValue('roundingMethod'),
                decimalPlaces: parseInt(SettingsUtil.getValue('decimalPlaces')) || 2,
                showCents: SettingsUtil.getChecked('showCents')
            },
            numbering: {
                format: SettingsUtil.getValue('numberingFormat'),
                prefix: SettingsUtil.getValue('numberingPrefix'),
                startNumber: parseInt(SettingsUtil.getValue('startNumber')) || 1,
                yearFormat: SettingsUtil.getValue('yearFormat'),
                monthFormat: SettingsUtil.getValue('monthFormat'),
                separator: SettingsUtil.getValue('numberingSeparator'),
                autoIncrement: SettingsUtil.getChecked('autoIncrement'),
                resetMonthly: SettingsUtil.getChecked('resetMonthly')
            },
            display: {
                showLogo: SettingsUtil.getChecked('showLogo'),
                showCompanyDetails: SettingsUtil.getChecked('showCompanyDetails'),
                showCustomerDetails: SettingsUtil.getChecked('showCustomerDetails'),
                showTaxDetails: SettingsUtil.getChecked('showTaxDetails'),
                showPaymentDetails: SettingsUtil.getChecked('showPaymentDetails'),
                showFooter: SettingsUtil.getChecked('showFooter'),
                showWatermark: SettingsUtil.getChecked('showWatermark')
            },
            content: {
                headerNotes: SettingsUtil.getValue('headerNotes'),
                footerNotes: SettingsUtil.getValue('footerNotes'),
                termsAndConditions: SettingsUtil.getValue('termsAndConditions'),
                paymentInstructions: SettingsUtil.getValue('paymentInstructions'),
                bankDetails: {
                    bankName: SettingsUtil.getValue('bankName'),
                    accountName: SettingsUtil.getValue('accountName'),
                    accountNumber: SettingsUtil.getValue('accountNumber'),
                    swiftCode: SettingsUtil.getValue('swiftCode')
                }
            },
            email: {
                sendCopy: SettingsUtil.getChecked('sendCopy'),
                defaultSubject: SettingsUtil.getValue('defaultSubject'),
                defaultMessage: SettingsUtil.getValue('defaultMessage'),
                ccEmails: SettingsUtil.getValue('ccEmails')
                    .split('\n')
                    .map(email => email.trim())
                    .filter(email => email),
                attachFormat: SettingsUtil.getValue('attachFormat')
            },
            lhdn: {
                enabled: SettingsUtil.getChecked('lhdnEnabled'),
                autoSubmit: SettingsUtil.getChecked('autoSubmit'),
                submitDelay: parseInt(SettingsUtil.getValue('submitDelay')) || 5,
                validateBeforeSubmit: SettingsUtil.getChecked('validateBeforeSubmit'),
                storeResponses: SettingsUtil.getChecked('storeResponses'),
                allowedTaxCodes: SettingsUtil.getValue('allowedTaxCodes')
                    .split('\n')
                    .map(code => code.trim())
                    .filter(code => code),
                businessProcesses: {
                    invoice: SettingsUtil.getChecked('businessProcessInvoice'),
                    creditNote: SettingsUtil.getChecked('businessProcessCreditNote'),
                    debitNote: SettingsUtil.getChecked('businessProcessDebitNote')
                }
            }
        };
    },

    /**
     * Populate form with invoice settings
     * @param {Object} settings 
     */
    populateForm(settings) {
        // General settings
        if (settings.general) {
            SettingsUtil.setValue('defaultCurrency', settings.general.defaultCurrency);
            SettingsUtil.setValue('taxRate', settings.general.taxRate);
            SettingsUtil.setValue('roundingMethod', settings.general.roundingMethod);
            SettingsUtil.setValue('decimalPlaces', settings.general.decimalPlaces);
            SettingsUtil.setChecked('showCents', settings.general.showCents);
        }

        // Numbering settings
        if (settings.numbering) {
            SettingsUtil.setValue('numberingFormat', settings.numbering.format);
            SettingsUtil.setValue('numberingPrefix', settings.numbering.prefix);
            SettingsUtil.setValue('startNumber', settings.numbering.startNumber);
            SettingsUtil.setValue('yearFormat', settings.numbering.yearFormat);
            SettingsUtil.setValue('monthFormat', settings.numbering.monthFormat);
            SettingsUtil.setValue('numberingSeparator', settings.numbering.separator);
            SettingsUtil.setChecked('autoIncrement', settings.numbering.autoIncrement);
            SettingsUtil.setChecked('resetMonthly', settings.numbering.resetMonthly);
        }

        // Display settings
        if (settings.display) {
            SettingsUtil.setChecked('showLogo', settings.display.showLogo);
            SettingsUtil.setChecked('showCompanyDetails', settings.display.showCompanyDetails);
            SettingsUtil.setChecked('showCustomerDetails', settings.display.showCustomerDetails);
            SettingsUtil.setChecked('showTaxDetails', settings.display.showTaxDetails);
            SettingsUtil.setChecked('showPaymentDetails', settings.display.showPaymentDetails);
            SettingsUtil.setChecked('showFooter', settings.display.showFooter);
            SettingsUtil.setChecked('showWatermark', settings.display.showWatermark);
        }

        // Content settings
        if (settings.content) {
            SettingsUtil.setValue('headerNotes', settings.content.headerNotes);
            SettingsUtil.setValue('footerNotes', settings.content.footerNotes);
            SettingsUtil.setValue('termsAndConditions', settings.content.termsAndConditions);
            SettingsUtil.setValue('paymentInstructions', settings.content.paymentInstructions);

            if (settings.content.bankDetails) {
                SettingsUtil.setValue('bankName', settings.content.bankDetails.bankName);
                SettingsUtil.setValue('accountName', settings.content.bankDetails.accountName);
                SettingsUtil.setValue('accountNumber', settings.content.bankDetails.accountNumber);
                SettingsUtil.setValue('swiftCode', settings.content.bankDetails.swiftCode);
            }
        }

        // Email settings
        if (settings.email) {
            SettingsUtil.setChecked('sendCopy', settings.email.sendCopy);
            SettingsUtil.setValue('defaultSubject', settings.email.defaultSubject);
            SettingsUtil.setValue('defaultMessage', settings.email.defaultMessage);
            SettingsUtil.setValue('ccEmails', settings.email.ccEmails.join('\n'));
            SettingsUtil.setValue('attachFormat', settings.email.attachFormat);
        }

        // LHDN settings
        if (settings.lhdn) {
            SettingsUtil.setChecked('lhdnEnabled', settings.lhdn.enabled);
            SettingsUtil.setChecked('autoSubmit', settings.lhdn.autoSubmit);
            SettingsUtil.setValue('submitDelay', settings.lhdn.submitDelay);
            SettingsUtil.setChecked('validateBeforeSubmit', settings.lhdn.validateBeforeSubmit);
            SettingsUtil.setChecked('storeResponses', settings.lhdn.storeResponses);
            SettingsUtil.setValue('allowedTaxCodes', settings.lhdn.allowedTaxCodes.join('\n'));

            if (settings.lhdn.businessProcesses) {
                SettingsUtil.setChecked('businessProcessInvoice', settings.lhdn.businessProcesses.invoice);
                SettingsUtil.setChecked('businessProcessCreditNote', settings.lhdn.businessProcesses.creditNote);
                SettingsUtil.setChecked('businessProcessDebitNote', settings.lhdn.businessProcesses.debitNote);
            }
        }

        // Initialize event listeners
        this.setupEventListeners();
    },

    /**
     * Validate email format
     * @param {string} email 
     * @returns {boolean}
     */
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
};

export default InvoiceSettingsUtil; 