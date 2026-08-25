const XLSX = require('xlsx');

// Add the getFieldValue helper function
const getFieldValue = (row, index) => {
  // Try all possible field formats in order
  const value = row[`__EMPTY_${index}`] ??  // Format: __EMPTY_28
         row[`_${index}`] ??         // Format: _28
         row[index] ??               // Format: 28
         row[`EMPTY_${index}`] ??    // Additional fallback format
         row[`${index}`] ??          // Another possible format
         row[`Column${index}`] ??    // Another possible format
         null;                       // Default to null if not found
  
  console.log(`Getting field value for index ${index}:`, {
    value,
    formats: {
      empty: row[`__EMPTY_${index}`],
      underscore: row[`_${index}`],
      direct: row[index],
      emptyUnderscore: row[`EMPTY_${index}`],
      stringIndex: row[`${index}`],
      column: row[`Column${index}`]
    }
  });
  
  return value;
};

// Add the getRowType helper function
const getRowType = (row) => {
  // Check all possible column names for row type
  const rowType = row[''] ||                  // Empty string column
         row['__EMPTY'] ||           // Original format
         row['_'] ||                 // Alternative format
         row['RowType'] ||           // Another possible format
         row['Type'] ||              // Another possible format
         row['Row_Type'] ||          // Another possible format
         row['Row Type'] ||          // Another possible format
         row['RowIdentifier'] ||     // Another possible format
         row['Row Identifier'] ||    // Another possible format
         null;                       // Default to null if not found
  
  // If no row type found in standard columns, try to infer from data
  if (!rowType && row) {
    // Check if this looks like a header row
    if (row['Invoice'] || row['InvoiceNumber'] || row['DocumentNumber']) {
      return 'H';
    }
    // Check if this looks like a line item row
    if (row['InvoiceLine'] || row['LineNumber'] || row['ItemNumber']) {
      return 'L';
    }
    // Check if this looks like a footer row
    if (row['LegalMonetaryTotal'] || row['TotalAmount'] || row['Invoice_TaxTotal']) {
      return 'F';
    }
  }
  
  console.log('Getting row type:', {
    rowType,
    possibleColumns: {
      empty: row[''],
      emptyDouble: row['__EMPTY'],
      underscore: row['_'],
      rowType: row['RowType'],
      type: row['Type'],
      rowIdentifier: row['RowIdentifier'],
      rowTypeUnderscore: row['Row_Type'],
      rowTypeSpace: row['Row Type']
    },
    rowData: row
  });
  
  return rowType;
};

// Add the validatePartyIds function
const validatePartyIds = (rows, partyType, rowValidation) => {
  if (!rows || rows.length === 0) return;

  const idTypes = ['TIN', 'BRN', 'SST', 'TTX'];
  const columnMap = {
    ID_Number: ['PartyIdentification_ID', 'ID Number', 'ID_Number'],
    SchemeID: ['PartyIdentification_schemeID', 'TIN, BRN, SST or TTX']
  };

  const getValue = (row, keys) => {
    for (const key of keys) {
      if (row[key] !== undefined) return row[key];
    }
    return null;
  };

  rows.forEach((row, index) => {
    if (!row) return;

    // Use getFieldValue helper for accessing fields
    const id = String(getValue(row, columnMap.ID_Number) || getFieldValue(row, 16) || '');
    const schemeId = idTypes[index];

    console.log(`Validating ${partyType} row ${index}:`, { id, schemeId, row });

    if (id && id !== 'NA') {
      switch (schemeId) {
        case 'TIN':
          if (!id.match(/^[A-Z0-9]+$/)) {
            rowValidation.errors.push(`Invalid ${partyType} TIN format: ${id}`);
          }
          break;
        case 'BRN':
          if (!id.match(/^\d+$/)) {
            rowValidation.errors.push(`Invalid ${partyType} BRN format: ${id}`);
          }
          break;
        case 'SST':
          if (!id.match(/^W\d{2}-\d{4}-\d{8}$/)) {
            rowValidation.errors.push(`Invalid ${partyType} SST format: ${id}`);
          }
          break;
        case 'TTX':
          if (id !== 'NA' && !id.match(/^[A-Z0-9-\s]+$/)) {
            rowValidation.errors.push(`Invalid ${partyType} TTX format: ${id}`);
          }
          break;
      }
    }
  });
};

