const express = require('express');
const router = express.Router();
const { getAllClassificationCodes } = require('../../utils/ClassificationCodes');
const { getAllTaxTypes } = require('../../utils/TaxTypes');
const { getAllPaymentMethods } = require('../../utils/PaymentMethods');
const { getUnitType } = require('../../utils/UOM');

/**
 * @route GET /api/utils/classification-codes
 * @desc Get all classification codes
 * @access Public
 */
router.get('/classification-codes', async (req, res) => {
    try {
        const codes = await getAllClassificationCodes();
        res.json(codes);
    } catch (error) {
        console.error('Error fetching classification codes:', error);
        res.status(500).json({ message: 'Error fetching classification codes' });
    }
});

/**
 * @route GET /api/utils/tax-types
 * @desc Get all tax types
 * @access Public
 */
router.get('/tax-types', async (req, res) => {
    try {
        const taxTypes = await getAllTaxTypes();
        res.json(taxTypes);
    } catch (error) {
        console.error('Error fetching tax types:', error);
        res.status(500).json({ message: 'Error fetching tax types' });
    }
});

/**
 * @route GET /api/utils/payment-methods
 * @desc Get all payment methods
 * @access Public
 */
router.get('/payment-methods', async (req, res) => {
    try {
        const methods = await getAllPaymentMethods();
        res.json(methods);
    } catch (error) {
        console.error('Error fetching payment methods:', error);
        res.status(500).json({ message: 'Error fetching payment methods' });
    }
});

/**
 * @route GET /api/utils/unit-type/:code
 * @desc Get unit type by code
 * @access Public
 */
router.get('/unit-type/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const unitType = await getUnitType(code);
        res.json({ unitType });
    } catch (error) {
        console.error('Error fetching unit type:', error);
        res.status(500).json({ message: 'Error fetching unit type' });
    }
});

/**
 * GET /api/utils/currency-codes
 * Returns list of currency codes from LHDN API
 */
router.get('/currency-codes', async (req, res) => {
    try {
        const response = await fetch('https://sdk.myinvois.hasil.gov.my/files/CurrencyCodes.json');
        if (!response.ok) {
            throw new Error('Failed to fetch currency codes from LHDN API');
        }
        const currencyCodes = await response.json();
        res.json(currencyCodes);
    } catch (error) {
        console.error('Error fetching currency codes:', error);
        res.status(500).json({ error: 'Failed to fetch currency codes' });
    }
});

module.exports = router; 