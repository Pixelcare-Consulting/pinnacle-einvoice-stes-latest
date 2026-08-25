/**
 * Global Fetch Wrapper
 * Non-module version of the fetch wrapper for use in non-module scripts
 */

(function(window) {
    'use strict';

    // Default options for fetch requests
    const defaultOptions = {
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json'
        },
        timeout: 30000, // 30 seconds
        retries: 2,
        retryDelay: 1000, // 1 second
        handleAuthErrors: true,
        showErrorToast: true
    };

    // Fetch wrapper with enhanced error handling
    const FetchWrapper = {
        /**
         * Make a fetch request with enhanced error handling
         * @param {string} url - The URL to fetch
         * @param {Object} options - Fetch options
         * @returns {Promise<any>} - The response data
         */
        async fetch(url, options = {}) {
            // Merge default options with provided options
            const fetchOptions = {
                ...defaultOptions,
                ...options,
                headers: {
                    ...defaultOptions.headers,
                    ...options.headers
                }
            };

            // Extract non-fetch options
            const {
                timeout,
                retries,
                retryDelay,
                handleAuthErrors,
                showErrorToast,
                ...actualFetchOptions
            } = fetchOptions;

            // Initialize retry counter
            let retryCount = 0;
            let lastError = null;

            // Create AbortController for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            // Add signal to fetch options
            actualFetchOptions.signal = controller.signal;

            while (retryCount <= retries) {
                try {
                    // Make the fetch request
                    const response = await fetch(url, actualFetchOptions);

                    // Clear timeout
                    clearTimeout(timeoutId);

                    // Check if response is OK
                    if (!response.ok) {
                        // Handle authentication errors
                        if (response.status === 401 || response.status === 403) {
                            if (handleAuthErrors && window.AuthStatusUtil) {
                                const authError = {
                                    code: 'AUTH_ERROR',
                                    message: 'Authentication error. Please log in again.',
                                    details: 'Your session may have expired or the authentication token is invalid.'
                                };
                                
                                // Show auth error modal
                                window.AuthStatusUtil.showAuthErrorModal(authError);
                                
                                throw new Error('Authentication error. Please log in again.');
                            }
                        }

                        // Try to parse error response
                        const errorData = await response.json().catch(() => ({
                            message: `HTTP error! status: ${response.status}`
                        }));

                        // Create error object
                        const error = new Error(errorData.message || `HTTP error! status: ${response.status}`);
                        error.status = response.status;
                        error.code = errorData.code || 'HTTP_ERROR';
                        error.details = errorData.details || null;
                        
                        // Throw the error
                        throw error;
                    }

                    // Parse response as JSON
                    return await response.json();
                } catch (error) {
                    // Clear timeout
                    clearTimeout(timeoutId);

                    // Save the last error
                    lastError = error;

                    // Handle specific error types
                    if (error.name === 'AbortError') {
                        throw new Error('Request timed out. Please try again.');
                    }

                    // Check if we should retry
                    if (retryCount < retries) {
                        // Wait before retrying
                        await new Promise(resolve => setTimeout(resolve, retryDelay * (retryCount + 1)));
                        retryCount++;
                        console.log(`Retrying fetch (${retryCount}/${retries})...`);
                    } else {
                        // Handle authentication errors
                        if (error.message?.includes('authentication') && handleAuthErrors && window.AuthStatusUtil) {
                            const authError = window.AuthStatusUtil.handleAuthError(error);
                            window.AuthStatusUtil.showAuthErrorModal(authError);
                        } else if (showErrorToast && window.Swal) {
                            // Show error toast if enabled and SweetAlert2 is available
                            window.Swal.fire({
                                icon: 'error',
                                title: 'Error',
                                text: error.message || 'Failed to fetch data',
                                toast: true,
                                position: 'top-end',
                                showConfirmButton: false,
                                timer: 5000
                            });
                        }
                        
                        // Format the error
                        const formattedError = {
                            message: error.message || 'Failed to fetch',
                            code: error.code || 'FETCH_ERROR',
                            details: error.details || error.stack,
                            status: error.status || 500
                        };
                        
                        // Throw the formatted error
                        throw formattedError;
                    }
                }
            }

            // This should never be reached, but just in case
            throw lastError || new Error('Failed to fetch after retries');
        },

        /**
         * Make a GET request
         * @param {string} url - The URL to fetch
         * @param {Object} options - Fetch options
         * @returns {Promise<any>} - The response data
         */
        async get(url, options = {}) {
            return this.fetch(url, {
                method: 'GET',
                ...options
            });
        },

        /**
         * Make a POST request
         * @param {string} url - The URL to fetch
         * @param {Object} data - The data to send
         * @param {Object} options - Fetch options
         * @returns {Promise<any>} - The response data
         */
        async post(url, data, options = {}) {
            return this.fetch(url, {
                method: 'POST',
                body: JSON.stringify(data),
                ...options
            });
        },

        /**
         * Make a PUT request
         * @param {string} url - The URL to fetch
         * @param {Object} data - The data to send
         * @param {Object} options - Fetch options
         * @returns {Promise<any>} - The response data
         */
        async put(url, data, options = {}) {
            return this.fetch(url, {
                method: 'PUT',
                body: JSON.stringify(data),
                ...options
            });
        },

        /**
         * Make a DELETE request
         * @param {string} url - The URL to fetch
         * @param {Object} options - Fetch options
         * @returns {Promise<any>} - The response data
         */
        async delete(url, options = {}) {
            return this.fetch(url, {
                method: 'DELETE',
                ...options
            });
        }
    };

    // Expose FetchWrapper to window
    window.FetchWrapper = FetchWrapper;

})(window);
