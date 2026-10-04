const axios = require('axios');
const { env } = require('./env');

const baseURL = env.hdmAi.url;
const apiKey = env.hdmAi.key;
const model = 'HDM Nova';
const timeoutMs = 20000;
const enabled = Boolean(apiKey && baseURL);

const http = axios.create({
  baseURL,
  timeout: timeoutMs,
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
});

async function complete({ message, systemPrompt, messages, temperature, maxTokens }) {
  if (!enabled) throw new Error('HDM AI not configured');
  const { data } = await http.post('/completion', {
    message,
    system_prompt: systemPrompt,
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  if (!data?.success) throw new Error(data?.error || 'HDM AI request failed');
  return {
    reply: data.data.reply,
    model: data.data.model,
    tokensUsed: data.data.tokens_used,
    provider: data.data.provider,
  };
}

module.exports = { enabled, baseURL, model, timeoutMs, complete };