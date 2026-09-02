const fs = require('fs');
const path = require('path');
const { logRawToJson } = require('./excelLogger');
const {
  classifyAdditionalDocumentReference,
  clipIdByScheme,
  hasMeaningfulValue,
  resolveIndustryName,
  SDK_FIELD_LIMITS,
  toIsoDate,
  truncate
} = require('./sdkFieldLimits');

/**
 * Constants for Excel field mapping and default values
 */
// Define possible Excel column name prefixes for field mapping
const EXCEL_FIELD_PREFIXES = [
  '__EMPTY_',  // Original format with double underscore EMPTY first
  '',         // Direct field name (e.g. "Invoice")
  '_',        // Alternative format with single underscore
  'EMPTY_',   // Another possible format
  '__',       // Double underscore without EMPTY
  'Column',   // Column prefix format
  'Field',    // Field prefix format
  'col',      // col prefix format
  'field'     // field prefix format
];

// Define row type indicators to identify header, line items, and footer rows
const ROW_TYPE_INDICATORS = {
  HEADER: {
    type: 'H',
    identifiers: ['Invoice', 'InvoiceNumber', 'DocumentNumber']
  },
  LINE: {
    type: 'L',
    identifiers: ['InvoiceLine', 'LineNumber', 'ItemNumber']
  },
  FOOTER: {
    type: 'F',
    identifiers: ['LegalMonetaryTotal', 'TotalAmount', 'Invoice_TaxTotal']
  }
};

// Define party identification scheme types for tax and business registration
const PARTY_SCHEME_TYPES = {
  TIN: 'TIN', // Tax Identification Number
  BRN: 'BRN', // Business Registration Number
  SST: 'SST', // Sales and Service Tax
  TTX: 'TTX'  // Tax Registration Number
};

/**
 * Main function to process Excel data and convert it to e-Invoice format
 * @param {Array} rawData - Raw Excel data array where:
 *   - rawData[0] = Descriptions row
 *   - rawData[1] = Field mappings row
 *   - rawData[2+] = Actual data rows
 * @returns {Array} Array of processed invoice documents
 */
