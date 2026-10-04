const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/public/siteController');

router.get('/brand', ctrl.brand);
router.get('/settings', ctrl.settings);
router.get('/plans', ctrl.plans);
router.get('/ai', ctrl.ai);
router.get('/legal', ctrl.legal);
router.get('/legal/:type', ctrl.legalByType);
router.get('/downloads', ctrl.downloads);   // ← new

module.exports = router;