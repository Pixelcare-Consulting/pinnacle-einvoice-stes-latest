/**
 * Global AJAX Response Interceptor
 * Automatically redirects to login page when session expires
 */
(function() {
    // Original fetch function
    const originalFetch = window.fetch;

    // Helper function to check if we're already on the login page
    function isLoginPage() {
        return window.location.pathname.includes('/auth/login') ||
               window.location.pathname === '/login' ||
               window.location.pathname === '/';
    }

    // Helper function to check if the request is for a public resource
    function isPublicResource(url) {
        const publicPaths = [
            '/auth/login',
            '/auth/register',
            '/auth/logout',
            '/api/user/auth/logout',
            '/api/v1/auth/login',
            '/api/v1/auth/register',
            '/api/v1/auth/logout',
            '/assets',
            '/favicon.ico',
            '/public',
            '/uploads',
            '/vendor',
            '/api/health',
            '/api/user/check-session',
            '/'
        ];

        // Convert the URL to a path if it's a full URL
        let path = url;
        try {
            if (url.startsWith('http')) {
                const urlObj = new URL(url);
                path = urlObj.pathname;
            }
        } catch (e) {
            // If URL parsing fails, just use the original url
        }

        return publicPaths.some(publicPath => path.startsWith(publicPath));
    }

    // Override fetch to handle 401 responses
    window.fetch = async function(...args) {
        try {
            // Check if the request is for a public resource
            const url = args[0]?.url || args[0];
            const isPublic = isPublicResource(url);

            const response = await originalFetch.apply(this, args);

            // Check if response is 401 Unauthorized
            if (response.status === 401 && !isPublic && !isLoginPage()) {
                // Clone the response to read it
                const clonedResponse = response.clone();

                try {
                    // Try to parse the response as JSON
                    const data = await clonedResponse.json();

                    // If we have a redirect URL in the response, use it
                    if (data.redirect) {
                        console.log('Session expired, redirecting to:', data.redirect);
                        window.location.replace(data.redirect);
                        return response; // Return original response
                    }
                } catch (e) {
                    // If we can't parse as JSON, just redirect to login
                    console.log('Session expired, redirecting to login');
                    window.location.replace('/auth/login?expired=true&reason=timeout');
                    return response; // Return original response
                }

                // If we don't have a redirect URL, redirect to login
                console.log('Session expired, redirecting to login');
                window.location.replace('/auth/login?expired=true&reason=timeout');
            }

            return response;
        } catch (error) {
            // Pass through any network errors
            throw error;
        }
    };

    // Override XMLHttpRequest to handle 401 responses
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(...args) {
        // Store the method and URL
        this._method = args[0];
        this._url = args[1];

        return originalXHROpen.apply(this, args);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        // Add a load event listener to check for 401 responses
        this.addEventListener('load', function() {
            // Check if we're already on the login page or if this is a public resource
            const isPublic = isPublicResource(this._url);

            if (this.status === 401 && !isPublic && !isLoginPage()) {
                try {
                    // Try to parse the response as JSON
                    const data = JSON.parse(this.responseText);

                    // If we have a redirect URL in the response, use it
                    if (data.redirect) {
                        console.log('Session expired, redirecting to:', data.redirect);
                        window.location.replace(data.redirect);
                        return;
                    }
                } catch (e) {
                    // If we can't parse as JSON, just redirect to login
                    console.log('Session expired, redirecting to login');
                    window.location.replace('/auth/login?expired=true&reason=timeout');
                    return;
                }

                // If we don't have a redirect URL, redirect to login
                console.log('Session expired, redirecting to login');
                window.location.replace('/auth/login?expired=true&reason=timeout');
            }
        });

        return originalXHRSend.apply(this, args);
    };

    console.log('Session interceptor initialized - Auto-redirecting on session expiry');
})();
