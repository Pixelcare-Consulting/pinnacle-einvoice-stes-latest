const express = require('express');
const router = express.Router();

// API Routes
const apiRoutes = require('./api');
router.use('/api', apiRoutes);

// Web Routes
const webRoutes = require('./web');
router.use('/', webRoutes);

module.exports = router;
