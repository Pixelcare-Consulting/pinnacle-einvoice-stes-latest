/**
 * Simple TIN Validator
 * A lightweight implementation for validating Malaysian Tax Identification Numbers (TIN)
 * Based on LHDN API specification: https://sdk.myinvois.hasil.gov.my/einvoicingapi/01-validate-taxpayer-tin/
 */

class SimpleTINValidator {
    constructor() {
        this.API_ENDPOINT = '/api/v1.0/taxpayer/validate';
        this.cache = new Map();
        
        // Initialize once DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initialize());
        } else {
            this.initialize();
        }
    }

    /**
     * Initialize the validator
     */
    initialize() {
        // Find the form elements
        this.form = document.getElementById('simple-tin-form');
        if (!this.form) {
            console.error('TIN validation form not found. Add a form with ID "simple-tin-form"');
            return;
        }

        // Add event listener to form
        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.validateFormTIN();
        });

        console.log('Simple TIN Validator initialized');
    }

    /**
     * Validate TIN from form input
     */
    async validateFormTIN() {
        // Get form input values
        const tin = document.getElementById('tin-number').value.trim();
        const idType = document.getElementById('id-type').value;
        const idValue = document.getElementById('id-value').value.trim();
        
        // Get result container
        const resultContainer = document.getElementById('validation-result');
        
        // Show loading state
        resultContainer.innerHTML = '<div class="alert alert-info">Validating...</div>';
        
        try {
            // Perform validation
            const result = await this.validateTIN(tin, idType, idValue);
            
            // Display result
            if (result.isValid) {
                resultContainer.innerHTML = `
                    <div class="alert alert-success">
                        <strong>Valid TIN!</strong> The TIN and ID combination is valid.
                    </div>
                `;
            } else {
                resultContainer.innerHTML = `
                    <div class="alert alert-danger">
                        <strong>Invalid TIN!</strong> ${result.message}
                    </div>
                `;
            }
        } catch (error) {
            // Display error
            resultContainer.innerHTML = `
                <div class="alert alert-danger">
                    <strong>Error:</strong> ${error.message}
                </div>
            `;
        }
    }

    /**
     * Validate a TIN using the LHDN API
     * 
     * @param {string} tin - The Tax Identification Number
     * @param {string} idType - ID Type (NRIC, PASSPORT, BRN, ARMY)
     * @param {string} idValue - The corresponding ID value
     * @returns {Promise<Object>} - Validation result
     */
    async validateTIN(tin, idType, idValue) {
        // Input validation
        if (!tin) throw new Error('TIN is required');
        if (!idType) throw new Error('ID Type is required');
        if (!idValue) throw new Error('ID Value is required');
        
        // Generate cache key
        const cacheKey = `${tin}-${idType}-${idValue}`;
        
        // Check cache first
        if (this.cache.has(cacheKey)) {
            console.log('Using cached TIN validation result');
            return this.cache.get(cacheKey);
        }
        
        try {
            // Generate request ID for tracking
            const requestId = Math.random().toString(36).substring(2, 15);
            
            // Get current date in ISO format for X-Date header
            const currentDate = new Date().toISOString();
            
            // Build standard LHDN headers according to SDK specification
            const headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Request-ID': requestId,
                'X-Date': currentDate,
                'X-Client-ID': 'eInvoice-WebApp',
                'X-Forwarded-For': '', // Browser will set this
                'X-User-Agent': navigator.userAgent || '',
                'X-Channel': 'Web'
            };
            
            // Call the backend API endpoint
            const response = await fetch(`${this.API_ENDPOINT}/${tin}?idType=${idType}&idValue=${idValue}`, {
                method: 'GET',
                headers: headers,
                credentials: 'same-origin' // Include cookies for session authentication
            });
            
            // Check if response is JSON
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                if (response.status === 401) {
                    return {
                        isValid: false,
                        message: 'Authentication error. Please log in again.'
                    };
                } else {
                    throw new Error('Unexpected server response. Please try again later.');
                }
            }
            
            const data = await response.json();
            
            // Handle different response status codes
            if (!response.ok) {
                if (response.status === 404) {
                    return {
                        isValid: false,
                        message: 'Invalid TIN or ID combination'
                    };
                } else if (response.status === 400) {
                    return {
                        isValid: false,
                        message: 'Invalid input parameters'
                    };
                } else if (response.status === 429) {
                    return {
                        isValid: false,
                        message: 'Too many validation requests. Please try again later.'
                    };
                } else {
                    throw new Error(data.message || 'TIN validation failed');
                }
            }
            
            // Handle successful response
            if (data.success && data.result) {
                const result = {
                    isValid: data.result.isValid,
                    message: 'TIN validation successful',
                    timestamp: data.result.timestamp,
                    cached: data.cached || false,
                    requestId: requestId // Include the request ID for reference
                };
                
                // Cache the successful result
                this.cache.set(cacheKey, result);
                return result;
            } else {
                throw new Error('Invalid response format');
            }
        } catch (error) {
            console.error('TIN validation error:', error);
            return {
                isValid: false,
                message: error.message || 'Error validating TIN. Please try again later.'
            };
        }
    }
}

// Create and expose the validator instance
const simpleTINValidator = new SimpleTINValidator(); 