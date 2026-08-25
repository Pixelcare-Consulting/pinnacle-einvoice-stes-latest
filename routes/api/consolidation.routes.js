const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const prisma = require('../../src/lib/prisma');
const { auth }  = require('../../middleware/index-prisma');

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../public/uploads/consolidation');

        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'flatfile-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        // Accept only csv and txt files
        const filetypes = /csv|txt/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }

        cb(new Error('Error: File upload only supports CSV and TXT files!'));
    }
});

// API endpoint for uploading flat files
router.post('/upload-flat-file', [auth.isApiAuthenticated, upload.single('file')], async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const filePath = req.file.path;
        const results = [];

        // Parse CSV file
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                try {
                    // Store data in database
                    const processedRecords = await storeDataInDatabase(results, req.user.id);

                    // Return success response
                    res.json({
                        success: true,
                        message: 'File uploaded and processed successfully',
                        recordsProcessed: processedRecords.length,
                        fileName: req.file.originalname
                    });
                } catch (dbError) {
                    console.error('Database error:', dbError);
                    res.status(500).json({
                        success: false,
                        message: 'Error processing file data',
                        error: dbError.message
                    });
                }
            });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Error uploading file',
            error: error.message
        });
    }
});

// API endpoint to get flat file data
router.get('/flat-file-data', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const flatFiles = await database.WP_FLATFILE.findAll({
            order: [['upload_date', 'DESC']],
            limit: 1000
        });

        res.json({
            success: true,
            data: flatFiles
        });
    } catch (error) {
        console.error('Error fetching flat file data:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching flat file data',
            error: error.message
        });
    }
});

// API endpoint to map flat file record to LHDN format
router.post('/map-flat-file/:id', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { id } = req.params;
        const mappingDetails = req.body;

        const updated = await database.WP_FLATFILE.update({
            is_mapped: true,
            mapping_details: JSON.stringify(mappingDetails),
            processed_by: req.user.id,
            processed_date: new Date()
        }, {
            where: { id }
        });

        if (updated[0] === 0) {
            return res.status(404).json({
                success: false,
                message: 'Record not found'
            });
        }

        res.json({
            success: true,
            message: 'Record mapped successfully'
        });
    } catch (error) {
        console.error('Error mapping flat file:', error);
        res.status(500).json({
            success: false,
            message: 'Error mapping flat file',
            error: error.message
        });
    }
});

// API endpoint to submit mapped flat file to LHDN
router.post('/submit-mapped-file/:id', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const { id } = req.params;

        const record = await database.WP_FLATFILE.findOne({
            where: {
                id,
                is_mapped: true
            }
        });

        if (!record) {
            return res.status(404).json({
                success: false,
                message: 'Mapped record not found'
            });
        }

        const mappingDetails = JSON.parse(record.mapping_details || '{}');

        // TODO: Call LHDN submission API with mapped data
        // This would typically call the existing LHDN submission logic
        // with the transformed data

        // Update record status
        await record.update({
            status: 'Submitted',
            submission_id: uuidv4(),
            lhdn_response: JSON.stringify({ status: 'success', timestamp: new Date() })
        });

        res.json({
            success: true,
            message: 'Record submitted to LHDN successfully'
        });
    } catch (error) {
        console.error('Error submitting to LHDN:', error);
        res.status(500).json({
            success: false,
            message: 'Error submitting to LHDN',
            error: error.message
        });
    }
});

