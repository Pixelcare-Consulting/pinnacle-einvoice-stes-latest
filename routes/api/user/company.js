const express = require('express');
const router = express.Router();
const prisma = require('../../../src/lib/prisma');
const auth = require('../../../middleware/auth-prisma.middleware');

/**
 * @route GET /api/user/company/list
 * @desc Get list of all companies
 * @access Private (All authenticated users)
 */
router.get('/list', async (req, res) => {
    try {
        let companies;

        // Check if user is admin
        const isAdmin = req.session && req.session.user &&
                       (req.session.user.admin === 1 || req.session.user.admin === true);

        if (isAdmin) {
            // Admin can see all companies
            companies = await prisma.wP_COMPANY_SETTINGS.findMany({
                select: {
                    ID: true,
                    CompanyName: true,
                    Industry: true,
                    Country: true,
                    TIN: true,
                    BRN: true,
                    Email: true,
                    Phone: true,
                    Address: true,
                    ValidStatus: true
                },
                orderBy: {
                    CompanyName: 'asc'
                }
            });
        } else if (req.session && req.session.user) {
            // Regular users can only see active companies
            companies = await prisma.wP_COMPANY_SETTINGS.findMany({
                where: {
                    ValidStatus: {
                        in: ['1', 1]
                    }
                },
                select: {
                    ID: true,
                    CompanyName: true,
                    Industry: true,
                    Country: true,
                    TIN: true,
                    BRN: true,
                    Email: true,
                    Phone: true,
                    Address: true,
                    ValidStatus: true
                },
                orderBy: {
                    CompanyName: 'asc'
                }
            });
        } else {
            // No valid session
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        // Format the response
        const formattedCompanies = companies.map(company => ({
            ID: company.ID,
            CompanyName: company.CompanyName || 'Unnamed Company',
            Industry: company.Industry || '',
            Country: company.Country || '',
            TIN: company.TIN || '',
            BRN: company.BRN || '',
            Email: company.Email || '',
            Phone: company.Phone || '',
            Address: company.Address || '',
            isActive: company.ValidStatus === '1' || company.ValidStatus === 1
        }));

        res.json(formattedCompanies);
    } catch (error) {
        console.error('Error fetching companies list:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch companies list'
        });
    }
});

module.exports = router;
