const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/billingController');
const { authorize } = require('../../middleware/client/authorize');

router.get('/status', ctrl.status);
router.post('/renew', authorize('billing.manage'), ctrl.renew);
router.get('/invoice', ctrl.invoice);
router.post('/mpesa/stk', authorize('billing.manage'), ctrl.stkPush);

module.exports = router;