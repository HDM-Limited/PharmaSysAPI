const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/billingController');
const { authorize } = require('../../middleware/client/authorize');

router.get('/status', ctrl.status);
router.get('/pending-invoice', ctrl.pendingInvoice);
router.get('/invoice', ctrl.invoice);
router.post('/renew', authorize('billing.manage'), ctrl.renew);
router.post('/mpesa/stk', authorize('billing.manage'), ctrl.stkPush);

module.exports = router;