// API endpoint to create manual consolidated invoice
router.post('/create-manual', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const {
            invoice_no,
            start_date,
            end_date,
            description,
            classification,
            tax_type,
            tax_rate,
            total_excl_tax,
            tax_amount,
            total_incl_tax,
            transactions,
            receipt_range,
            notes,
            supplier_info,
            line_items,
            is_multiple_line_items // Flag to indicate mode (optional)
        } = req.body;

        // Validate required fields
        if (!invoice_no || !start_date || !end_date ||
            !total_excl_tax || !total_incl_tax) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Validate that we have at least one line item
        if (!line_items || line_items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'At least one line item is required'
            });
        }

        // Prepare data for consolidated invoice
        const consolidatedData = {
            supplier_name: supplier_info?.company_name || 'Company Name',
            supplier_tin: supplier_info?.tin_number || 'T0000000',
            supplier_brn: supplier_info?.business_registration_number || 'BRN00000',
            supplier_sst: supplier_info?.sst_number || 'NA',
            supplier_address: supplier_info?.address || 'NA',
            supplier_city: supplier_info?.city || 'NA',
            supplier_state: supplier_info?.state || 'NA',
            supplier_country: supplier_info?.country || 'MYS',
            supplier_contact: supplier_info?.contact_number || 'NA',
            buyer_name: 'General Public',
            buyer_tin: 'EI00000000010',
            buyer_brn: 'NA',
            buyer_sst: 'NA',
            buyer_address: 'NA',
            buyer_city: 'NA',
            buyer_state: 'NA',
            buyer_country: 'NA',
            buyer_contact: 'NA',
            invoice_no: invoice_no,
            invoice_date: end_date, // End date is used as the invoice date for consolidated invoices
            invoice_time: '23:59:00Z',
            currency_code: 'MYR',
            exchange_rate: '1.0000',
            einvoice_version: '1.0',
            einvoice_type: '01', // Standard invoice
            item_description: description || (line_items && line_items.length > 0 ? line_items[0].description : ''),
            classification: classification || (line_items && line_items.length > 0 ? line_items[0].classification : ''),
            tax_type: tax_type || (line_items && line_items.length > 0 ? line_items[0].tax_type : ''),
            tax_rate: tax_rate || (line_items && line_items.length > 0 ? line_items[0].tax_rate : '0'),
            tax_amount: tax_amount,
            total_excl_tax: total_excl_tax,
            total_incl_tax: total_incl_tax,
            notes: notes,
            status: 'Pending',
            creation_type: 'Manual',
            billing_period_start: start_date,
            billing_period_end: end_date,
            transactions_count: transactions || line_items.length || 0,
            receipt_range: receipt_range || 'NA',
            processed_by: req.user.id,
            uuid: uuidv4()
        };

        // Save to database
        const newRecord = await database.WP_FLATFILE.create({
            ...consolidatedData,
            is_mapped: true,
            mapping_details: JSON.stringify({
                consolidationType: 'manual',
                classificationCode: classification === 'G4' ? '004' :
                                   classification === 'S1' ? '005' :
                                   classification === 'S2' ? '006' : '007',
                startDate: start_date,
                endDate: end_date,
                notes: notes,
                line_items: line_items || [],
                is_multiple_line_items: is_multiple_line_items || false
            }),
            upload_date: new Date()
        });

        // Log line items info
        if (line_items && line_items.length > 0) {
            console.log(`Saved ${line_items.length} line item(s) for invoice ${invoice_no}`);

            // You could log each line item for detailed information
            if (line_items.length === 1) {
                console.log(`Single line item: ${line_items[0].description}, Amount: ${line_items[0].amount}`);
            } else {
                console.log(`Multiple line items with total: ${total_incl_tax}`);
            }
        }

        res.json({
            success: true,
            message: 'Consolidated invoice created successfully',
            record: {
                id: newRecord.id,
                uuid: newRecord.uuid,
                invoice_no: newRecord.invoice_no,
                line_items: line_items.length
            }
        });
    } catch (error) {
        console.error('Error creating manual consolidated invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating manual consolidated invoice',
            error: error.message
        });
    }
});

// API endpoint to download CSV template
router.get('/download-template', [auth.isApiAuthenticated], (req, res) => {
    try {
        const templatePath = path.join(__dirname, '../../public/assets/templates/consolidation_template.csv');

        if (!fs.existsSync(templatePath)) {
            return res.status(404).json({
                success: false,
                message: 'Template file not found'
            });
        }

        res.download(templatePath, 'consolidation_template.csv');
    } catch (error) {
        console.error('Error downloading template:', error);
        res.status(500).json({
            success: false,
            message: 'Error downloading template',
            error: error.message
        });
    }
});

