const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/dashboardController');
const { authorize } = require('../../middleware/client/authorize');

router.get('/summary', ctrl.summary);
router.get('/insights', authorize('ai.use'), ctrl.insights);

module.exports = router;