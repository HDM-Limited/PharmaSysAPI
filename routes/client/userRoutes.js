const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/client/userController');
const { authorize } = require('../../middleware/client/authorize');

router.get('/', authorize('users.view'), ctrl.list);
router.post('/invite', authorize('users.invite.cashier'), ctrl.invite);
router.patch('/:id', authorize('users.update'), ctrl.update);
router.delete('/:id', authorize('users.remove'), ctrl.remove);

module.exports = router;