// API endpoint to export consolidation data to Excel template
router.post('/export-template', [auth.isApiAuthenticated], async (req, res) => {
    try {
        const {
            invoice_details,
            tax_info,
            currency_info,
            totals,
            line_items,
            supplier_info
        } = req.body;

        // Create a new workbook
        const wb = XLSX.utils.book_new();

        // Prepare the data for Excel - one row per line item
        const excelData = line_items.map(item => ({
            SupplierName: supplier_info?.company_name || '',
            SupplierTIN: supplier_info?.tin_number || '',
            SupplierBRN: supplier_info?.business_registration_number || '',
            SupplierSST: supplier_info?.sst_number || 'NA',
            SupplierAddress: supplier_info?.address || '',
            SupplierAddress1: supplier_info?.address_line_1 || '',
            SupplierAddress2: supplier_info?.address_line_2 || '',
            SupplierCity: supplier_info?.city || '',
            SupplierState: supplier_info?.state || '',
            SupplierPostalZone: supplier_info?.postal_code || '',
            SupplierCountry: supplier_info?.country || 'MYS',
            SupplierContact: supplier_info?.contact_number || '',
            SupplierEmail: supplier_info?.email || '',
            BuyerName: 'General Public',
            BuyerTIN: 'EI00000000010',
            BuyerBRN: 'NA',
            BuyerSST: 'NA',
            BuyerAddress: 'NA',
            BuyerAddress1: '',
            BuyerAddress2: '',
            BuyerCity: 'NA',
            BuyerState: 'NA',
            BuyerPostalZone: '',
            BuyerCountry: 'NA',
            BuyerContact: 'NA',
            BuyerEmail: '',
            InvoiceNo: invoice_details.invoice_no,
            InvoiceDate: invoice_details.end_date,
            InvoiceTime: '23:59:00Z',
            CurrencyCode: currency_info.currency,
            TaxCurrencyCode: 'MYR',
            ExchangeRate: currency_info.exchange_rate,
            BillingPeriodStart: invoice_details.start_date,
            BillingPeriodEnd: invoice_details.end_date,
            BillingFrequency: 'Monthly',
            eInvoiceVersion: '1.0',
            eInvoiceType: '01',
            PaymentDueDate: '',
            PaymentTerms: '30 days',
            PaymentMeans: 'Transfer',
            PaymentMeansCode: '30',
            PaymentID: '',
            AccountID: '',
            PrepaidAmount: '0.00',
            ItemDescription: item.description,
            Classification: item.classification,
            TaxType: item.taxType,
            TaxRate: tax_info.tax_rate,
            TaxAmount: item.taxAmount,
            TaxExemptionReason: item.taxType === '06' ? 'Out of scope of SST' :
                               item.taxType === 'E' ? 'SST Exempted' : '',
            TaxExemptionCode: '',
            DiscountAmount: '0.00',
            DiscountReason: '',
            TotalExclTax: item.amount,
            TotalInclTax: item.totalAmount,
            Note: 'Generated from manual consolidation'
        }));

        // Create worksheet
        const ws = XLSX.utils.json_to_sheet(excelData);

        // Add the worksheet to the workbook
        XLSX.utils.book_append_sheet(wb, ws, 'Consolidated Invoice');

        // Generate buffer
        const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // Set headers for file download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="consolidated_invoice_${invoice_details.invoice_no}.xlsx"`);
        res.setHeader('Content-Length', excelBuffer.length);

        // Send the file
        res.send(excelBuffer);

    } catch (error) {
        console.error('Error generating Excel template:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating Excel template',
            error: error.message
        });
    }
});