const processExcelData = (rawData, options = {}) => {
    // Setup logger for tracking processing
    const logger = {
      info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
      error: (msg, data) => console.error(`[ERROR] ${msg}`, data || '')
    };

    /**
     * Helper function to get field value with support for different Excel column formats
     * Tries multiple format variations to find the correct field value
     * @param {Object} row - Excel row data
     * @param {string} baseField - Base field name to look for
     * @returns {any} Field value if found, undefined otherwise
     */
    const getField = (row, baseField) => {
      // Try different field name formats in order of preference
      const fieldFormats = EXCEL_FIELD_PREFIXES.map(prefix => `${prefix}${baseField}`);

      // First try exact matches
      for (const field of fieldFormats) {
        if (row[field] !== undefined) {
          return row[field];
        }
      }

      // If no exact match found, try case-insensitive matches
      const lowerBaseField = baseField.toLowerCase();
      for (const key of Object.keys(row)) {
        if (key.toLowerCase() === lowerBaseField ||
            EXCEL_FIELD_PREFIXES.some(prefix =>
              key.toLowerCase() === `${prefix.toLowerCase()}${lowerBaseField}`)) {
          return row[key];
        }
      }

      // If no match found, try numeric index fields
      const numericField = baseField.match(/^_(\d+)$/);
      if (numericField) {
        const index = numericField[1];
        const alternateFormats = EXCEL_FIELD_PREFIXES.map(prefix => `${prefix}${index}`);

        for (const format of alternateFormats) {
          if (row[format] !== undefined) {
            return row[format];
          }
        }
      }

      return undefined;
    };

    /**
     * Helper function to determine the type of row (Header, Line, Footer)
     * @param {Object} row - Excel row data
     * @returns {string|null} Row type ('H', 'L', 'F') or null if not determined
     */
    const getRowType = (row) => {
      // Check all possible column names for row type
      const rowType = row[''] || row['__EMPTY'] || row['_'] ||
                     row['RowType'] || row['Type'] || row['Row_Type'] ||
                     row['Row Type'] || row['RowIdentifier'] || row['Row Identifier'] ||
                     null;

      if (!rowType && row) {
        // Check if this looks like a specific row type using the indicators
        for (const [type, config] of Object.entries(ROW_TYPE_INDICATORS)) {
          if (config.identifiers.some(id => row[id])) {
            return config.type;
          }
        }
      }

      return rowType;
    };

    /**
     * Process flow:
     * 1. Initialize log buffers for tracking processing steps
     * 2. Extract descriptions, field mappings, and data rows from raw data
     * 3. Process each row to create invoice documents
     */
    let processLogs = {
      steps: [],
      identifications: [],
      documents: [],
      mappingResults: []
    };

    // Helper function to add to process log
    const addToProcessLog = (data, type) => {
      processLogs[type] = processLogs[type] || [];
      processLogs[type].push({
        timestamp: new Date().toISOString(),
        data
      });
    };

    try {
      // Log processing steps
      const logStep = (step, data) => {
        processLogs.steps.push({
          timestamp: new Date().toISOString(),
          step,
          data
        });
      };

      // Extract structure rows and data rows
      const descriptions = rawData[0];     // First row contains field descriptions
      const fieldMappings = rawData[1];    // Second row contains field mappings
      const dataRows = rawData.slice(2);   // Remaining rows contain actual data

      // Log initial data structure
      logStep('Initial Data', {
        totalRows: dataRows.length,
        firstRow: dataRows[0]
      });

      /**
       * Document Processing:
       * 1. Track current document being processed
       * 2. Maintain array of processed documents
       */
      let currentDocument = null;
      const documents = [];

      /**
       * Helper function to process party identifications
       * Extracts and validates identification information for parties
       * @param {Array} rows - Array of rows containing identification data
       * @returns {Array} Processed identifications
       */
      const getIdentifications = (rows) => {
        const identifications = [];

        logStep('Processing Identifications', {
          inputRows: rows
        });

        if (rows && rows.length > 0) {
          rows.forEach((row) => {
            if (row?.PartyIdentification_ID && row?.schemeId) {
              identifications.push({
                id: clipIdByScheme(String(row.PartyIdentification_ID), row.schemeId),
                schemeId: row.schemeId
              });
            }
          });
        }

        processLogs.identifications.push({
          input: rows,
          output: identifications,
          timestamp: new Date().toISOString()
        });

        return identifications;
      };

      /**
       * Creates a new invoice document from header row data
       * @param {Object} headerRow - Excel row containing header information
       * @param {Array} dataRows - All data rows
       * @param {number} currentIndex - Current processing index
       * @returns {Object} Processed invoice document
       */
      const createNewDocument = (headerRow, dataRows, currentIndex) => {
        // logRawExcelData(headerRow, dataRows, currentIndex);

        logStep('Creating New Document', {
          headerRow,
          currentIndex
        });

        // Find the footer row for tax scheme data
        const footerRow = dataRows.slice(currentIndex).find(row => row.__EMPTY === 'F');

        // Update scheme ID rows with consistent naming
        const partyIdentifications = {
          supplier: [
            {
              PartyIdentification_ID: getField(headerRow, '16'),
              schemeId: getField(headerRow, '17') || PARTY_SCHEME_TYPES.TIN
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 1] ? getField(dataRows[currentIndex + 1], '16') : undefined,
              schemeId: (dataRows[currentIndex + 1] ? getField(dataRows[currentIndex + 1], '17') : undefined) || PARTY_SCHEME_TYPES.BRN
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 2] ? getField(dataRows[currentIndex + 2], '16') : undefined,
              schemeId: PARTY_SCHEME_TYPES.SST
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 3] ? getField(dataRows[currentIndex + 3], '16') : undefined,
              schemeId: PARTY_SCHEME_TYPES.TTX
            }
          ],
          buyer: [
            {
              PartyIdentification_ID: headerRow.Buyer,
              schemeId: getField(headerRow, '28')
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 1]?.Buyer,
              schemeId: (dataRows[currentIndex + 1] ? getField(dataRows[currentIndex + 1], '28') : undefined) || PARTY_SCHEME_TYPES.BRN
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 2]?.Buyer,
              schemeId: PARTY_SCHEME_TYPES.SST
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 3]?.Buyer,
              schemeId: PARTY_SCHEME_TYPES.TTX
            }
          ],
          delivery: [
            {
              PartyIdentification_ID: headerRow.Delivery,
              schemeId: getField(headerRow, '39')
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 1]?.Delivery,
              schemeId: (dataRows[currentIndex + 1] ? getField(dataRows[currentIndex + 1], '39') : undefined) || PARTY_SCHEME_TYPES.BRN
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 2]?.Delivery,
              schemeId: PARTY_SCHEME_TYPES.SST
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 3]?.Delivery,
              schemeId: PARTY_SCHEME_TYPES.TTX
            }
          ]
        };

        // Add detailed logging for document creation
        const documentLog = {
          timestamp: new Date().toISOString(),
          documentId: headerRow.Invoice,
          partyIdentifications
        };
        processLogs.documents.push(documentLog);

        const currentDate = new Date();
        const formattedDate = currentDate.toISOString().split('T')[0];
        const formattedTime = currentDate.toISOString().split('T')[1].split('.')[0] + 'Z';

        const rawAdditionalDocumentReference = headerRow.AdditionalDocumentReference;
        const additionalDocumentType = getField(headerRow, '11');
        const classifiedAdr = classifyAdditionalDocumentReference(
          rawAdditionalDocumentReference,
          additionalDocumentType
        );
        const industryClassificationCode = getField(headerRow, '14');
        const industryName = resolveIndustryName({
          excelName: String(getField(headerRow, '15') || '').trim(),
          msicCode: industryClassificationCode,
          companyIndustry: options.companyIndustry
        });
        const malaysiaStateOrEmpty = (stateValue, countryValue) => {
          const country = String(countryValue || '').trim().toUpperCase();
          if (hasMeaningfulValue(stateValue)) {
            return String(stateValue).trim();
          }
          if (country === 'MYS' || country === 'MY' || country === 'MALAYSIA') {
            return '';
          }
          return stateValue || '';
        };

        const doc = {
          header: {
            invoiceNo: truncate(headerRow.Invoice, SDK_FIELD_LIMITS.invoiceNumber),
            invoiceType: getField(headerRow, '5'),
            documentCurrencyCode: getField(headerRow, '6'),
            currency: getField(headerRow, '6'),
            taxCurrencyCode: getField(headerRow, '7') || getField(headerRow, '6'),
            exchangeRate: getField(headerRow, '8') || 0,
            invoiceDocumentReference: getField(headerRow, '1') || '',
            InvoiceDocumentReference_ID: getField(headerRow, '2') || '',
            documentReference: {
              uuid: getField(headerRow, '1') || '',
              internalId: getField(headerRow, '2') || '',
              billingReference: classifiedAdr.billReference || '',
              billingReferenceType: additionalDocumentType || '',
              rawAdditionalDocumentReference,
              additionalRefs: classifiedAdr.invoiceReferences,
              invalidIncoterms: classifiedAdr.invalidIncoterms
            },
            issueDate: [{ _: formattedDate }],
            issueTime: [{ _: formattedTime }],
            invoicePeriod: {
              startDate: toIsoDate(headerRow.InvoicePeriod) || '',
              endDate: toIsoDate(getField(headerRow, '9')) || '',
              description: truncate(getField(headerRow, '10') || '', SDK_FIELD_LIMITS.billingFrequency)
            }
          },
          supplier: {
            id: getField(headerRow, '16'),
            additionalAccountID: headerRow.Supplier || DEFAULT_VALUES.NOT_APPLICABLE,
            schemeAgencyName: truncate(getField(headerRow, '13') || 'CertEx', SDK_FIELD_LIMITS.certExAuthNumber),
            industryClassificationCode,
            industryName,
            companyIndustry: options.companyIndustry || '',
            identifications: getIdentifications(partyIdentifications.supplier),
            name: getField(headerRow, '25'),
            address: {
              // Process address line with proper formatting - collect from multiple rows
              line: processAddressLine(null, headerRow, dataRows, currentIndex, '21'),
              city: getField(headerRow, '18') || "NA",
              postcode: getField(headerRow, '19') || "NA",
              state: malaysiaStateOrEmpty(getField(headerRow, '20'), getField(headerRow, '22')),
              country: getField(headerRow, '22') || "NA",
              countryListID: getField(headerRow, '23') || "NA",
              countryListAgencyID: getField(headerRow, '24')|| "NA"
            },
            contact: {
              phone: getField(headerRow, '26'),
              email: getField(headerRow, '27')
            }
          },
          buyer: {
            id: headerRow.Buyer,
            identifications: getIdentifications(partyIdentifications.buyer),
            name: getField(headerRow, '36'),
            address: {
              // Process address line with proper formatting - collect from multiple rows
              line: processAddressLine(null, headerRow, dataRows, currentIndex, '32'),
              city: getField(headerRow, '29') || "NA",
              postcode: getField(headerRow, '30') || "NA",
              state: malaysiaStateOrEmpty(getField(headerRow, '31'), getField(headerRow, '33')),
              country: getField(headerRow, '33') || "NA",
              countryListID: getField(headerRow, '34') || DEFAULT_VALUES.COUNTRY_SCHEME.listId,
              countryListAgencyID: getField(headerRow, '35') || DEFAULT_VALUES.COUNTRY_SCHEME.agencyId
            },
            contact: {
              phone: getField(headerRow, '37'),
              email: getField(headerRow, '38')
            }
          },
          delivery: {
            id: headerRow.Delivery,
            identifications: getIdentifications(partyIdentifications.delivery),
            name: getField(headerRow, '47'),
            address: {
              // Process address line with proper formatting - collect from multiple rows
              line: processAddressLine(null, headerRow, dataRows, currentIndex, '43'),
              city: getField(headerRow, '40'),
              postcode: getField(headerRow, '41'),
              state: malaysiaStateOrEmpty(getField(headerRow, '42'), getField(headerRow, '44')),
              country: getField(headerRow, '44'),
              countryListID: getField(headerRow, '45') || DEFAULT_VALUES.COUNTRY_SCHEME.listId,
              countryListAgencyID: String(getField(headerRow, '46') || DEFAULT_VALUES.COUNTRY_SCHEME.agencyId)
            },
            shipment: {
              id: getField(headerRow, '48') || '',
              freightAllowanceCharge: {
                indicator: getField(headerRow, '49') === true ||
                          getField(headerRow, '49') === 'true' ||
                          getField(headerRow, '49') === 1,
                reason: getField(headerRow, '50') || '',
                amount: getField(headerRow, '51')
              }
            }
          },
          payment: {
            paymentMeansCode: getField(headerRow, 'PaymentMeans') || '',
            payeeFinancialAccount: truncate(getField(headerRow, '52') || '', SDK_FIELD_LIMITS.bankAccount),
            paymentTerms: truncate(getField(headerRow, 'PaymentTerms') || '', SDK_FIELD_LIMITS.paymentTerms),
            prepaidPayment: {
              id: truncate(getField(headerRow, 'PrepaidPayment') || '', SDK_FIELD_LIMITS.prepaidReference),
              amount: getField(headerRow, '53') || DEFAULT_VALUES.ZERO,
              date: toIsoDate(getField(headerRow, '54')) || null,
              time: getField(headerRow, '55') || null
            }
          },
          items: [],
          summary: {
            amounts: {
              lineExtensionAmount: DEFAULT_VALUES.ZERO,
              taxExclusiveAmount: DEFAULT_VALUES.ZERO,
              taxInclusiveAmount: DEFAULT_VALUES.ZERO,
              allowanceTotalAmount: DEFAULT_VALUES.ZERO,
              chargeTotalAmount: DEFAULT_VALUES.ZERO,
              payableRoundingAmount: DEFAULT_VALUES.ZERO,
              payableAmount: DEFAULT_VALUES.ZERO
            },
            tax: {
              totalAmount: DEFAULT_VALUES.ZERO,
              taxableAmount: DEFAULT_VALUES.ZERO,
              taxExemptedAmount: DEFAULT_VALUES.ZERO,
              taxRate: DEFAULT_VALUES.ZERO,
              taxAmount: DEFAULT_VALUES.ZERO,
              taxTypeCode: DEFAULT_VALUES.NOT_APPLICABLE,
              taxExemptionReason: DEFAULT_VALUES.NOT_APPLICABLE,
              taxSubtotal: {
                taxableAmount: DEFAULT_VALUES.ZERO,
                taxAmount: DEFAULT_VALUES.ZERO
              },
              category: {
                id: DEFAULT_VALUES.NOT_APPLICABLE,
                exemptionReason: DEFAULT_VALUES.NOT_APPLICABLE,
                scheme: DEFAULT_VALUES.TAX_SCHEME
              }
            }
          },
          allowanceCharge: {
            indicator: getField(headerRow, 'InvoiceAllowanceCharge') === true ||
                      getField(headerRow, 'InvoiceAllowanceCharge') === 'true' ||
                      getField(headerRow, 'InvoiceAllowanceCharge') === 1,
            reason: getField(headerRow, '56') || DEFAULT_VALUES.NOT_APPLICABLE,
            amount: getField(headerRow, '57') || DEFAULT_VALUES.ZERO
          }

        };

        logRawToJson(doc, `${doc.header.invoiceNo}_eInvoice`);

        return doc;
      };

      const processLineItem = (lineRow, headerData) => {
        return {
          lineId: getField(lineRow, 'InvoiceLine'),
          quantity: getField(lineRow, '70'),
          unitCode: getField(lineRow, '71'),
          unitPrice: getField(lineRow, '88'),
          lineExtensionAmount: getField(lineRow, '72'),
          allowanceCharges: [{
            chargeIndicator: getField(lineRow, '73') === true ||
                            getField(lineRow, '73') === 'true' ||
                            getField(lineRow, '73') === 1,
            reason: getField(lineRow, '74') || null,
            multiplierFactorNumeric: getField(lineRow, '75') || 0,
            amount: getField(lineRow, '76') || 0
          }],
          taxTotal: {
            taxAmount: getField(lineRow, 'InvoiceLine_TaxTotal') || DEFAULT_VALUES.ZERO,
            taxSubtotal: [{
              taxableAmount: getField(lineRow, '77') || DEFAULT_VALUES.ZERO,
              taxAmount: getField(lineRow, '78') || DEFAULT_VALUES.ZERO,
              taxCategory: {
                id: getField(lineRow, '80') || DEFAULT_VALUES.TAX_CATEGORY.id,
                percent: getField(lineRow, '79') || DEFAULT_VALUES.ZERO,
                exemptionReason: getField(lineRow, '81') || DEFAULT_VALUES.TAX_CATEGORY.exemptionReason,
                taxScheme: {
                  id: getField(lineRow, '82') || 'OTH',
                  schemeId: getField(lineRow, '83') || 'UN/ECE 5153',
                  schemeAgencyId: String(getField(lineRow, '84') || '6')
                }
              }
            }]
          },
          item: {
            classification: {
              code: getField(lineRow, 'InvoiceItem'),
              type: getField(lineRow, '85')
            },
            description: getField(lineRow, '86'),
            originCountry: getField(lineRow, '87')
          },
          price: {
            amount: getField(lineRow, '88'),
            subtotal: getField(lineRow, '89'),
            extension: getField(lineRow, '89')
          }
        };
      };

      // Helper function to collect all address lines from multiple rows with the same field
      const collectAddressLines = (baseField, headerRow, dataRows, currentIndex) => {
        const addressLines = [];

        // Get address from header row
        const headerAddress = getField(headerRow, baseField);
        if (headerAddress && headerAddress !== 'NA') {
          // Convert to string and check if it's not empty after trimming
          const headerAddressStr = String(headerAddress);
          if (headerAddressStr.trim() !== '') {
            addressLines.push(headerAddressStr);
          }
        }

        // Get addresses from subsequent rows (typically 3 more rows for additional address lines)
        for (let i = 1; i <= 3; i++) {
          if (dataRows[currentIndex + i]) {
            const additionalAddress = getField(dataRows[currentIndex + i], baseField);
            if (additionalAddress && additionalAddress !== 'NA') {
              // Convert to string and check if it's not empty after trimming
              const additionalAddressStr = String(additionalAddress);
              if (additionalAddressStr.trim() !== '') {
                addressLines.push(additionalAddressStr);
              }
            }
          }
        }

        return addressLines;
      };

      // Helper function to process address lines
      const processAddressLine = (addressLine, headerRow, dataRows, currentIndex, baseField) => {
        // If we have headerRow and dataRows, collect all address lines
        if (headerRow && dataRows && currentIndex !== undefined && baseField) {
          const addressLines = collectAddressLines(baseField, headerRow, dataRows, currentIndex);

          if (addressLines.length === 0) return "NA";

          // Join all address lines with commas
          return addressLines.join(', ');
        }

        // If we only have a single address line (legacy behavior)
        if (!addressLine) return "NA";

        // Convert to string and handle special cases
        const addressStr = String(addressLine);
        if (addressStr.toLowerCase() === 'na' || addressStr.trim() === '') {
          return "NA";
        }

        // If address already has commas, return as is
        if (addressStr.includes(',')) {
          return addressStr;
        }

        // Try to intelligently split address based on common patterns
        // This handles all address types, not just PLO addresses
        const commonAddressPatterns = /\s+(?=\d+[A-Za-z]|\d+,|Jalan|Taman|Persiaran|Lorong|Kampung|Kg\.|Bandar|Street|Road|Lane|Avenue|Block|Unit|Floor|Level|Plaza|Tower|Building|Complex|Park|Garden|Heights|Court|Apartment|Suite|Room|House|No\.|No\s+\d+)/i;

        if (addressStr.match(commonAddressPatterns)) {
          const addressParts = addressStr.split(commonAddressPatterns);
          if (addressParts.length > 1) {
            return addressParts.join(', ');
          }
        }

        // If no patterns found, return as is
        return addressStr;
      };

      const DEFAULT_VALUES = {
        CURRENCY: 'MYR',
        COUNTRY: 'MYS',
        COUNTRY_SCHEME: {
          listId: 'ISO3166-1',
          agencyId: '6'
        },
        TAX_SCHEME: {
          id: 'OTH'  // Changed from 'OTH' to 'VAT' as per LHDN
        },
        NOT_APPLICABLE: 'NA',
        ZERO: 0,
        TAX_CATEGORY: {
          id: '01',
          exemptionReason: 'NA',
          scheme: {
            id: 'OTH'  // Changed from 'OTH' to 'VAT'
          }
        }
      };

      // Add helper function to support multiple tax types if needed
      const createTaxSubtotal = (taxTypeCode, taxAmount, taxableAmount, percent, exemptionReason) => {
        return {
          taxableAmount: taxableAmount || DEFAULT_VALUES.ZERO,
          taxAmount: taxAmount || DEFAULT_VALUES.ZERO,
          taxCategory: {
            id: taxTypeCode || DEFAULT_VALUES.TAX_CATEGORY.id,
            percent: percent || DEFAULT_VALUES.ZERO,
            exemptionReason: exemptionReason || DEFAULT_VALUES.TAX_CATEGORY.exemptionReason,
            taxScheme: {
              id: DEFAULT_VALUES.TAX_SCHEME.id
            }
          }
        };
      };

      // Add function to process multiple tax types if needed
      const processMultipleTaxTypes = (taxRows) => {
        let totalTaxAmount = 0;
        const taxSubtotals = taxRows.map(row => {
          const taxAmount = getField(row, '78') || DEFAULT_VALUES.ZERO;
          totalTaxAmount += taxAmount;

          return createTaxSubtotal(
            getField(row, '80'),
            taxAmount,
            getField(row, '77'),
            getField(row, '79'),
            getField(row, '81')
          );
        });

        return {
          taxAmount: totalTaxAmount,
          taxSubtotal: taxSubtotals
        };
      };

      const processFooter = (footerRow) => {
        return {
          amounts: {
            lineExtensionAmount: getField(footerRow, 'LegalMonetaryTotal') || DEFAULT_VALUES.ZERO,
            taxExclusiveAmount: getField(footerRow, '64') || DEFAULT_VALUES.ZERO,
            taxInclusiveAmount: getField(footerRow, '65') || DEFAULT_VALUES.ZERO,
            allowanceTotalAmount: getField(footerRow, '66') || DEFAULT_VALUES.ZERO,
            chargeTotalAmount: getField(footerRow, '67') || DEFAULT_VALUES.ZERO,
            payableRoundingAmount: getField(footerRow, '68') || DEFAULT_VALUES.ZERO,
            payableAmount: getField(footerRow, '69') || DEFAULT_VALUES.ZERO
          },
          taxTotal: {                // Changed from 'tax' to 'taxTotal'
            taxAmount: getField(footerRow, 'Invoice_TaxTotal') || DEFAULT_VALUES.ZERO,
            taxSubtotal: [{        // Changed to array structure
              taxableAmount: getField(footerRow, '58') || DEFAULT_VALUES.ZERO,
              taxAmount: getField(footerRow, 'Invoice_TaxTotal') || DEFAULT_VALUES.ZERO,
              taxCategory: {
                id: getField(footerRow, '60') || DEFAULT_VALUES.TAX_CATEGORY.id,      // Was taxTypeCode
                percent: getField(footerRow, '79') || DEFAULT_VALUES.ZERO,            // Was taxRate
                exemptionReason: getField(footerRow, '81') || DEFAULT_VALUES.TAX_CATEGORY.exemptionReason,
                taxScheme: {
                  id: getField(footerRow, '61') || DEFAULT_VALUES.TAX_CATEGORY.scheme.id
                }
              }
            }]
          }
        };
      };

      /**
       * Process each row in the Excel data:
       * 1. Determine row type (Header, Line, Footer)
       * 2. Process according to type:
       *    - Header: Create new document
       *    - Line: Add line item to current document
       *    - Footer: Finalize current document
       */
      dataRows.forEach((row, index) => {
        const rowType = getRowType(row);
        const normalizedType = rowType ? rowType.toString().toUpperCase().charAt(0) : null;

        switch(normalizedType) {
          case 'H': // Header row - start new document
            if (row.Invoice) {
              if (currentDocument) {
                documents.push(currentDocument);
              }
              currentDocument = createNewDocument(row, dataRows, index);
            }
            break;

          case 'L': // Line item row - add to current document
            if (currentDocument) {
              const lineItem = processLineItem(row, currentDocument.header);

              // Initialize items array if it doesn't exist
              if (!currentDocument.items) {
                currentDocument.items = [];
              }

              if (lineItem.lineId && lineItem.quantity !== undefined &&
                (lineItem.lineExtensionAmount !== undefined || lineItem.lineExtensionAmount === 0)) {

                const existingLineIndex = currentDocument.items.findIndex(item => item.lineId === lineItem.lineId);

                if (existingLineIndex >= 0) {
                  // Add allowance/charge to existing line
                  currentDocument.items[existingLineIndex].allowanceCharges.push({
                    chargeIndicator: lineItem.allowanceCharges[0].chargeIndicator,
                    reason: lineItem.allowanceCharges[0].reason || 'NA',
                    multiplierFactorNumeric: lineItem.allowanceCharges[0].multiplierFactorNumeric || 0,
                    amount: lineItem.allowanceCharges[0].amount || 0
                  });
                } else {
                  // Ensure allowanceCharges has at least one item
                  if (!lineItem.allowanceCharges || lineItem.allowanceCharges.length === 0) {
                    lineItem.allowanceCharges = [{
                      chargeIndicator: false,
                      reason: 'NA',
                      multiplierFactorNumeric: 0,
                      amount: 0
                    }];
                  }
                  // Add new line item
                  currentDocument.items.push(lineItem);
                }
              }
            }
            break;

          case 'F': // Footer row - finalize document
            if (currentDocument) {
              // Process footer data with current document for tax calculations
              const footerData = processFooter(row);

              // Update document summary with footer data
              currentDocument.summary = footerData;

              // Log raw document
              if (currentDocument?.header?.invoiceNo) {
                logRawToJson(currentDocument, `${currentDocument.header.invoiceNo}_eInvoice`);
              }

              // Add to documents array
              documents.push(currentDocument);
              currentDocument = null;
            }
            break;
        }
      });

      // Add the last document if exists
      if (currentDocument) {
        documents.push(currentDocument);
      }

      logger.info('Processed documents:', documents.length);

      // Always write logs for debugging
      try {
        const logsDir = path.join(process.cwd(), 'logs', 'excel');
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }

        // Log raw data structure
        const rawDataLog = {
          timestamp: new Date().toISOString(),
          descriptions,
          fieldMappings,
          sampleDataRow: dataRows[0],
          rowTypes: {
            header: dataRows.find(row => getRowType(row)?.toString().toUpperCase().charAt(0) === 'H'),
            line: dataRows.find(row => getRowType(row)?.toString().toUpperCase().charAt(0) === 'L'),
            footer: dataRows.find(row => getRowType(row)?.toString().toUpperCase().charAt(0) === 'F')
          }
        };

        // Log all raw Excel data for address debugging
        const rawExcelData = {
          timestamp: new Date().toISOString(),
          allRows: dataRows.map((row, index) => {
            // Extract only address-related fields for clarity
            const addressFields = {};
            for (const key of Object.keys(row)) {
              if (key.includes('21') || key.includes('32') || key.includes('43')) {
                addressFields[key] = row[key];
              }
            }
            return {
              rowIndex: index,
              rowType: getRowType(row),
              supplier: row.Supplier,
              buyer: row.Buyer,
              delivery: row.Delivery,
              addressFields
            };
          })
        };

        // Write raw Excel data log specifically for address debugging
        const rawExcelLogPath = path.join(logsDir, `excel_raw_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(rawExcelLogPath, JSON.stringify(rawExcelData, null, 2));

        // Write raw data log
        const rawDataLogPath = path.join(logsDir, `raw_data_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(rawDataLogPath, JSON.stringify(rawDataLog, null, 2));

        // Write process logs
        const processLogPath = path.join(logsDir, `process_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(processLogPath, JSON.stringify(processLogs, null, 2));

        logger.info('Logs written to:', logsDir);
      } catch (logError) {
        logger.error('Error writing logs:', logError);
        // Don't throw the error as logging failure shouldn't stop processing
      }

      return documents;

    } catch (error) {
      logger.error('Error processing Excel data:', error);
      addToProcessLog({
        error: error.message,
        stack: error.stack
      }, 'errors');
      throw error;
    }
  };

  module.exports = { processExcelData };