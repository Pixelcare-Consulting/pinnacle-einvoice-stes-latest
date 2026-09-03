const moment = require('moment');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { processExcelData } = require('./processExcelData');
const { collectSdkValidationErrors, hasMeaningfulValue } = require('./sdkFieldLimits');
const prisma = require('../../src/lib/prisma');

class ValidationError extends Error {
    constructor(message, validationErrors = [], fileName = null) {
        super(message);
        this.name = 'ValidationError';
        this.validationErrors = validationErrors;
        this.fileName = fileName;
    }
}

async function lookupCompanyIndustry(companyName) {
    if (!companyName) {
        return '';
    }
    try {
        const exact = await prisma.wP_COMPANY_SETTINGS.findFirst({
            where: { CompanyName: String(companyName) }
        });
        if (exact?.Industry) {
            return exact.Industry;
        }
        const fuzzy = await prisma.wP_COMPANY_SETTINGS.findFirst({
            where: { CompanyName: { contains: String(companyName) } }
        });
        return fuzzy?.Industry || '';
    } catch (error) {
        console.error('Failed to load company industry:', error.message);
        return '';
    }
}

async function validateExcelFile(fileName, type, company, date, networkPath) {
    console.log('Starting validation with params:', { fileName, type, company, date });
    
    if (!fileName || !type || !company || !date) {
        console.error('Missing required parameters:', { fileName, type, company, date });
        throw new ValidationError('Missing required parameters for validation', [], fileName);
    }

    // Format date consistently
    const formattedDate = moment(date).format('YYYY-MM-DD');
    const filePath = path.join(networkPath, type, company, formattedDate, fileName);

    try {
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            throw new ValidationError(`File not found: ${fileName}`, [{
                code: 'FILE_NOT_FOUND',
                message: 'The Excel file could not be found in the specified location',
                target: 'file',
                propertyPath: null,
                validatorType: 'System'
            }], fileName);
        }

        // Read Excel file
        const workbook = XLSX.readFile(filePath);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const excelData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        console.log('Excel data structure:', {
            sheetCount: workbook.SheetNames.length,
            firstSheetName: workbook.SheetNames[0],
            rowCount: excelData.length,
            firstRow: excelData[0]
        });

        const companyIndustry = await lookupCompanyIndustry(company);
        const processedData = processExcelData(excelData, { companyIndustry });
        
        if (!Array.isArray(processedData) || processedData.length === 0) {
            throw new ValidationError('Invalid file content', [{
                code: 'INVALID_CONTENT',
                message: 'The Excel file structure does not match the expected format. Please ensure it contains description row, field mappings row, and data rows.',
                target: 'content',
                propertyPath: null,
                validatorType: 'Format'
            }], fileName);
        }

        const rawData = processedData[0];

        if (!rawData) {
            throw new ValidationError('Invalid file content', [{
                code: 'INVALID_CONTENT',
                message: 'No valid document data found in the Excel file. Please check the file format and content.',
                target: 'content',
                propertyPath: null,
                validatorType: 'Format'
            }], fileName);
        }

        const validationErrors = [];

        // Header Validation (Mandatory fields)
        if (!rawData.header) {
            validationErrors.push({
                row: 'Header',
                errors: ['Missing header information']
            });
        } else {
            const headerErrors = [];
            const header = rawData.header;
            
            if (!header.invoiceNo) headerErrors.push('Missing invoice number');
            if (!header.invoiceType) headerErrors.push('Missing invoice type');
            
            // Validate issue date
            if (!header.issueDate?.[0]?._) {
                headerErrors.push('Missing issue date');
            } else {
                const issueDate = moment(header.issueDate[0]._);
                const today = moment();
                const daysDiff = today.diff(issueDate, 'days');
                
                if (daysDiff > 7) {
                    headerErrors.push({
                        code: 'CF321',
                        message: 'Issuance date time value of the document is too old that cannot be submitted.',
                        target: 'DatetimeIssued',
                        propertyPath: 'Invoice.IssueDate AND Invoice.IssueTime'
                    });
                }
            }
            
            if (!header.issueTime?.[0]?._) headerErrors.push('Missing issue time');
            if (!header.currency) headerErrors.push('Missing currency');
          
            if (headerErrors.length > 0) {
                validationErrors.push({
                    row: 'Header',
                    errors: headerErrors
                });
            }
        }

        // Items Validation
        if (!rawData.items || !Array.isArray(rawData.items)) {
            validationErrors.push({
                row: 'Items',
                errors: ['No items found in document']
            });
        } else {
            const validItems = rawData.items.filter(item => 
                item && 
                item.lineId &&
                item.quantity > 0 && 
                item.unitPrice > 0 &&
                item.item?.classification?.code &&
                item.item?.classification?.type &&
                hasMeaningfulValue(item.item?.description)
            );

            if (validItems.length === 0) {
                validationErrors.push({
                    row: 'Items',
                    errors: ['No valid items found in document']
                });
            } else {
                validItems.forEach((item, index) => {
                    const itemErrors = [];
                    const lineNumber = index + 1;

                    // Validate tax information
                    if (item.taxTotal) {
                        const taxSubtotal = item.taxTotal.taxSubtotal?.[0];
                        if (!taxSubtotal) {
                            itemErrors.push({
                                code: 'CF366',
                                message: 'Missing tax subtotal information',
                                target: 'TaxSubtotal',
                                propertyPath: `Invoice.InvoiceLine[${lineNumber}].TaxTotal.TaxSubtotal`
                            });
                        } else {
                            const taxTypeCode = taxSubtotal.taxCategory?.id;
                            
                            if (!['01', '02', '03', '04', '05', '06', 'E'].includes(taxTypeCode)) {
                                itemErrors.push({
                                    code: 'CF366',
                                    message: 'Invalid tax type code',
                                    target: 'TaxTypeCode',
                                    propertyPath: `Invoice.InvoiceLine[${lineNumber}].TaxTotal.TaxSubtotal[0].TaxCategory.ID`
                                });
                            }

                            if (taxTypeCode === '06') {
                                if (taxSubtotal.taxAmount !== 0 || taxSubtotal.taxCategory?.percent !== 0) {
                                    itemErrors.push({
                                        code: 'CF367',
                                        message: 'For tax type 06 (Not Applicable), all tax amounts and rates must be zero',
                                        target: 'TaxTotal',
                                        propertyPath: `Invoice.InvoiceLine[${lineNumber}].TaxTotal`
                                    });
                                }
                            } else if (taxTypeCode === 'E') {
                                if (!taxSubtotal.taxCategory?.exemptionReason) {
                                    itemErrors.push({
                                        code: 'CF369',
                                        message: 'Tax exemption reason is required for tax type E',
                                        target: 'TaxExemptionReason',
                                        propertyPath: `Invoice.InvoiceLine[${lineNumber}].TaxTotal.TaxSubtotal[0].TaxCategory.ExemptionReason`
                                    });
                                }
                            }
                        }
                    }

                    if (itemErrors.length > 0) {
                        validationErrors.push({
                            row: `Item ${lineNumber}`,
                            errors: itemErrors
                        });
                    }
                });
            }
        }

        // Summary Validation
        if (!rawData.summary) {
            validationErrors.push({
                row: 'Summary',
                errors: ['Missing document summary']
            });
        } else {
            const summaryErrors = [];
            const summary = rawData.summary;

            // Validate amounts
            if (!summary.amounts?.lineExtensionAmount) summaryErrors.push('Missing line extension amount');
            if (!summary.amounts?.taxExclusiveAmount) summaryErrors.push('Missing tax exclusive amount');
            if (!summary.amounts?.taxInclusiveAmount) summaryErrors.push('Missing tax inclusive amount');
            if (!summary.amounts?.payableAmount) summaryErrors.push('Missing payable amount');

            // Validate tax total
            if (!summary.taxTotal) {
                summaryErrors.push({
                    code: 'CF380',
                    message: 'Missing TaxTotal information',
                    target: 'TaxTotal',
                    propertyPath: 'Invoice.TaxTotal'
                });
            } else {
                const taxTotal = summary.taxTotal;
                
                if (!taxTotal.taxSubtotal || !Array.isArray(taxTotal.taxSubtotal)) {
                    summaryErrors.push({
                        code: 'CF381',
                        message: 'Missing or invalid tax subtotal information',
                        target: 'TaxSubtotal',
                        propertyPath: 'Invoice.TaxTotal.TaxSubtotal'
                    });
                }
            }

            if (summaryErrors.length > 0) {
                validationErrors.push({
                    row: 'Summary',
                    errors: summaryErrors
                });
            }
        }

        const sdkErrors = collectSdkValidationErrors(rawData);
        if (sdkErrors.length > 0) {
            validationErrors.push({
                row: 'LHDN fields',
                errors: sdkErrors
            });
        }

        if (validationErrors.length > 0) {
            throw new ValidationError('Validation failed', validationErrors, fileName);
        }

        return {
            success: true,
            data: rawData,
            message: 'Validation successful'
        };

    } catch (error) {
        if (error instanceof ValidationError) {
            throw error;
        }
        throw new ValidationError('Validation failed', [{
            code: 'VALIDATION_ERROR',
            message: error.message,
            target: 'file',
            propertyPath: null,
            validatorType: 'System'
        }], fileName);
    }
}

module.exports = {
    validateExcelFile,
    ValidationError,
    lookupCompanyIndustry
}; 