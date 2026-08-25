/**
 * Global Authentication Status Utility
 * Non-module version of the auth status utility for use in non-module scripts
 */

(function(window) {
    'use strict';

    // Authentication Status Utility
    const AuthStatusUtil = {
        /**
         * Check if the user is authenticated with LHDN
         * @returns {Promise<boolean>} True if authenticated, false otherwise
         */
        async checkLHDNAuthStatus() {
            try {
                const response = await fetch('/api/lhdn/auth-status', {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        'Pragma': 'no-cache',
                        'Expires': '0'
                    },
                    credentials: 'same-origin'
                });

                // Always try to parse the response, even if it's not OK
                // Our updated endpoint always returns 200 with authenticated: true/false
                const data = await response.json();

                // Log the response for debugging
                console.log('LHDN Auth Status Response (global):', data);

                return data.authenticated === true;
            } catch (error) {
                console.error('Error checking LHDN auth status:', error);
                return false;
            }
        },

        /**
         * Handle authentication errors
         * @param {Error} error - The error object
         * @returns {Object} Formatted error object with code, message, and details
         */
        handleAuthError(error) {
            // Check if it's an authentication error
            if (error.message?.includes('authentication') ||
                error.message?.includes('token') ||
                error.message?.includes('login') ||
                error.code === 'AUTH_ERROR') {

                return {
                    code: 'AUTH_ERROR',
                    message: 'Authentication error. Please log in again.',
                    details: 'Your session may have expired or the authentication token is invalid.',
                    actionRequired: true,
                    actionType: 'login'
                };
            }

            // Return the original error if it's not an auth error
            return {
                code: error.code || 'UNKNOWN_ERROR',
                message: error.message || 'An unknown error occurred',
                details: error.details || error.stack,
                actionRequired: false
            };
        },

        /**
         * Show authentication error to the user
         * @param {Object} error - The error object
         */
        showAuthErrorModal(error) {
            // Use SweetAlert2 if available
            if (window.Swal) {
                Swal.fire({
                    icon: 'error',
                    title: 'Authentication Error',
                    html: `
                        <div class="text-start">
                            <p>${error.message}</p>
                            <p class="text-muted small">${error.details}</p>
                            <div class="alert alert-info mt-3">
                                <i class="fas fa-info-circle me-2"></i>
                                <strong>What to do:</strong>
                                <ul class="mt-2 mb-0">
                                    <li>Click the "Logout" button in the top menu</li>
                                    <li>Log back in to refresh your authentication token</li>
                                    <li>Try your operation again</li>
                                </ul>
                            </div>
                        </div>
                    `,
                    confirmButtonText: 'Logout Now',
                    showCancelButton: true,
                    cancelButtonText: 'Later',
                    customClass: {
                        confirmButton: 'btn btn-primary',
                        cancelButton: 'btn btn-secondary'
                    }
                }).then((result) => {
                    if (result.isConfirmed) {
                        window.location.href = '/logout';
                    }
                });
            } else {
                // Fallback to alert if SweetAlert2 is not available
                alert(`Authentication Error: ${error.message}\n\nPlease log out and log back in to refresh your session.`);
            }
        },

        /**
         * Check if an error is a validation error
         * @param {Object} error - The error object
         * @returns {boolean} True if it's a validation error
         */
        isValidationError(error) {
            return error.code === 'VALIDATION_ERROR' ||
                   error.message?.includes('validation') ||
                   error.details?.some(d => d.code?.includes('VALIDATION'));
        }
    };

    // Expose AuthStatusUtil to window
    window.AuthStatusUtil = AuthStatusUtil;

})(window);
