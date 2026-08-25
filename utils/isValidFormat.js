const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const XLSX = require('xlsx');

function isValidFileFormat(fileName) {
    try {
        // Ignore temporary/system files
        if (fileName.startsWith('~$')) {
            console.log(`Skipping temporary file: ${fileName}`);
            return false;
        }

        // Check if it's an Excel file
        if (!fileName.match(/\.(xls|xlsx)$/i)) {
            console.log(`Skipping non-Excel file: ${fileName}`);
            return false;
        }

        // Remove file extension
        const baseName = path.parse(fileName).name;
        
        // Simplified regex to validate basic structure
        // Allows more flexible invoice number format
        const pattern = /^(0[1-4]|1[1-4])_([A-Z0-9_\-]+)_eInvoice_(\d{14})$/;
        const match = baseName.match(pattern);
        
        if (!match) {
            console.log(`File does not match expected format: ${fileName}`);
            console.log('Recommended file name format:');
            console.log('XX_InvoiceNumber_eInvoice_YYYYMMDDHHMMSS');
            console.log('Where:');
            console.log('- XX: Document type (01-04, 11-14)');
            console.log('- InvoiceNumber: Alphanumeric with optional underscores/hyphens');
            console.log('- eInvoice: Fixed text');
            console.log('- YYYYMMDDHHMMSS: Timestamp');
            return false;
        }
        
        // Extract components
        const [, docType, invoiceNumber, timestamp] = match;
        
        // Document type mapping (kept from previous implementation)
        const docTypes = {
            '01': 'Invoice',
            '02': 'Credit Note',
            '03': 'Debit Note',
            '04': 'Refund Note',
            '11': 'Self-billed Invoice',
            '12': 'Self-billed Credit Note',
            '13': 'Self-billed Debit Note',
            '14': 'Self-billed Refund Note'
        };

        // Validate document type
        if (!docTypes[docType]) {
            console.log(`Invalid document type: ${docType}`);
            console.log('Valid document types:');
            Object.entries(docTypes).forEach(([code, type]) => {
                console.log(`- ${code}: ${type}`);
            });
            return false;
        }
        
        // Validate timestamp
        const year = parseInt(timestamp.substring(0, 4));
        const month = parseInt(timestamp.substring(4, 6));
        const day = parseInt(timestamp.substring(6, 8));
        const hour = parseInt(timestamp.substring(8, 10));
        const minute = parseInt(timestamp.substring(10, 12));
        const second = parseInt(timestamp.substring(12, 14));
        
        const date = new Date(year, month - 1, day, hour, minute, second);
        
        if (
            date.getFullYear() !== year ||
            date.getMonth() + 1 !== month ||
            date.getDate() !== day ||
            date.getHours() !== hour ||
            date.getMinutes() !== minute ||
            date.getSeconds() !== second ||
            year < 2000 || year > 2100
        ) {
            console.log(`Invalid timestamp: ${timestamp}`);
            console.log('Timestamp must be a valid date/time in format: YYYYMMDDHHMMSS');
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('Error validating file name:', error);
        return false;
    }
}

module.exports = { isValidFileFormat };