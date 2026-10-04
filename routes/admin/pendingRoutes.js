const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/pendingController');

router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/:id/approve', ctrl.approve);
router.post('/:id/reject', ctrl.reject);
router.post('/:id/confirm-payment', ctrl.confirmPayment);
router.post('/:id/notes', ctrl.addNotes);

module.exports = router;