// Error code translations
const ValidationTranslations = {
    errorCodes: {
        'CV302': 'Invalid Code Value',
        'Error04': 'Field Validation Error',
        'CV303': 'Invalid Format',
        'CV304': 'Required Field Missing',
        'CV305': 'Invalid Date Format',
        'CV306': 'Invalid Number Format',
        'CV307': 'Invalid Currency Format',
        'CV308': 'Invalid Tax Code',
        'CV309': 'Invalid Document Type',
        'CV310': 'Invalid Reference',
    },

    // Field translations
    fields: {
        'AccountingSupplierParty.Party.PostalAddress.CountrySubentityCode': 'Supplier State Code',
        'AccountingCustomerParty.Party.PostalAddress.CountrySubentityCode': 'Customer State Code',
        'InvoiceLine.Item.CommodityClassification.ItemClassificationCode': 'Item Classification Code',
        'AccountingSupplierParty.Party.PartyTaxScheme.CompanyID': 'Supplier Tax ID',
        'AccountingCustomerParty.Party.PartyTaxScheme.CompanyID': 'Customer Tax ID',
        'InvoiceLine.Item.Description': 'Item Description',
        'PaymentMeans.PaymentMeansCode': 'Payment Method',
        'DocumentCurrencyCode': 'Currency Code',
        'TaxCurrencyCode': 'Tax Currency Code',
        'PaymentCurrencyCode': 'Payment Currency Code',
        'PaymentTerms.Note': 'Payment Terms',
        'InvoicePeriod.StartDate': 'Invoice Period Start',
        'InvoicePeriod.EndDate': 'Invoice Period End'
    },

    // Error message patterns and their translations
    patterns: [
        {
            pattern: /ItemCode (.*?) does not exist in CodeType State Codes/,
            translation: (matches) => `The state code "${matches[1]}" is not in the correct format. Please use the official state code.`
        },
        {
            pattern: /ItemCode (.*?) does not exist in CodeType Classification Codes/,
            translation: (matches) => `The classification code "${matches[1]}" is not valid. Please use a valid item classification code.`
        },
        {
            pattern: /Invalid Code Field Validator/,
            translation: () => 'One or more fields contain invalid codes. Please check the details below.'
        }
    ],

    // Helper function to get readable field name
    getFieldName(path) {
        if (!path) return "Not specified";
        
        // Remove JSON path syntax
        let readable = path.replace(/\$\.Invoice\[\*\]\./, '');
        readable = readable.replace(/\[\*\]/g, '');
        readable = readable.replace(/\._$/, '');
        
        return this.fields[readable] || readable;
    },

    // Helper function to get readable error message
    getErrorMessage(error) {
        if (!error) return "Not specified";
        
        // Remove technical prefixes
        error = error.replace(/^Step\d+-/, '');
        
        // Try to match patterns and get translation
        for (const {pattern, translation} of this.patterns) {
            const matches = error.match(pattern);
            if (matches) {
                return translation(matches);
            }
        }
        
        return error;
    },

    // Helper function to get error type description
    getErrorType(code) {
        return this.errorCodes[code] || code || "Unknown Error";
    }
};

// Export for use in other files
window.ValidationTranslations = ValidationTranslations; 