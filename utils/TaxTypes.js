const axios = require('axios');
// URL to fetch the JSON data
const url = 'https://sdk.myinvois.hasil.gov.my/files/TaxTypes.json';

// Function to fetch and parse the JSON data
async function fetchTaxTypes() {
    const response = await axios.get(url);
    return response.data;
}

// Helper function to get the tax type description by code
async function getTaxTypeDescription(code) {
    const taxTypes = await fetchTaxTypes();
    const taxType = taxTypes.find(type => type.Code === code);
    return taxType ? taxType.Description : 'Unknown tax type';
}

// Helper function to get all tax types as an array of {value, label} objects
async function getAllTaxTypes() {
    const taxTypes = await fetchTaxTypes();
    return taxTypes.map(type => ({
        value: type.Code,
        label: `${type.Code} - ${type.Description}`
    }));
}

module.exports = { getTaxTypeDescription, getAllTaxTypes, fetchTaxTypes }; 