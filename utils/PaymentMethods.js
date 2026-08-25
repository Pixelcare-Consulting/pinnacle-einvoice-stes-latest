const axios = require('axios');
// URL to fetch the JSON data
const url = 'https://sdk.myinvois.hasil.gov.my/files/PaymentMethods.json';

// Function to fetch and parse the JSON data
async function fetchPaymentMethods() {
    const response = await axios.get(url);
    return response.data;
}

// Helper function to get the payment method by code
async function getPaymentMethod(code) {
    const paymentMethods = await fetchPaymentMethods();
    const method = paymentMethods.find(item => item.Code === code);
    return method ? method["Payment Method"] : 'Unknown payment method';
}

// Helper function to get all payment methods as an array of {value, label} objects
async function getAllPaymentMethods() {
    const paymentMethods = await fetchPaymentMethods();
    return paymentMethods.map(item => ({
        value: item.Code,
        label: `${item.Code} - ${item["Payment Method"]}`
    }));
}

module.exports = { getPaymentMethod, getAllPaymentMethods, fetchPaymentMethods }; 