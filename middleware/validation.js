const validateInvoiceData = (req, res, next) => {
    const { invoiceData } = req.body;
    
    if (!invoiceData) {
        return res.status(400).json({
            success: false,
            message: 'Invoice data is required'
        });
    }
    
    // Add more validation as needed
    next();
};

const validateDateRange = (req, res, next) => {
    const { fromDate, toDate } = req.query;
    
    if (!fromDate || !toDate) {
        return res.status(400).json({
            success: false,
            message: 'Both fromDate and toDate are required'
        });
    }
    
    if (new Date(fromDate) > new Date(toDate)) {
        return res.status(400).json({
            success: false,
            message: 'fromDate cannot be after toDate'
        });
    }
    
    next();
};

module.exports = {
    validateInvoiceData,
    validateDateRange
};
