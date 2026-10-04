const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/legalController');

router.get('/', ctrl.listPublic);
router.get('/:type', ctrl.getCurrentByType);

module.exports = router;