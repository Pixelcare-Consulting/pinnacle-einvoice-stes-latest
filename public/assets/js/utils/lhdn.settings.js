/**
 * LHDN Settings Utility Module
 * Handles all LHDN e-Invoice settings operations and validations
 */

const LHDNSettingsUtil = {
    // Default settings configuration
    defaults: {
        api_environment: 'sandbox',
        api_version: 'v1.0',
        sandbox_url: 'https://preprod-api.myinvois.hasil.gov.my/api',
        production_url: 'https://api.myinvois.hasil.gov.my/api',
        auto_submission: true,
        submission_delay: 0,
        batch_size: 100,
        retry_count: 3,
        retry_delay: 5,
        validate_before_submit: true,
        schema_validation: true,
        store_responses: true,
        response_retention_days: 90,
        notify_errors: true,
        digital_signature: false,
        signature_type: 'RSA',
        allowed_tax_codes: ['SR', 'ZR', 'ES', 'OS'],
        business_process: ['INVOICE']
    },

    // Validation rules
    validationRules: {
        numericFields: [
            { id: 'lhdnSubmissionDelay', name: 'Submission Delay', min: 0 },
            { id: 'lhdnBatchSize', name: 'Batch Size', min: 1 },
            { id: 'lhdnRetryCount', name: 'Retry Count', min: 0 },
            { id: 'lhdnRetryDelay', name: 'Retry Delay', min: 1 },
            { id: 'lhdnResponseRetention', name: 'Response Retention', min: 1 }
        ],
        taxCodes: ['SR', 'ZR', 'ES', 'OS', 'AJS', 'RS', 'GS', 'DS'],
        businessProcesses: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']
    },

    /**
     * Initialize LHDN settings
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            const settings = await this.loadSettings();
            this.populateForm(settings);
            this.setupEventListeners();
        } catch (error) {
            console.error('Failed to initialize LHDN settings:', error);
            throw error;
        }
    },

    /**
     * Load settings from server
     * @returns {Promise<Object>}
     */
    async loadSettings() {
        try {
            const response = await fetch('/api/lhdn/settings');
            const data = await response.json();
            return data.success ? data.settings : this.defaults;
        } catch (error) {
            console.error('Failed to load LHDN settings:', error);
            return this.defaults;
        }
    },

    /**
     * Save settings to server
     * @param {Object} settings 
     * @returns {Promise<Object>}
     */
    async saveSettings(settings) {
        const errors = this.validateSettings(settings);
        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }

        const response = await fetch('/api/lhdn/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        return response.json();
    },

    /**
     * Test LHDN API connection
     * @param {string} environment 
     * @param {string} url 
     * @returns {Promise<Object>}
     */
    async testConnection(environment, url) {
        const response = await fetch('/api/lhdn/test-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ environment, url })
        });

        return response.json();
    },

    /**
     * Validate settings object
     * @param {Object} settings 
     * @returns {Array<string>} Array of error messages
     */
    validateSettings(settings) {
        const errors = [];

        // Validate environment URLs
        if (settings.api_environment === 'production' && !settings.production_url) {
            errors.push('Production URL is required when using production environment');
        } else if (settings.api_environment === 'sandbox' && !settings.sandbox_url) {
            errors.push('Sandbox URL is required when using sandbox environment');
        }

        // Validate numeric fields
        this.validationRules.numericFields.forEach(field => {
            const value = parseInt(settings[field.id.replace('lhdn', '').toLowerCase()]);
            if (isNaN(value) || value < field.min) {
                errors.push(`${field.name} must be a number greater than or equal to ${field.min}`);
            }
        });

        // Validate tax codes
        if (!settings.allowed_tax_codes || settings.allowed_tax_codes.length === 0) {
            errors.push('At least one tax code must be selected');
        }

        return errors;
    },

    /**
     * Handle environment change
     * @param {string} environment 
     */
    handleEnvironmentChange(environment) {
        const sandboxUrl = document.getElementById('lhdnSandboxUrl');
        const productionUrl = document.getElementById('lhdnProductionUrl');
        
        if (environment === 'production') {
            sandboxUrl.setAttribute('disabled', 'disabled');
            sandboxUrl.value = '';
            productionUrl.removeAttribute('disabled');
        } else {
            sandboxUrl.removeAttribute('disabled');
            productionUrl.setAttribute('disabled', 'disabled');
            productionUrl.value = '';
        }
    },

    /**
     * Setup event listeners for LHDN settings form
     */
    setupEventListeners() {
        // Environment change handler
        document.getElementById('lhdnApiEnvironment')?.addEventListener('change', (e) => {
            this.handleEnvironmentChange(e.target.value);
        });

        // Numeric input validation
        this.validationRules.numericFields.forEach(field => {
            document.getElementById(field.id)?.addEventListener('change', (e) => {
                const value = parseInt(e.target.value);
                if (isNaN(value) || value < field.min) {
                    e.target.value = field.min;
                }
            });
        });
    },

    /**
     * Get current settings from form
     * @returns {Object}
     */
    getFormSettings() {
        return {
            api_environment: getValue('lhdnApiEnvironment'),
            api_version: getValue('lhdnApiVersion'),
            sandbox_url: getValue('lhdnSandboxUrl'),
            production_url: getValue('lhdnProductionUrl'),
            auto_submission: getChecked('lhdnAutoSubmission'),
            submission_delay: parseInt(getValue('lhdnSubmissionDelay')) || 0,
            batch_size: parseInt(getValue('lhdnBatchSize')) || 100,
            retry_count: parseInt(getValue('lhdnRetryCount')) || 3,
            retry_delay: parseInt(getValue('lhdnRetryDelay')) || 5,
            validate_before_submit: getChecked('lhdnValidateBeforeSubmit'),
            schema_validation: getChecked('lhdnSchemaValidation'),
            store_responses: getChecked('lhdnStoreResponses'),
            response_retention_days: parseInt(getValue('lhdnResponseRetention')) || 90,
            notify_errors: getChecked('lhdnNotifyErrors'),
            digital_signature: getChecked('lhdnDigitalSignature'),
            signature_type: getValue('lhdnSignatureType'),
            allowed_tax_codes: Array.from(document.getElementById('lhdnTaxCodes').selectedOptions).map(opt => opt.value),
            business_process: [
                'INVOICE',
                ...(getChecked('lhdnProcessCreditNote') ? ['CREDIT_NOTE'] : []),
                ...(getChecked('lhdnProcessDebitNote') ? ['DEBIT_NOTE'] : [])
            ]
        };
    },

    /**
     * Populate form with settings
     * @param {Object} settings 
     */
    populateForm(settings) {
        // Populate all form fields
        setValue('lhdnApiEnvironment', settings.api_environment);
        setValue('lhdnApiVersion', settings.api_version);
        setValue('lhdnSandboxUrl', settings.sandbox_url);
        setValue('lhdnProductionUrl', settings.production_url);
        setChecked('lhdnAutoSubmission', settings.auto_submission);
        setValue('lhdnSubmissionDelay', settings.submission_delay);
        setValue('lhdnBatchSize', settings.batch_size);
        setValue('lhdnRetryCount', settings.retry_count);
        setValue('lhdnRetryDelay', settings.retry_delay);
        setChecked('lhdnValidateBeforeSubmit', settings.validate_before_submit);
        setChecked('lhdnSchemaValidation', settings.schema_validation);
        setChecked('lhdnStoreResponses', settings.store_responses);
        setValue('lhdnResponseRetention', settings.response_retention_days);
        setChecked('lhdnNotifyErrors', settings.notify_errors);
        setChecked('lhdnDigitalSignature', settings.digital_signature);
        setValue('lhdnSignatureType', settings.signature_type);

        // Set tax codes
        const taxCodesSelect = document.getElementById('lhdnTaxCodes');
        if (taxCodesSelect && settings.allowed_tax_codes) {
            settings.allowed_tax_codes.forEach(code => {
                const option = taxCodesSelect.querySelector(`option[value="${code}"]`);
                if (option) option.selected = true;
            });
        }

        // Set business processes
        if (settings.business_process) {
            setChecked('lhdnProcessCreditNote', settings.business_process.includes('CREDIT_NOTE'));
            setChecked('lhdnProcessDebitNote', settings.business_process.includes('DEBIT_NOTE'));
        }

        // Initialize environment-specific fields
        this.handleEnvironmentChange(settings.api_environment);
    }
};

// Export the utility
export default LHDNSettingsUtil; 