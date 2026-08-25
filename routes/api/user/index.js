const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth-prisma.middleware');

// Import sub-routes
const companyRoutes = require('./company');

// Register company routes
router.use('/company', companyRoutes);

module.exports = router;
