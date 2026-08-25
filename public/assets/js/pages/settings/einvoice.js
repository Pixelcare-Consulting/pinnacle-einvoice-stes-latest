document.addEventListener('DOMContentLoaded', async () => {
    await loadEInvoiceSettings();
    setupFormValidation();
});

// Load eInvoice settings
async function loadEInvoiceSettings() {
    try {
        const response = await fetch('/api/settings/getEInvoiceSettings', {
            method: 'GET',
            credentials: 'same-origin'
        });

        if (!response.ok) {
            throw new Error('Failed to load eInvoice settings');
        }

        const settings = await response.json();
        populateForm(settings);
    } catch (error) {
        console.error('Error loading eInvoice settings:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to load eInvoice settings. Please try again.'
        });
    }
}

// Populate form with settings data
function populateForm(settings) {
    // API Configuration
    document.getElementById('apiEndpoint').value = settings.apiEndpoint || '';
    document.getElementById('apiKey').value = settings.apiKey || '';
    document.getElementById('apiVersion').value = settings.apiVersion || 'v1';

    // Document Templates
    document.getElementById('defaultTemplate').value = settings.defaultTemplate || 'standard';
    document.getElementById('logoPosition').value = settings.logoPosition || 'top-left';
    document.getElementById('showQRCode').checked = settings.showQRCode || false;

    // Numbering Format
    document.getElementById('invoiceFormat').value = settings.invoiceFormat || 'INV-{YYYY}-{MM}-{0000}';
    document.getElementById('startingNumber').value = settings.startingNumber || 1;
    document.getElementById('resetMonthly').checked = settings.resetMonthly || false;

    // Tax Settings
    document.getElementById('defaultTaxRate').value = settings.defaultTaxRate || 0;
    document.getElementById('taxRegNumber').value = settings.taxRegNumber || '';
    document.getElementById('includeTax').checked = settings.includeTax || false;
}

// Setup form validation
function setupFormValidation() {
    const inputs = document.querySelectorAll('.form-control');
    inputs.forEach(input => {
        input.addEventListener('change', validateField);
    });
}

// Toggle API Key visibility
function toggleApiKeyVisibility() {
    const apiKeyInput = document.getElementById('apiKey');
    const eyeIcon = document.querySelector('.fa-eye');
    
    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        eyeIcon.classList.remove('fa-eye');
        eyeIcon.classList.add('fa-eye-slash');
    } else {
        apiKeyInput.type = 'password';
        eyeIcon.classList.remove('fa-eye-slash');
        eyeIcon.classList.add('fa-eye');
    }
}

// Validate individual field
function validateField(event) {
    const input = event.target;
    const value = input.value.trim();

    switch (input.id) {
        case 'apiEndpoint':
            if (!isValidUrl(value)) {
                showError(input, 'Please enter a valid URL');
            } else {
                clearError(input);
            }
            break;

        case 'invoiceFormat':
            if (!value.includes('{YYYY}') || !value.includes('{0000}')) {
                showError(input, 'Format must include {YYYY} and {0000}');
            } else {
                clearError(input);
            }
            break;

        case 'startingNumber':
            const num = parseInt(value);
            if (isNaN(num) || num < 1) {
                showError(input, 'Please enter a valid number greater than 0');
            } else {
                clearError(input);
            }
            break;

        case 'defaultTaxRate':
            const rate = parseFloat(value);
            if (isNaN(rate) || rate < 0 || rate > 100) {
                showError(input, 'Tax rate must be between 0 and 100');
            } else {
                clearError(input);
            }
            break;
    }
}

// URL validation helper
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// Show error message
function showError(input, message) {
    clearError(input);
    input.classList.add('is-invalid');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'invalid-feedback';
    errorDiv.textContent = message;
    input.parentNode.appendChild(errorDiv);
}

// Clear error message
function clearError(input) {
    input.classList.remove('is-invalid');
    const errorDiv = input.parentNode.querySelector('.invalid-feedback');
    if (errorDiv) {
        errorDiv.remove();
    }
}

// Reset settings to default
function resetSettings() {
    Swal.fire({
        title: 'Reset Settings?',
        text: 'This will reset all eInvoice settings to their default values. This action cannot be undone.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, reset settings',
        cancelButtonText: 'Cancel'
    }).then((result) => {
        if (result.isConfirmed) {
            loadEInvoiceSettings();
            Swal.fire('Reset Complete', 'Settings have been reset to default values.', 'success');
        }
    });
}

// Save eInvoice settings
async function saveEInvoiceSettings() {
    const settings = {
        // API Configuration
        apiEndpoint: document.getElementById('apiEndpoint').value,
        apiKey: document.getElementById('apiKey').value,
        apiVersion: document.getElementById('apiVersion').value,

        // Document Templates
        defaultTemplate: document.getElementById('defaultTemplate').value,
        logoPosition: document.getElementById('logoPosition').value,
        showQRCode: document.getElementById('showQRCode').checked,

        // Numbering Format
        invoiceFormat: document.getElementById('invoiceFormat').value,
        startingNumber: parseInt(document.getElementById('startingNumber').value),
        resetMonthly: document.getElementById('resetMonthly').checked,

        // Tax Settings
        defaultTaxRate: parseFloat(document.getElementById('defaultTaxRate').value),
        taxRegNumber: document.getElementById('taxRegNumber').value,
        includeTax: document.getElementById('includeTax').checked
    };

    try {
        const response = await fetch('/api/settings/saveEInvoiceSettings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin',
            body: JSON.stringify(settings)
        });

        if (!response.ok) {
            throw new Error('Failed to save settings');
        }

        Swal.fire({
            icon: 'success',
            title: 'Success',
            text: 'eInvoice settings saved successfully!'
        });
    } catch (error) {
        console.error('Error saving settings:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to save settings. Please try again.'
        });
    }
} 