const formatLHDNError = (error) => {
    // Handle when TaxTotal is empty array or missing
    if (error.includes('"TaxTotal": []') || error.includes('TaxTotal is required')) {
        return {
            type: 'Tax Error',
            message: 'Missing tax information. Please ensure all line items have valid tax details.',
            details: [
                'Each line item must have:',
                '- Tax amount',
                '- Tax type (01-06 or E)',
                '- Tax rate/percent',
                '- For type E: exemption reason'
            ],
            suggestion: 'Check each line item for complete tax information'
        };
    }

    // Map other common LHDN errors to user-friendly messages
    const errorMappings = {
        'CF366': 'Invalid tax type. Must be one of: Sales Tax (01), Service Tax (02), Tourism Tax (03), High-Value Goods Tax (04), Low Value Goods Tax (05), Not Applicable (06), or Exempt (E)',
        'CF367': 'For tax type "Not Applicable (06)", all tax amounts and rates must be zero',
        'CF369': 'Tax exemption reason is required when using tax type E',
        'CF373': 'Tax inclusive amount must match the sum of tax exclusive amount plus total tax',
        'CF417': 'Incoterms must be 1 to 3 letters (for example CIF). Purchase orders and invoice numbers are not Incoterms',
        'CF701': 'Business activity description is required'
    };

    // Return formatted error object
    return {
        type: 'LHDN Validation Error',
        message: errorMappings[error.code] || error.message,
        details: error.details || [],
        suggestion: error.suggestion || 'Please check and correct the tax information'
    };
};

module.exports = { formatLHDNError };