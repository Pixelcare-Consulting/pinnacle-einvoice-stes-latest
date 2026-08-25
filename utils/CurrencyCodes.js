const axios = require('axios');
// URL to fetch the JSON data
const url = 'https://sdk.myinvois.hasil.gov.my/files/CurrencyCodes.json';

// Function to fetch and parse the JSON data
async function fetchCurrencyCodes() {
    const response = await axios.get(url);
    return response.data;
}

async function getCurrencyName(code) {
    const currencyCodes = await fetchCurrencyCodes();
    const currency = currencyCodes.find(item => item.Code === code);
    return currency ? currency.Currency : 'Unknown currency code';
}

// Helper function to get the currency code by code
async function getCurrencyCode(code) {
    const currencyCodes = await fetchCurrencyCodes();
    const currency = currencyCodes.find(item => item.Code === code);
    return currency ? currency.Currency : 'Unknown currency code';
}

// Helper function to get all classification codes as an array of {value, label} objects
async function getAllCurrencyCodes() {
    const currencyCodes = await fetchCurrencyCodes();
    return currencyCodes.map(item => ({
        value: item.Code,
        label: `${item.Code} - ${item.Currency}`
    }));
}

module.exports = { getCurrencyCode, getAllCurrencyCodes, fetchCurrencyCodes, getCurrencyName }; 