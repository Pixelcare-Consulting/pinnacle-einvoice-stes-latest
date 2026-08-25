const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');

// Help & Support page route
router.get('/', isAuthenticated, (req, res) => {
    res.render('help/index', {
        title: 'Help & Support - E-Invoice Portal',
        user: req.user
    });
});

router.get('/changelog', (req, res) => {
    res.render('changelog', {
        title: 'Changelog',
        user: req.user
    });
});

module.exports = router; 