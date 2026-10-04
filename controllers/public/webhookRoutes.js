const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/public/webhookController');

router.post('/mpesa', ctrl.mpesaCallback);
router.post('/mpesa/timeout', ctrl.mpesaTimeout);
router.post('/stripe', ctrl.stripeWebhook);

module.exports = router;