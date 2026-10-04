const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin/healthController');

router.get('/', ctrl.health);
router.get('/ready', ctrl.ready);
router.get('/metrics', ctrl.metrics);

module.exports = router;