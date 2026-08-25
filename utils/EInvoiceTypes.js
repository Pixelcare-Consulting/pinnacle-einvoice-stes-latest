const axios = require('axios');
// URL to fetch the JSON data
const url = 'https://sdk.myinvois.hasil.gov.my/files/EInvoiceTypes.json';

// Function to fetch and parse the JSON data
async function fetchInvoiceTypes() {
    const response = await axios.get(url);
    return response.data;
}


// Helper function to get the unit type by unit code
async function getInvoiceTypes(invoiceTypeCode) {
    const invoiceTypes = await fetchInvoiceTypes();
    console.log("List of Invoice Type Codes: ", invoiceTypes);
    const invoiceType = invoiceTypes.find(type => type.Code === invoiceTypeCode);
    const eInvoiceType = invoiceType ? invoiceType.Code + ' - ' + invoiceType.Description  : 'Unknown Invoice Type Code';
    console.log("Selected Invoice Type Code: ", invoiceType);
    return eInvoiceType;
}

module.exports = { getInvoiceTypes };