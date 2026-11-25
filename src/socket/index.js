'use strict';

const { Server } = require('socket.io');

const config = require('../config');
const { SOCKET_EVENTS } = require('./events');
const { createSocketAuthMiddleware } = require('./middleware/auth');
const { presenceStore } = require('./presence');
const { registerPresenceHandlers } = require('./handlers/presence');
const { registerMessageHandlers } = require('./handlers/message');
const { registerRoomHandlers } = require('./handlers/room');

/**
 * Навешивает Socket.io на уже существующий HTTP-сервер Express.
 *
 * @param {import('http').Server} httpServer сервер, созданный из Express-приложения
 * @param {{ prisma: import('@prisma/client').PrismaClient, presence?: object, logger?: Console }} options
 * @returns {import('socket.io').Server}
 */
function createSocketServer(httpServer, { prisma, presence = presenceStore, logger = console } = {}) {
  if (!httpServer) {
    throw new Error('createSocketServer: нужен HTTP-сервер');
  }

  if (!prisma) {
    throw new Error('createSocketServer: параметр prisma обязателен');
  }

  const io = new Server(httpServer, {
    path: config.socket.path,
    cors: {
      origin: config.socket.corsOrigin,
      credentials: true,
    },
  });

  // Аутентификация выполняется один раз при рукопожатии: до `connection`
  // сокет без валидного JWT не допускается.
  io.use(createSocketAuthMiddleware({ prisma }));

  io.on('connection', (socket) => {
    const user = socket.data.user;

    if (config.env !== 'test' && user) {
      logger.log(`[socket] подключён пользователь ${user.id} (${user.name}), сокет ${socket.id}`);
    }

    registerPresenceHandlers(io, socket, presence);
    registerMessageHandlers(io, socket, { prisma });
    registerRoomHandlers(io, socket, { prisma });
  });

  return io;
}

module.exports = { createSocketServer, presenceStore, SOCKET_EVENTS };