const validateExcelRows = (rawData) => {
    // Skip the first two rows (headers) and process data rows
    const dataRows = rawData.slice(2);
    
    // Valid row identifiers (case-insensitive)
    const VALID_ROW_TYPES = new Set(['H', 'L', 'F', 'h', 'l', 'f', 'Header', 'Line', 'Footer']);
    
    // Add validation for scheme IDs
    const VALID_SCHEME_IDS = new Set(['TIN', 'BRN', 'SST', 'TTX']);
    
    const validationResults = {
      totalRows: dataRows.length,
      validRows: 0,
      invalidRows: 0,
      rowDetails: [],
      summary: {
        H: 0,
        L: 0,
        F: 0,
        invalid: 0
      }
    };
  
    dataRows.forEach((row, index) => {
      const rowNum = index + 3; // Adding 3 because we skipped 2 header rows
      let rowType = getRowType(row); // Use the helper function to get row type
      
      // Normalize row type to single character
      if (rowType) {
        rowType = rowType.toString().toUpperCase().charAt(0);
      }
      
      const rowValidation = {
        rowNumber: rowNum,
        rowType: rowType,
        isValid: false,
        errors: []
      };
  
      // Check if row type exists
      if (!rowType) {
        rowValidation.errors.push('Missing row identifier');
      } 
      // Check if row type is valid
      else if (!['H', 'L', 'F'].includes(rowType)) {
        rowValidation.errors.push(`Invalid row identifier: ${rowType}. Expected: H, L, or F`);
      }
      // For header rows, validate scheme IDs
      else if (rowType === 'H') {
        // Get the rows for each party
        const supplierIdRows = dataRows.slice(index, index + 4);
        const buyerIdRows = dataRows.slice(index + 4, index + 8);
        const deliveryIdRows = dataRows.slice(index + 8, index + 12);

        // Debug logging
        console.log('Validating rows:', {
          supplier: supplierIdRows,
          buyer: buyerIdRows,
          delivery: deliveryIdRows,
          rowIndex: index
        });

        // Validate each party's IDs
        validatePartyIds(supplierIdRows, 'Supplier', rowValidation);
        validatePartyIds(buyerIdRows, 'Buyer', rowValidation);
        validatePartyIds(deliveryIdRows, 'Delivery', rowValidation);
      }
      // Row type is valid
      else {
        rowValidation.isValid = true;
        validationResults.summary[rowType]++;
        validationResults.validRows++;
      }
  
      // If invalid, increment counters
      if (!rowValidation.isValid) {
        validationResults.summary.invalid++;
        validationResults.invalidRows++;
      }
  
      // Add to detailed results
      validationResults.rowDetails.push(rowValidation);
    });
  
    // Add logical validation
    validationResults.logicalValidation = {
      hasHeader: validationResults.summary.H > 0,
      hasFooter: validationResults.summary.F > 0,
      hasLines: validationResults.summary.L > 0,
      isValid: validationResults.summary.H > 0 && validationResults.summary.F > 0
    };
  
    return validationResults;
  };
  
  const processAndValidateExcel = async (filePath) => {
    try {
      const workbook = XLSX.readFile(filePath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet, {
        raw: true,
        defval: null,
        blankrows: false
      });
  
      // Validate rows
      const validationResults = validateExcelRows(rawData);
  
      // Log validation results
      console.log('Validation Results:', {
        filePath,
        totalRows: validationResults.totalRows,
        validRows: validationResults.validRows,
        invalidRows: validationResults.invalidRows,
        summary: validationResults.summary,
        logicalValidation: validationResults.logicalValidation
      });
  
      return {
        data: rawData,
        validation: validationResults
      };
    } catch (error) {
      console.error('Error in processAndValidateExcel:', error);
      throw error;
    }
  };
  
  module.exports = { validateExcelRows, processAndValidateExcel };