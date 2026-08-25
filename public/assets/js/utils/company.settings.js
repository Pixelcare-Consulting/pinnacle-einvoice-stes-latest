/**
 * Company Profile Settings Utility Module
 * Handles company information and profile settings
 */

import SettingsUtil from './settings.util.js';

const CompanySettingsUtil = {
    // Default settings
    defaults: {
        company: {
        name: '',
        rocNumber: '',
        taxNumber: '',
        sstNumber: '',
            address: {
                line1: '',
                line2: '',
                city: '',
                state: '',
                postcode: '',
                country: 'Malaysia'
            },
            contact: {
                email: '',
                phone: '',
                fax: '',
                website: ''
            }
        },
        branding: {
            logo: null,
            primaryColor: '#007bff',
            secondaryColor: '#6c757d',
            favicon: null
        },
        business: {
            industry: '',
            businessType: '',
            yearEstablished: new Date().getFullYear(),
            employeeCount: 0,
            annualRevenue: '',
            operatingHours: {
                weekday: {
                    start: '09:00',
                    end: '18:00'
                },
                weekend: {
                    start: '',
                    end: ''
                }
            }
        }
    },

    /**
     * Initialize company settings
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            const settings = await this.loadSettings();
            this.populateForm(settings);
            this.setupEventListeners();
        } catch (error) {
            console.error('Failed to initialize company settings:', error);
            throw error;
        }
    },

    /**
     * Load company settings from server
     * @returns {Promise<Object>}
     */
    async loadSettings() {
        try {
            const response = await fetch('/api/settings/company');
            if (response.status === 404) {
                console.warn('Company settings endpoint not found, using defaults');
                return this.defaults;
            }
            const data = await SettingsUtil.handleApiResponse(response);
            return data.settings || this.defaults;
        } catch (error) {
            console.warn('Failed to load company settings, using defaults:', error);
            return this.defaults;
        }
    },

    /**
     * Save company settings to server
     * @param {Object} settings 
     * @returns {Promise<Object>}
     */
    async saveSettings(settings) {
        const errors = this.validateSettings(settings);
        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }

        const response = await fetch('/api/settings/company', {
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

        if (settings.company) {
            if (!settings.company.name?.trim()) {
                errors.push('Company name is required');
            }

            if (!settings.company.rocNumber?.trim()) {
                errors.push('ROC number is required');
            }

            if (!settings.company.taxNumber?.trim()) {
                errors.push('Tax number is required');
            }

            if (settings.company.address) {
                if (!settings.company.address.line1?.trim()) {
                    errors.push('Address line 1 is required');
                }
                if (!settings.company.address.city?.trim()) {
                    errors.push('City is required');
                }
                if (!settings.company.address.state?.trim()) {
                    errors.push('State is required');
                }
                if (!settings.company.address.postcode?.trim()) {
                    errors.push('Postcode is required');
                }
                if (!settings.company.address.country?.trim()) {
                    errors.push('Country is required');
                }
            } else {
                errors.push('Company address is required');
            }

            if (settings.company.contact) {
                if (!settings.company.contact.email?.trim()) {
                    errors.push('Contact email is required');
                } else if (!this.isValidEmail(settings.company.contact.email)) {
                    errors.push('Invalid contact email format');
                }

                if (!settings.company.contact.phone?.trim()) {
                    errors.push('Contact phone is required');
                }

                if (settings.company.contact.website && 
                    !this.isValidUrl(settings.company.contact.website)) {
                    errors.push('Invalid website URL format');
                }
            } else {
                errors.push('Company contact information is required');
            }
        } else {
            errors.push('Company information is required');
        }

        if (settings.business) {
            if (!settings.business.industry?.trim()) {
                errors.push('Industry is required');
            }

            if (!settings.business.businessType?.trim()) {
                errors.push('Business type is required');
            }

            if (typeof settings.business.yearEstablished !== 'number' || 
                settings.business.yearEstablished < 1800 || 
                settings.business.yearEstablished > new Date().getFullYear()) {
                errors.push('Invalid year established');
            }

            if (typeof settings.business.employeeCount !== 'number' || 
                settings.business.employeeCount < 0) {
                errors.push('Employee count must be a positive number');
            }

            if (settings.business.operatingHours) {
                if (!this.isValidTime(settings.business.operatingHours.weekday?.start) || 
                    !this.isValidTime(settings.business.operatingHours.weekday?.end)) {
                    errors.push('Invalid weekday operating hours');
                }

                if (settings.business.operatingHours.weekend?.start || 
                    settings.business.operatingHours.weekend?.end) {
                    if (!this.isValidTime(settings.business.operatingHours.weekend.start) || 
                        !this.isValidTime(settings.business.operatingHours.weekend.end)) {
                        errors.push('Invalid weekend operating hours');
                    }
                }
            }
        }

        return errors;
    },

    /**
     * Setup event listeners for company settings form
     */
    setupEventListeners() {
        // Logo upload
        document.getElementById('logoUpload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                if (!this.isValidImageFile(file)) {
                    SettingsUtil.showError('Invalid logo file type. Please upload a PNG, JPG, or JPEG file.');
                    e.target.value = '';
                    return;
                }

                if (file.size > 2 * 1024 * 1024) { // 2MB limit
                    SettingsUtil.showError('Logo file size must be less than 2MB');
                    e.target.value = '';
                    return;
                }

                try {
                    const base64 = await this.fileToBase64(file);
                    document.getElementById('logoPreview').src = base64;
                    document.getElementById('logoBase64').value = base64;
                } catch (error) {
                    console.error('Failed to process logo:', error);
                    SettingsUtil.showError('Failed to process logo file');
                }
            }
        });

        // Favicon upload
        document.getElementById('faviconUpload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                if (!this.isValidImageFile(file)) {
                    SettingsUtil.showError('Invalid favicon file type. Please upload a PNG, JPG, or JPEG file.');
                    e.target.value = '';
                    return;
                }

                if (file.size > 500 * 1024) { // 500KB limit
                    SettingsUtil.showError('Favicon file size must be less than 500KB');
                    e.target.value = '';
                    return;
                }

                try {
                    const base64 = await this.fileToBase64(file);
                    document.getElementById('faviconPreview').src = base64;
                    document.getElementById('faviconBase64').value = base64;
                } catch (error) {
                    console.error('Failed to process favicon:', error);
                    SettingsUtil.showError('Failed to process favicon file');
                }
            }
        });

        // Color pickers
        document.getElementById('primaryColor')?.addEventListener('change', (e) => {
            document.documentElement.style.setProperty('--primary-color', e.target.value);
        });

        document.getElementById('secondaryColor')?.addEventListener('change', (e) => {
            document.documentElement.style.setProperty('--secondary-color', e.target.value);
        });
    },

    /**
     * Get current settings from form
     * @returns {Object}
     */
    getFormSettings() {
        return {
            company: {
                name: SettingsUtil.getValue('companyName'),
                rocNumber: SettingsUtil.getValue('rocNumber'),
                taxNumber: SettingsUtil.getValue('taxNumber'),
                sstNumber: SettingsUtil.getValue('sstNumber'),
                address: {
                    line1: SettingsUtil.getValue('addressLine1'),
                    line2: SettingsUtil.getValue('addressLine2'),
                    city: SettingsUtil.getValue('city'),
                    state: SettingsUtil.getValue('state'),
                    postcode: SettingsUtil.getValue('postcode'),
                    country: SettingsUtil.getValue('country')
                },
                contact: {
                    email: SettingsUtil.getValue('contactEmail'),
                    phone: SettingsUtil.getValue('contactPhone'),
                    fax: SettingsUtil.getValue('contactFax'),
                    website: SettingsUtil.getValue('website')
                }
            },
            branding: {
                logo: document.getElementById('logoBase64')?.value || null,
                primaryColor: SettingsUtil.getValue('primaryColor'),
                secondaryColor: SettingsUtil.getValue('secondaryColor'),
                favicon: document.getElementById('faviconBase64')?.value || null
            },
            business: {
                industry: SettingsUtil.getValue('industry'),
                businessType: SettingsUtil.getValue('businessType'),
                yearEstablished: parseInt(SettingsUtil.getValue('yearEstablished')) || new Date().getFullYear(),
                employeeCount: parseInt(SettingsUtil.getValue('employeeCount')) || 0,
                annualRevenue: SettingsUtil.getValue('annualRevenue'),
                operatingHours: {
                    weekday: {
                        start: SettingsUtil.getValue('weekdayStart'),
                        end: SettingsUtil.getValue('weekdayEnd')
                    },
                    weekend: {
                        start: SettingsUtil.getValue('weekendStart'),
                        end: SettingsUtil.getValue('weekendEnd')
                    }
                }
            }
        };
    },

    /**
     * Populate form with company settings
     * @param {Object} settings 
     */
    populateForm(settings) {
        // Company information
        if (settings.company) {
            SettingsUtil.setValue('companyName', settings.company.name);
            SettingsUtil.setValue('rocNumber', settings.company.rocNumber);
            SettingsUtil.setValue('taxNumber', settings.company.taxNumber);
            SettingsUtil.setValue('sstNumber', settings.company.sstNumber);

            if (settings.company.address) {
                SettingsUtil.setValue('addressLine1', settings.company.address.line1);
                SettingsUtil.setValue('addressLine2', settings.company.address.line2);
                SettingsUtil.setValue('city', settings.company.address.city);
                SettingsUtil.setValue('state', settings.company.address.state);
                SettingsUtil.setValue('postcode', settings.company.address.postcode);
                SettingsUtil.setValue('country', settings.company.address.country);
            }

            if (settings.company.contact) {
                SettingsUtil.setValue('contactEmail', settings.company.contact.email);
                SettingsUtil.setValue('contactPhone', settings.company.contact.phone);
                SettingsUtil.setValue('contactFax', settings.company.contact.fax);
                SettingsUtil.setValue('website', settings.company.contact.website);
            }
        }

        // Branding settings
        if (settings.branding) {
            if (settings.branding.logo) {
                document.getElementById('logoPreview').src = settings.branding.logo;
                document.getElementById('logoBase64').value = settings.branding.logo;
            }
            
            SettingsUtil.setValue('primaryColor', settings.branding.primaryColor);
            SettingsUtil.setValue('secondaryColor', settings.branding.secondaryColor);
            
            if (settings.branding.favicon) {
                document.getElementById('faviconPreview').src = settings.branding.favicon;
                document.getElementById('faviconBase64').value = settings.branding.favicon;
            }
        }

        // Business information
        if (settings.business) {
            SettingsUtil.setValue('industry', settings.business.industry);
            SettingsUtil.setValue('businessType', settings.business.businessType);
            SettingsUtil.setValue('yearEstablished', settings.business.yearEstablished);
            SettingsUtil.setValue('employeeCount', settings.business.employeeCount);
            SettingsUtil.setValue('annualRevenue', settings.business.annualRevenue);

            if (settings.business.operatingHours) {
                if (settings.business.operatingHours.weekday) {
                    SettingsUtil.setValue('weekdayStart', settings.business.operatingHours.weekday.start);
                    SettingsUtil.setValue('weekdayEnd', settings.business.operatingHours.weekday.end);
                }
                if (settings.business.operatingHours.weekend) {
                    SettingsUtil.setValue('weekendStart', settings.business.operatingHours.weekend.start);
                    SettingsUtil.setValue('weekendEnd', settings.business.operatingHours.weekend.end);
                }
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
    },

    /**
     * Validate URL format
     * @param {string} url 
     * @returns {boolean}
     */
    isValidUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Validate time format (HH:mm)
     * @param {string} time 
     * @returns {boolean}
     */
    isValidTime(time) {
        if (!time) return false;
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        return timeRegex.test(time);
    },

    /**
     * Check if file is a valid image
     * @param {File} file 
     * @returns {boolean}
     */
    isValidImageFile(file) {
        const validTypes = ['image/png', 'image/jpeg', 'image/jpg'];
        return validTypes.includes(file.type);
    },

    /**
     * Convert file to base64
     * @param {File} file 
     * @returns {Promise<string>}
     */
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }
};

export default CompanySettingsUtil; 