const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/paymentMethodController');

router.get('/', ctrl.list);
router.patch('/:id', ctrl.update);

module.exports = router;