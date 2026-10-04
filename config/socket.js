const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { env } = require('./env');
const { logger } = require('../utils/logger');

let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    path: '/api/live/ws',
    cors: { origin: env.corsOrigins, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('NO_TOKEN'));
      const payload = jwt.verify(token, env.jwt.accessSecret);
      socket.data.userId = payload.sub;
      socket.data.tenantId = payload.tenantId;
      socket.data.role = payload.role;
      socket.data.branchIds = payload.branchIds || [];
      socket.data.scope = payload.scope;
      return next();
    } catch (e) {
      return next(new Error('INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket) => {
    const { tenantId, userId, branchIds, role } = socket.data;
    if (tenantId) socket.join(`tenant:${tenantId}`);
    if (userId) socket.join(`user:${userId}`);
    if (role !== 'owner' && branchIds?.length) socket.join(`branch:${branchIds[0]}`);
    logger.info({ userId, tenantId, role }, 'socket connected');
  });

  logger.info('socket.io initialized');
  return io;
}

function getIO() { return io; }
function emitToTenant(tenantId, event, payload) { if (io) io.to(`tenant:${tenantId}`).emit(event, payload); }
function emitToBranch(tenantId, branchId, event, payload) { if (io) io.to(`branch:${branchId}`).emit(event, payload); }
function emitToUser(userId, event, payload) { if (io) io.to(`user:${userId}`).emit(event, payload); }
function emitToAdmins(event, payload) { if (io) io.emit(`admin:${event}`, payload); }
async function closeSocket() { if (io) { await io.close(); io = null; } }

module.exports = {
  initSocket, getIO,
  emitToTenant, emitToBranch, emitToUser, emitToAdmins,
  closeSocket,
};