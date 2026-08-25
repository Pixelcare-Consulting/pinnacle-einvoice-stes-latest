/**
 * Authentication Status Utility
 * Provides functions to check authentication status and handle auth-related errors
 */

const AuthStatusUtil = {
    // Track authentication attempts to avoid infinite loops
    _authCheckAttempts: 0,
    _maxAuthCheckAttempts: 3,
    _lastAuthCheck: 0,
    _authCheckCooldown: 5000, // 5 seconds cooldown between checks

    /**
     * Check if the user is authenticated with LHDN
     * @param {boolean} [force=false] - Force a fresh check even if recently checked
     * @returns {Promise<boolean>} True if authenticated, false otherwise
     */
    async checkLHDNAuthStatus(force = false) {
        try {
            // Check if we've made too many attempts in a short time
            const now = Date.now();
            if (!force && this._authCheckAttempts >= this._maxAuthCheckAttempts &&
                (now - this._lastAuthCheck) < this._authCheckCooldown) {
                console.warn('Too many auth checks in a short time, using cached result');

                // Dispatch an event with the current auth state
                if (window.authState) {
                    const authEvent = new CustomEvent('lhdn-auth-status-changed', {
                        detail: {
                            authenticated: window.authState.authenticated,
                            cached: true
                        }
                    });
                    window.dispatchEvent(authEvent);
                }

                return window.authState?.authenticated || false;
            }

            // Reset attempts counter if enough time has passed
            if ((now - this._lastAuthCheck) > this._authCheckCooldown) {
                this._authCheckAttempts = 0;
            }

            // Update tracking variables
            this._authCheckAttempts++;
            this._lastAuthCheck = now;

            console.log('Checking LHDN authentication status...');

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
            console.log('LHDN Auth Status Response:', data);

            // Update global auth state if available
            if (window.authState) {
                window.authState.authenticated = data.authenticated === true;
                window.authState.authChecked = true;
                window.authState.loading = false;
                window.authState.lastChecked = now;

                // Resolve the auth ready promise if it exists
                if (window.resolveAuthReady) {
                    window.resolveAuthReady(data.authenticated === true);
                }

                // Dispatch an event that can be listened to by other scripts
                const authEvent = new CustomEvent('lhdn-auth-status-changed', {
                    detail: {
                        authenticated: data.authenticated === true,
                        tokenRefreshed: data.tokenRefreshed === true
                    }
                });
                window.dispatchEvent(authEvent);
            }

            return data.authenticated === true;
        } catch (error) {
            console.error('Error checking LHDN auth status:', error);

            // Update global auth state if available
            if (window.authState) {
                window.authState.error = error;
                window.authState.authChecked = true;
                window.authState.loading = false;

                // Resolve the auth ready promise if it exists
                if (window.resolveAuthReady) {
                    window.resolveAuthReady(false);
                }

                // Dispatch an event that can be listened to by other scripts
                const authEvent = new CustomEvent('lhdn-auth-status-changed', {
                    detail: { authenticated: false, error }
                });
                window.dispatchEvent(authEvent);
            }

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
        // Try to refresh the token first
        this.checkLHDNAuthStatus(true).then(isAuthenticated => {
            if (isAuthenticated) {
                console.log('Authentication refreshed successfully');

                // Show success message
                if (window.Swal) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Authentication Refreshed',
                        text: 'Your authentication has been refreshed automatically.',
                        toast: true,
                        position: 'top-end',
                        showConfirmButton: false,
                        timer: 3000
                    });
                }

                return; // Don't show error modal if we successfully refreshed
            }

            // If refresh failed, show the error modal
            this._showAuthErrorModalInternal(error);
        }).catch(() => {
            // If refresh check fails, show the error modal
            this._showAuthErrorModalInternal(error);
        });
    },

    /**
     * Internal method to show authentication error modal
     * @private
     * @param {Object} error - The error object
     */
    _showAuthErrorModalInternal(error) {
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
                                <li>Try refreshing the token first</li>
                                <li>If that doesn't work, log out and log back in</li>
                                <li>Then try your operation again</li>
                            </ul>
                        </div>
                    </div>
                `,
                showDenyButton: true,
                showCancelButton: true,
                confirmButtonText: 'Refresh Token',
                denyButtonText: 'Logout Now',
                cancelButtonText: 'Later',
                customClass: {
                    confirmButton: 'btn btn-primary',
                    denyButton: 'btn btn-danger',
                    cancelButton: 'btn btn-secondary'
                }
            }).then((result) => {
                if (result.isConfirmed) {
                    // Try to refresh token
                    this.checkLHDNAuthStatus(true).then(isAuthenticated => {
                        if (isAuthenticated) {
                            Swal.fire({
                                icon: 'success',
                                title: 'Success',
                                text: 'Authentication token refreshed successfully',
                                timer: 2000,
                                showConfirmButton: false
                            });
                        } else {
                            Swal.fire({
                                icon: 'error',
                                title: 'Failed',
                                text: 'Could not refresh authentication token. Please log out and log back in.',
                                confirmButtonText: 'Logout Now',
                                showCancelButton: true,
                                cancelButtonText: 'Later'
                            }).then((result) => {
                                if (result.isConfirmed) {
                                    window.location.href = '/logout';
                                }
                            });
                        }
                    });
                } else if (result.isDenied) {
                    window.location.href = '/logout';
                }
            });
        } else {
            // Fallback to alert if SweetAlert2 is not available
            const logout = confirm(`Authentication Error: ${error.message}\n\nPlease log out and log back in to refresh your session. Logout now?`);
            if (logout) {
                window.location.href = '/logout';
            }
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

export default AuthStatusUtil;
