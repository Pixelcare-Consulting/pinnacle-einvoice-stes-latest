/**
 * Base Settings Utility Module
 * Provides common functionality for settings management
 */

const SettingsUtil = {
    /**
     * Show loading overlay
     */
    showLoading() {
        Swal.fire({
            title: 'Loading...',
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
    },

    /**
     * Hide loading overlay
     */
    hideLoading() {
        Swal.close();
    },

    /**
     * Show success message
     * @param {string} message 
     */
    showSuccess(message) {
        Swal.fire({
            icon: 'success',
            title: 'Success',
            text: message,
            timer: 2000,
            showConfirmButton: false
        });
    },

    /**
     * Show error message
     * @param {string} message 
     */
    showError(message) {
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: message
        });
    },

    /**
     * Initialize tooltips with consistent options across the application
     * @param {Object} options - Optional custom options to override defaults
     */
    initializeTooltips(options = {}) {
        // Clean up any existing tooltips first
        const existingTooltips = document.querySelectorAll('.tooltip');
        existingTooltips.forEach(tooltip => tooltip.remove());

        // Destroy any existing tooltip instances
        const tooltipTriggers = document.querySelectorAll('[data-bs-toggle="tooltip"]');
        tooltipTriggers.forEach(el => {
            const tooltipInstance = bootstrap.Tooltip.getInstance(el);
            if (tooltipInstance) {
                tooltipInstance.dispose();
            }
        });

        // Default options for consistent look and feel
        const defaultOptions = {
            template: '<div class="tooltip" role="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',
            trigger: 'hover focus',
            container: 'body',
            animation: true,
            delay: { show: 200, hide: 100 }
        };

        // Initialize tooltips with merged options
        tooltipTriggers.forEach(tooltip => {
            new bootstrap.Tooltip(tooltip, { ...defaultOptions, ...options });
        });

        // Add global event listeners to handle tooltip cleanup
        document.addEventListener('scroll', this.hideAllTooltips, true);
        window.addEventListener('resize', this.hideAllTooltips);
    },

    /**
     * Hide all tooltips
     */
    hideAllTooltips() {
        const tooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
        tooltips.forEach(element => {
            const tooltip = bootstrap.Tooltip.getInstance(element);
            if (tooltip) {
                tooltip.hide();
            }
        });
    },

    /**
     * Get form field value
     * @param {string} id Field ID
     * @returns {string} Field value
     */
    getValue(id) {
        const element = document.getElementById(id);
        return element ? element.value : '';
    },

    /**
     * Set form field value
     * @param {string} id Field ID
     * @param {string} value Field value
     */
    setValue(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.value = value || '';
        }
    },

    /**
     * Get checkbox checked state
     * @param {string} id Checkbox ID
     * @returns {boolean} Checked state
     */
    getChecked(id) {
        const element = document.getElementById(id);
        return element ? element.checked : false;
    },

    /**
     * Set checkbox checked state
     * @param {string} id Checkbox ID
     * @param {boolean} checked Checked state
     */
    setChecked(id, checked) {
        const element = document.getElementById(id);
        if (element) {
            element.checked = checked;
        }
    },

    /**
     * Handle API response
     * @param {Response} response Fetch response
     * @returns {Promise<Object>} Response data
     */
    async handleApiResponse(response) {
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.message || `HTTP error! status: ${response.status}`);
        }
        return response.json();
    }
};

export default SettingsUtil; 