const axios = require('axios');
// URL to fetch the JSON data
const url = 'https://sdk.myinvois.hasil.gov.my/files/UnitTypes.json';

// Function to fetch and parse the JSON data
async function fetchUnitTypes() {
    const response = await axios.get(url);
    return response.data;
}

// Helper function to capitalize the first letter of a string
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// Helper function to get the unit type by unit code
async function getUnitType(unitCode) {
    const unitTypes = await fetchUnitTypes();
    const unitType = unitTypes.find(type => type.Code === unitCode);
    return unitType ? capitalizeFirstLetter(unitType.Name) : 'Unknown unit code';
}

module.exports = { getUnitType };