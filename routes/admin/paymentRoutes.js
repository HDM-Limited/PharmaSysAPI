const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/paymentController');

router.get('/', ctrl.list);
router.get('/stats', ctrl.stats);
router.get('/:id', ctrl.get);
router.get('/:id/attempts', ctrl.attempts);
router.post('/:id/mark-paid', ctrl.markPaid);
router.post('/:id/mark-failed', ctrl.markFailed);
router.post('/:id/refund', ctrl.refund);

module.exports = router;