// Helper function to store parsed data in database
async function storeDataInDatabase(records, userId) {
    try {
        const processedRecords = [];
        const validationErrors = [];

        // Mandatory field groups according to MyInvois
        const mandatoryFields = {
            supplier: ['SupplierName', 'SupplierTIN', 'SupplierBRN', 'SupplierAddress', 'SupplierCity', 'SupplierState', 'SupplierCountry', 'SupplierContact'],
            buyer: ['BuyerName', 'BuyerTIN', 'BuyerBRN', 'BuyerAddress', 'BuyerCity', 'BuyerState', 'BuyerCountry', 'BuyerContact'],
            invoice: ['InvoiceNo', 'InvoiceDate', 'InvoiceTime', 'CurrencyCode', 'eInvoiceVersion', 'eInvoiceType'],
            items: ['ItemDescription', 'Classification', 'TaxType', 'TaxRate', 'TaxAmount', 'TotalExclTax', 'TotalInclTax']
        };

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const errors = [];

            // Validate supplier fields
            for (const field of mandatoryFields.supplier) {
                if (!record[field] && field !== 'SupplierSST') {
                    errors.push(`Missing ${field} in record ${i + 1}`);
                }
            }

            // Validate buyer fields
            for (const field of mandatoryFields.buyer) {
                if (!record[field] && field !== 'BuyerSST') {
                    // For consolidated invoices, BuyerContact can be "NA"
                    if (field === 'BuyerContact' && record[field] === 'NA') {
                        continue;
                    }

                    // Special handling for consolidated invoices to General Public
                    if (record.BuyerName === 'General Public' &&
                        (field === 'BuyerBRN' || field === 'BuyerAddress' ||
                         field === 'BuyerCity' || field === 'BuyerState' ||
                         field === 'BuyerCountry' || field === 'BuyerContact')) {
                        if (record[field] === 'NA') {
                            continue;
                        }
                    }

                    errors.push(`Missing ${field} in record ${i + 1}`);
                }
            }

            // Validate invoice fields
            for (const field of mandatoryFields.invoice) {
                if (!record[field]) {
                    errors.push(`Missing ${field} in record ${i + 1}`);
                }
            }

            // Validate item fields
            for (const field of mandatoryFields.items) {
                if (!record[field]) {
                    errors.push(`Missing ${field} in record ${i + 1}`);
                }
            }

            // Handle currency exchange rate validation
            if (record.CurrencyCode && record.CurrencyCode !== 'MYR' && !record.ExchangeRate) {
                errors.push(`Exchange rate is required for currency ${record.CurrencyCode} in record ${i + 1}`);
            }

            if (errors.length > 0) {
                validationErrors.push({
                    recordIndex: i + 1,
                    errors: errors
                });
                continue;
            }

            // Set default values for optional fields or missing fields
            record.SupplierSST = record.SupplierSST || 'NA';
            record.BuyerSST = record.BuyerSST || 'NA';
            record.eInvoiceVersion = record.eInvoiceVersion || '1.0';
            record.ExchangeRate = record.ExchangeRate || (record.CurrencyCode === 'MYR' ? '1.0' : null);
            record.InvoiceTime = record.InvoiceTime || '00:00:00Z';
            record.eInvoiceType = record.eInvoiceType || '01';

            // Special handling for consolidated invoices
            if (record.BuyerName === 'General Public') {
                // Ensure all required fields for consolidated invoices are properly set
                record.BuyerTIN = 'EI00000000010';
                record.BuyerBRN = 'NA';
                record.BuyerSST = 'NA';
                record.BuyerAddress = 'NA';
                record.BuyerCity = 'NA';
                record.BuyerState = 'NA';
                record.BuyerCountry = 'NA';
                record.BuyerContact = 'NA';
            }

            // Extract billing period information if available
            const billingPeriodStart = record.BillingPeriodStart || null;
            const billingPeriodEnd = record.BillingPeriodEnd || null;

            // Generate UUID for the record
            const uuid = uuidv4();

            try {
                // Insert record into database using Sequelize model
                const newRecord = await database.WP_FLATFILE.create({
                    supplier_name: record.SupplierName,
                    supplier_tin: record.SupplierTIN,
                    supplier_brn: record.SupplierBRN,
                    supplier_sst: record.SupplierSST,
                    supplier_msic: record.SupplierMSIC,
                    supplier_address: record.SupplierAddress,
                    supplier_city: record.SupplierCity,
                    supplier_state: record.SupplierState,
                    supplier_country: record.SupplierCountry,
                    supplier_contact: record.SupplierContact,
                    buyer_name: record.BuyerName,
                    buyer_tin: record.BuyerTIN,
                    buyer_brn: record.BuyerBRN,
                    buyer_sst: record.BuyerSST,
                    buyer_address: record.BuyerAddress,
                    buyer_city: record.BuyerCity,
                    buyer_state: record.BuyerState,
                    buyer_country: record.BuyerCountry,
                    buyer_contact: record.BuyerContact,
                    invoice_no: record.InvoiceNo,
                    invoice_date: record.InvoiceDate,
                    invoice_time: record.InvoiceTime,
                    currency_code: record.CurrencyCode,
                    exchange_rate: record.ExchangeRate,
                    einvoice_version: record.eInvoiceVersion,
                    einvoice_type: record.eInvoiceType,
                    item_description: record.ItemDescription,
                    classification: record.Classification,
                    tax_type: record.TaxType,
                    tax_rate: record.TaxRate,
                    tax_amount: record.TaxAmount,
                    total_excl_tax: record.TotalExclTax,
                    total_incl_tax: record.TotalInclTax,
                    billing_period_start: billingPeriodStart,
                    billing_period_end: billingPeriodEnd,
                    notes: record.Note,
                    processed_by: userId,
                    status: 'Pending',
                    creation_type: 'Upload',
                    uuid: uuid,
                    upload_date: new Date()
                });

                processedRecords.push({
                    id: newRecord.id,
                    uuid: uuid,
                    invoiceNo: record.InvoiceNo
                });
            } catch (dbError) {
                validationErrors.push({
                    recordIndex: i + 1,
                    errors: [`Database error: ${dbError.message}`]
                });
            }
        }

        if (validationErrors.length > 0) {
            throw new Error(`Validation errors: ${JSON.stringify(validationErrors)}`);
        }

        return processedRecords;
    } catch (error) {
        throw error;
    }
}

module.exports = router;