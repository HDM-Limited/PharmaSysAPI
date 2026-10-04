const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/public/invoiceController');

router.get('/:number', ctrl.getByNumber);

module.exports = router;