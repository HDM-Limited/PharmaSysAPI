const axios = require('axios');
const { env } = require('./env');
const { logger } = require('../utils/logger');

const baseURL = env.hdm.apiUrl;
const apiKey = env.hdm.apiKey;
const fromEmail = env.hdm.fromEmail;
const fromName = env.hdm.fromName;
const smsSender = env.hdm.smsSender;

const enabled = Boolean(apiKey);
const emailEnabled = Boolean(apiKey && fromEmail);
const smsEnabled = Boolean(apiKey && smsSender);

const http = axios.create({
  baseURL,
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
});

const RETRY_CODES = new Set([502, 503, 504]);

async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const retriable = !status || RETRY_CODES.has(status);
      if (!retriable || i === attempts - 1) throw err;
      const wait = 300 * Math.pow(2, i);
      logger.warn(`hdmBridge retry ${i + 1}/${attempts} after ${wait}ms (status=${status || 'network'})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function sendEmail({ to, subject, htmlBody, textBody, replyTo, from, fromName: name }) {
  if (!emailEnabled) throw new Error('hdmBridge email is not configured');
  return withRetry(async () => {
    const { data } = await http.post('/emails/send', {
      from: from || fromEmail,
      fromName: name || fromName,
      to,
      subject,
      htmlBody,
      textBody,
      replyTo,
    });
    return data;
  });
}

async function sendSms({ to, content, sender, type = 'transactional' }) {
  if (!smsEnabled) throw new Error('hdmBridge SMS is not configured');
  return withRetry(async () => {
    const { data } = await http.post('/sms/send', {
      to,
      content,
      sender: sender || smsSender,
      type,
    });
    return data;
  });
}

async function getEmailStatus(messageId) {
  const { data } = await http.get(`/emails/status/${messageId}`);
  return data;
}

async function getEmailLogs(params = {}) {
  const { data } = await http.get('/logs', { params });
  return data;
}

async function getSmsLogs(params = {}) {
  const { data } = await http.get('/sms/logs', { params });
  return data;
}

async function getSmsStats() {
  const { data } = await http.get('/sms/stats');
  return data;
}

module.exports = {
  enabled,
  emailEnabled,
  smsEnabled,
  baseURL,
  fromEmail,
  fromName,
  smsSender,
  sendEmail,
  sendSms,
  getEmailStatus,
  getEmailLogs,
  getSmsLogs,
  getSmsStats,
};