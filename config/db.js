const mongoose = require('mongoose');
const { env } = require('./env');
const { logger } = require('../utils/logger');

mongoose.set('strictQuery', true);

async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  mongoose.connection.on('connected', () => logger.info('mongodb connected'));
  mongoose.connection.on('disconnected', () => logger.warn('mongodb disconnected'));
  mongoose.connection.on('error', (e) => logger.error({ err: e.message }, 'mongodb error'));

  await mongoose.connect(env.mongoUri, {
    autoIndex: env.nodeEnv !== 'production',
    serverSelectionTimeoutMS: 10000,
  });

  return mongoose.connection;
}

async function disconnectDB() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB, mongoose };