const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/notificationController');

router.get('/', ctrl.list);
router.get('/unread', ctrl.unread);
router.post('/read-all', ctrl.markAllRead);
router.delete('/clear', ctrl.clear);
router.post('/:id/read', ctrl.markRead);
router.delete('/:id', ctrl.remove);

module.exports = router;