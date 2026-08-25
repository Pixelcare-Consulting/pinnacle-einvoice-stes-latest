// Session monitoring and timeout alerts - COMPLETELY DISABLED
// This file has been disabled to rely solely on server-side session management
// Frontend session checking is no longer used - all session validation happens via middleware
(function() {
    // This file is kept as a placeholder but all functionality has been disabled
    console.log('Session monitoring completely disabled - using server middleware only');

    // Redirect to login page - only function kept for compatibility
    function redirectToLogin() {
        // Save current URL to return after login
        const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?returnUrl=${returnUrl}`;
    }

    // Make redirectToLogin available globally for backward compatibility
    window.redirectToLogin = redirectToLogin;
})();