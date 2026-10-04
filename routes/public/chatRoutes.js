const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const ctrl = require('../../controllers/public/chatController');

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: {
    success: false,
    error: { code: 'CHAT_RATE_LIMITED', message: 'Slow down a bit' },
  },
});

router.get('/info', ctrl.info);
router.post('/chat', chatLimiter, ctrl.chat);

module.exports = router;