const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const { ApiError } = require('../../utils/apiError');
const aiService = require('../../services/aiService');

const chat = asyncHandler(async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    throw ApiError.badRequest('MESSAGE_REQUIRED', 'message is required');
  }

  if (message.length > 1000) {
    throw ApiError.badRequest('MESSAGE_TOO_LONG', 'message must be under 1000 characters');
  }

  const result = await aiService.landingChat({
    message: message.trim(),
    ip: req.ip,
  });

  return ok(res, {
    reply: result.reply,
    fallback: result.fallback === true,
  });
});

const info = asyncHandler(async (_req, res) => {
  const settingsService = require('../../services/settingsService');
  const config = await settingsService.getAiConfig();
  const settings = await settingsService.getMany(['chat_greeting', 'chat_disclaimer']);

  return ok(res, {
    enabled: config.features?.landingAi === true,
    greeting: settings.chat_greeting || 'Hi! Ask me anything about PharmaSys.',
    disclaimer: settings.chat_disclaimer || 'PharmaSys AI gives business insights only.',
    defaultProvider: config.defaultProvider || 'hdm',
  });
});

module.exports = { chat, info };