/**
 * LHDN UI Helper
 * Provides consistent UI error handling for LHDN errors
 */

// Create a namespace for the helper
const lhdnUIHelper = (function() {
    // Common LHDN error codes and their user-friendly messages
    const ERROR_CODES = {
        // Document validation errors
        'DS302': 'This document has already been submitted to LHDN.',
        'CF321': 'Document issue date is invalid. Documents must be submitted within 7 days of issuance.',
        'CF364': 'Invalid item classification code. Please check all item classification codes.',
        'CF401': 'Tax calculation error. Please verify all tax amounts and calculations.',
        'CF402': 'Currency error. Please check that all monetary values use the correct currency code.',
        'CF403': 'Invalid tax code. Please verify the tax codes used in your document.',
        'CF404': 'Missing required field. Please ensure all required fields are completed.',
        'CF405': 'Invalid format. Please check the format of all fields in your document.',
        'CF406': 'Invalid value. One or more fields contain invalid values.',
        'CF407': 'Document number already exists. Please use a unique document number.',

        // Authentication errors
        'AUTH001': 'Authentication failed. Please check your credentials.',
        'AUTH002': 'Session expired. Please log in again.',
        'AUTH003': 'Unauthorized access. You do not have permission to perform this action.',

        // System errors
        'SYS001': 'LHDN system error. Please try again later.',
        'SYS002': 'Connection timeout. Please check your internet connection and try again.',
        'SYS003': 'Service unavailable. LHDN services are currently down or under maintenance.',

        // Rate limiting
        'RATE_LIMIT': 'Rate limit exceeded. Please try again later.',

        // Default errors
        'VALIDATION_ERROR': 'Document validation failed. Please check the details and try again.',
        'SUBMISSION_ERROR': 'Document submission failed. Please try again later.',
        'EMPTY_RESPONSE': 'No response received from LHDN. The service might be unavailable.',
        'UNKNOWN_ERROR': 'An unknown error occurred. Please try again or contact support.'
    };

    /**
     * Format LHDN error for display
     * @param {Object|String|Array} error - The error object, string, or array
     * @returns {Object} Formatted error object with code, message, details, and suggestion
     */
    function formatLHDNError(error) {
        // Initialize default error object
        let formattedError = {
            code: 'UNKNOWN_ERROR',
            message: 'An unknown error occurred',
            details: [],
            suggestion: 'Please try again or contact support'
        };

        try {
            console.log('Formatting LHDN error:', error);

            // Handle string errors (try to parse as JSON)
            if (typeof error === 'string') {
                try {
                    error = JSON.parse(error);
                } catch (e) {
                    // If not valid JSON, use as message
                    formattedError.message = error;
                    return formattedError;
                }
            }

            // Handle array errors (take first item)
            if (Array.isArray(error)) {
                error = error[0] || error;
            }

            // Extract error details
            const code = error.code || error.errorCode || 'UNKNOWN_ERROR';
            const message = error.message || error.errorMessage || 'An unknown error occurred';
            let details = error.details || error.errorDetails || [];
            const target = error.target || '';

            // Use predefined message if available, otherwise use provided message
            const userFriendlyMessage = ERROR_CODES[code] || message;

            // Format details for display
            let formattedDetails = [];

            // Handle case where details is a string that might contain JSON
            if (typeof details === 'string' && (details.includes('{') || details.includes('['))) {
                try {
                    // Try to parse JSON from the string
                    const jsonMatch = details.match(/(\{.*\}|\[.*\])/s);
                    if (jsonMatch) {
                        const parsedDetails = JSON.parse(jsonMatch[0]);
                        details = Array.isArray(parsedDetails) ? parsedDetails : [parsedDetails];
                    } else {
                        details = [details];
                    }
                } catch (e) {
                    console.error('Error parsing JSON from details string:', e);
                    details = [details];
                }
            }

            // Process details based on type
            if (Array.isArray(details)) {
                formattedDetails = details;
            } else if (typeof details === 'string') {
                formattedDetails = [details];
            } else if (typeof details === 'object') {
                // If details is an object with nested details property
                if (details.details) {
                    formattedDetails = Array.isArray(details.details) ? details.details : [details.details];
                } else {
                    // Convert object to array of formatted strings
                    formattedDetails = Object.entries(details).map(([key, value]) => {
                        if (typeof value === 'object') {
                            return { key, ...value };
                        } else {
                            return `${key}: ${value}`;
                        }
                    });
                }
            }

            // Special handling for CF414 phone number validation error
            if (code === 'CF414' || (message && message.includes('Enter valid phone number'))) {
                formattedDetails = [{
                    code: 'CF414',
                    message: 'Enter valid phone number and the minimum length is 8 characters - SUPPLIER',
                    target: 'ContactNumber',
                    propertyPath: 'Invoice.AccountingSupplierParty.Party.Contact.Telephone'
                }];
            }

            // Generate suggestion based on error code
            let suggestion = 'Please check the document and try again';
            if (code.startsWith('CF4')) {
                suggestion = 'Please verify all tax information and calculations';
            } else if (code === 'CF414') {
                suggestion = 'Please ensure the supplier phone number is at least 8 characters long';
            } else if (code.startsWith('AUTH')) {
                suggestion = 'Please log in again or contact your administrator';
            } else if (code.startsWith('SYS')) {
                suggestion = 'Please try again later or contact support';
            } else if (code === 'RATE_LIMIT') {
                suggestion = 'Please wait a few minutes before trying again';
            } else if (code === 'DS302' || code === 'DUPLICATE_SUBMISSION') {
                suggestion = 'This document has already been submitted. Please check the document status.';
            }

            // Return formatted error
            formattedError = {
                code,
                message: userFriendlyMessage,
                details: formattedDetails,
                target,
                suggestion
            };

            console.log('Formatted LHDN error:', formattedError);
        } catch (e) {
            console.error('Error formatting LHDN error:', e);
            // Keep default error object
        }

        return formattedError;
    }

    /**
     * Show LHDN error modal
     * @param {Object|String|Array} error - The error object, string, or array
     * @param {Object} options - Display options
     * @param {String} options.title - Modal title (default: 'LHDN Error')
     * @param {Boolean} options.showDetails - Whether to show error details (default: true)
     * @param {Boolean} options.showSuggestion - Whether to show suggestion (default: true)
     * @param {Function} options.onClose - Callback when modal is closed
     */
    function showLHDNErrorModal(error, options = {}) {
        // Format error
        const formattedError = formatLHDNError(error);

        // Default options
        const defaultOptions = {
            title: 'LHDN Error',
            showDetails: true,
            showSuggestion: true,
            onClose: null
        };

        // Merge options
        const mergedOptions = { ...defaultOptions, ...options };

        // Create modern modal HTML - Consistent design with version modal
        const modalId = 'modernLhdnErrorModal';
        let modalHTML = `
            <div class="modern-modal-content">
                <div class="modal-header-section">
                    <div class="modal-brand">
                        <div class="brand-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                        <div>
                            <h1 class="modal-title">${mergedOptions.title}</h1>
                            <p class="modal-subtitle">Please review the details below</p>
                        </div>
                    </div>
                    <div class="modal-meta">
                        <div class="meta-item">
                            <span class="meta-label">Error Code</span>
                            <span class="meta-value">${formattedError.code}</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">Status</span>
                            <span class="meta-value">Failed</span>
                        </div>
                    </div>
                </div>

                <div class="modal-content-section" style="padding: 2rem;">
                    <div class="error-code-badge">
                        <i class="fas fa-exclamation-triangle"></i>
                        ${formattedError.code}
                    </div>

                    <div class="error-message">
                        <h6><i class="fas fa-exclamation-circle"></i> LHDN Submission Error</h6>
                        <p>${formattedError.message}</p>
                    </div>
        `;

        // Add details if available and showDetails is true
        if (mergedOptions.showDetails && formattedError.details && formattedError.details.length > 0) {
            modalHTML += `
                <div class="error-list-container">
                    <div class="error-group">
                        <div class="error-group-header">
                            <i class="fas fa-list"></i>
                            <span>Error Details</span>
                        </div>
                        <ul class="error-list">
            `;

            // Add each detail as a list item with improved formatting
            formattedError.details.forEach((detail, index) => {
                let errorText = '';
                if (typeof detail === 'string') {
                    errorText = detail;
                } else if (typeof detail === 'object') {
                    // Format object details more clearly
                    if (detail.code && detail.message) {
                        // If it has code and message, format as code: message
                        errorText = `<strong>${detail.code}</strong>: ${detail.message}`;
                    } else if (detail.message) {
                        // If it only has message
                        errorText = detail.message;
                    } else if (detail.propertyPath) {
                        // If it has a propertyPath, show that
                        errorText = `Field: <code>${detail.propertyPath}</code> - ${detail.message || 'Invalid value'}`;
                    } else {
                        // Fallback to JSON string for other objects
                        try {
                            // Try to format the object nicely
                            errorText = Object.entries(detail)
                                .map(([key, value]) => `<strong>${key}</strong>: ${value}`)
                                .join(', ');
                        } catch (e) {
                            // Fallback to simple JSON
                            errorText = JSON.stringify(detail);
                        }
                    }
                }

                modalHTML += `
                    <li class="error-item">
                        <span class="error-number">${index + 1}</span>
                        <span class="error-text">${errorText}</span>
                    </li>
                `;
            });

            modalHTML += `
                        </ul>
                    </div>
                </div>
            `;
        }

        // Add suggestion if showSuggestion is true
        if (mergedOptions.showSuggestion && formattedError.suggestion) {
            modalHTML += `
                    <div class="error-suggestion">
                        <h6><i class="fas fa-lightbulb"></i> Suggestion</h6>
                        <p>${formattedError.suggestion}</p>
                    </div>
            `;
        }

        // Add technical details section for CF414 phone number error
        if (formattedError.code === 'CF414') {
            modalHTML += `
                    <div class="error-information">
                        <h6><i class="fas fa-info-circle"></i> How to Fix</h6>
                        <p>The supplier's phone number must be at least 8 characters long. Please update the phone number in your Excel file and try again.</p>
                    </div>
            `;
        }

        // Add technical details section for DS302 duplicate submission
        if (formattedError.code === 'DS302' || formattedError.code === 'DUPLICATE_SUBMISSION') {
            modalHTML += `
                    <div class="error-information">
                        <h6><i class="fas fa-info-circle"></i> Information</h6>
                        <p>This document has already been submitted to LHDN. You can check its status in the table below.</p>
                    </div>
            `;
        }

        // Close the error content
        modalHTML += `
                </div>
            </div>
        `;

        // Show the modern modal using SweetAlert2
        Swal.fire({
            html: modalHTML,
            showConfirmButton: true,
            confirmButtonText: 'I Understand',
            width: 580, // Reduced from 800 for better proportions
            padding: '0',
            background: 'transparent',
            customClass: {
                popup: 'modern-modal enhanced-error-modal',
                confirmButton: 'modern-btn modern-btn-primary'
            }
        }).then(() => {
            // Call onClose callback if provided
            if (mergedOptions.onClose) {
                mergedOptions.onClose();
            }
        });
    }

    /**
     * Show LHDN error toast
     * @param {Object|String|Array} error - The error object, string, or array
     * @param {Object} options - Display options
     * @param {String} options.position - Toast position (default: 'top-center')
     * @param {Number} options.autoHide - Auto-hide duration in ms, 0 to disable (default: 5000)
     * @param {Boolean} options.showDetails - Whether to show error details (default: false)
     */
    function showLHDNErrorToast(error, options = {}) {
        // Format error
        const formattedError = formatLHDNError(error);

        // Default options
        const defaultOptions = {
            position: 'top-center',
            autoHide: 5000,
            showDetails: false
        };

        // Merge options
        const mergedOptions = { ...defaultOptions, ...options };

        // Create toast HTML
        const toastId = `lhdnErrorToast-${Date.now()}`;
        let toastHTML = `
            <div class="toast-header bg-danger text-white">
                <strong class="me-auto">${formattedError.code}</strong>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                <div class="fw-bold">${formattedError.message}</div>
        `;

        // Add details if available and showDetails is true
        if (mergedOptions.showDetails && formattedError.details && formattedError.details.length > 0) {
            toastHTML += `<div class="mt-2 small text-start">`;

            // Add first detail only (to keep toast compact)
            const detail = formattedError.details[0];
            if (typeof detail === 'string') {
                toastHTML += detail;
            } else if (typeof detail === 'object') {
                // Format object details more clearly
                if (detail.code && detail.message) {
                    // If it has code and message, format as code: message
                    toastHTML += `<strong>${detail.code}</strong>: ${detail.message}`;
                } else if (detail.message) {
                    // If it only has message
                    toastHTML += detail.message;
                } else if (detail.propertyPath) {
                    // If it has a propertyPath, show that
                    toastHTML += `Field: <code>${detail.propertyPath}</code>`;
                } else {
                    // Fallback to simple text
                    toastHTML += detail.message || detail.code || JSON.stringify(detail);
                }
            }

            // Indicate if there are more details
            if (formattedError.details.length > 1) {
                toastHTML += ` <span class="text-muted">(+${formattedError.details.length - 1} more)</span>`;
            }

            toastHTML += `</div>`;
        }

        // Add a "View Details" button for more complex errors
        if (formattedError.details && formattedError.details.length > 0 && !mergedOptions.showDetails) {
            toastHTML += `
                <div class="mt-2 text-center">
                    <button class="btn btn-sm btn-outline-danger view-details-btn">
                        View Details
                    </button>
                </div>
            `;
        }

        // Close toast HTML
        toastHTML += `</div>`;

        // Show the toast using SweetAlert2 as a toast
        const toast = Swal.fire({
            toast: true,
            position: mergedOptions.position.replace('-', '_'),
            html: toastHTML,
            showConfirmButton: false,
            timer: mergedOptions.autoHide > 0 ? mergedOptions.autoHide : undefined,
            timerProgressBar: mergedOptions.autoHide > 0,
            didOpen: (toast) => {
                toast.addEventListener('mouseenter', Swal.stopTimer);
                toast.addEventListener('mouseleave', Swal.resumeTimer);

                // Add event listener for "View Details" button
                const viewDetailsBtn = toast.querySelector('.view-details-btn');
                if (viewDetailsBtn) {
                    viewDetailsBtn.addEventListener('click', () => {
                        // Close the toast
                        Swal.close();

                        // Show the modal with full details
                        showLHDNErrorModal(error, {
                            title: 'LHDN Error Details',
                            showDetails: true,
                            showSuggestion: true
                        });
                    });
                }
            }
        });

        return toast;
    }

    // Return public API
    return {
        formatLHDNError,
        showLHDNErrorModal,
        showLHDNErrorToast,
        ERROR_CODES
    };
})();
