const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/auditController');

router.get('/', ctrl.list);

module.exports = router;