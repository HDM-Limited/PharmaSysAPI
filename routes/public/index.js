const express = require('express');
const router = express.Router();

router.use('/site', require('./siteRoutes'));
router.use('/plans', require('./planRoutes'));
router.use('/invoices', require('./invoiceRoutes'));
router.use('/legal', require('./legalRoutes'));
router.use('/chat', require('./chatRoutes'));

module.exports = router;