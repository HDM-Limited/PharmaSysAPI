const express = require('express');
const router = express.Router();

router.use('/auth', require('./public/authRoutes'));
router.use('/public', require('./public'));
router.use('/live/webhooks', require('./public/webhookRoutes'));
router.use('/admin', require('./admin'));
router.use('/app', require('./client'));

module.exports = router;