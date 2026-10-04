const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/aiController');
const { authorize } = require('../../middleware/client/authorize');

router.post('/chat', authorize('ai.use'), ctrl.chat);
router.get('/insights', authorize('ai.use'), ctrl.insights);
router.get('/forecast', authorize('ai.use'), ctrl.forecast);
router.get('/expiry-risk', authorize('ai.use'), ctrl.expiryRisk);
router.get('/quota', authorize('ai.use'), ctrl.quota);

module.exports = router;