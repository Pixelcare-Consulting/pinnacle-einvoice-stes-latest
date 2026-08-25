/**
 * Utility Loader
 * Loads all utility modules and makes them available globally
 */

// Import utilities
import AuthStatusUtil from './auth-status.js';
import FetchWrapper from './fetch-wrapper.js';

// Make utilities available globally
window.AuthStatusUtil = AuthStatusUtil;
window.FetchWrapper = FetchWrapper;

// Add global authentication state
window.authState = {
    initialized: false,
    authenticated: false,
    authChecked: false,
    loading: true,
    error: null
};

// Create a promise that resolves when authentication check is complete
window.authReadyPromise = new Promise((resolve) => {
    window.resolveAuthReady = resolve;
});

// Helper function to wait for authentication to be checked
window.waitForAuth = async function() {
    if (window.authState.authChecked) {
        return window.authState.authenticated;
    }

    console.log('Waiting for authentication check to complete...');
    await window.authReadyPromise;
    return window.authState.authenticated;
};

// Initialize utilities
(function() {
    console.log('Initializing utility modules...');

    // Check authentication status on page load
    AuthStatusUtil.checkLHDNAuthStatus()
        .then(status => {
            console.log('Authentication status checked:', status);

            // Update global auth state
            window.authState.authenticated = status;
            window.authState.authChecked = true;
            window.authState.loading = false;

            // Resolve the auth ready promise
            if (window.resolveAuthReady) {
                window.resolveAuthReady(status);
            }

            if (!status) {
                console.warn('User is not authenticated with LHDN');

                // Dispatch an event that can be listened to by other scripts
                const authEvent = new CustomEvent('lhdn-auth-status-changed', {
                    detail: { authenticated: false }
                });
                window.dispatchEvent(authEvent);
            } else {
                console.log('User is authenticated with LHDN');

                // Dispatch an event that can be listened to by other scripts
                const authEvent = new CustomEvent('lhdn-auth-status-changed', {
                    detail: { authenticated: true }
                });
                window.dispatchEvent(authEvent);
            }
        })
        .catch(error => {
            console.error('Error checking authentication status:', error);

            // Update global auth state
            window.authState.error = error;
            window.authState.authChecked = true;
            window.authState.loading = false;

            // Resolve the auth ready promise
            if (window.resolveAuthReady) {
                window.resolveAuthReady(false);
            }

            // Dispatch an event that can be listened to by other scripts
            const authEvent = new CustomEvent('lhdn-auth-status-changed', {
                detail: { authenticated: false, error }
            });
            window.dispatchEvent(authEvent);
        });

    // Add global fetch error handler
    window.addEventListener('unhandledrejection', function(event) {
        // Check if it's a fetch error
        if (event.reason &&
            (event.reason.message === 'Failed to fetch' ||
             event.reason.code === 'VALIDATION_ERROR')) {

            console.error('Unhandled fetch error:', event.reason);

            // Check if it's an authentication error
            if (event.reason.status === 401 ||
                event.reason.status === 403 ||
                event.reason.message?.includes('authentication') ||
                event.reason.message?.includes('token')) {

                // Update global auth state
                window.authState.authenticated = false;

                // Show authentication error modal
                AuthStatusUtil.showAuthErrorModal({
                    code: 'AUTH_ERROR',
                    message: 'Authentication error. Please log in again.',
                    details: 'Your session may have expired or the authentication token is invalid.'
                });

                // Dispatch an event that can be listened to by other scripts
                const authEvent = new CustomEvent('lhdn-auth-status-changed', {
                    detail: { authenticated: false, error: event.reason }
                });
                window.dispatchEvent(authEvent);

                // Prevent default error handling
                event.preventDefault();
            }
        }
    });

    // Mark utilities as initialized
    window.authState.initialized = true;
    console.log('Utility modules initialized');
})();
