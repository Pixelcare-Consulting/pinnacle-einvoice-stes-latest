const axios = require('axios');
// URL to fetch the JSON data
const url = 'https://sdk.myinvois.hasil.gov.my/files/ClassificationCodes.json';

// Function to fetch and parse the JSON data
async function fetchClassificationCodes() {
    const response = await axios.get(url);
    return response.data;
}

// Helper function to get the classification description by code
async function getClassificationDescription(code) {
    const classificationCodes = await fetchClassificationCodes();
    const classification = classificationCodes.find(item => item.Code === code);
    return classification ? classification.Description : 'Unknown classification code';
}

// Helper function to get all classification codes as an array of {value, label} objects
async function getAllClassificationCodes() {
    const classificationCodes = await fetchClassificationCodes();
    return classificationCodes.map(item => ({
        value: item.Code,
        label: `${item.Code} - ${item.Description}`
    }));
}

module.exports = { getClassificationDescription, getAllClassificationCodes, fetchClassificationCodes }; 