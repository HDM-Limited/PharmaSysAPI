const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/invoiceController');

router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/:id/mark-paid', ctrl.markPaid);
router.post('/:id/cancel', ctrl.cancel);
router.post('/:id/resend', ctrl.resend);

module.exports = router;