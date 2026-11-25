'use strict';

const http = require('http');

const app = require('./app');
const config = require('./config');
const { createSocketServer, presenceStore } = require('./socket');

const prisma = app.locals.prisma;

// Socket.io навешивается на тот же HTTP-сервер, что и Express.
const httpServer = http.createServer(app);
const io = createSocketServer(httpServer, { prisma });

// Даём REST-роутам доступ к Socket.io (онлайн в комнатах) и реестру presence.
app.locals.io = io;
app.locals.presence = presenceStore;

httpServer.listen(config.port, () => {
  console.log(`[kt05] API и чат запущены: http://localhost:${config.port} (${config.env})`);
  console.log(`[kt05] Socket.io: ws://localhost:${config.port}${config.socket.path}`);
  console.log(`[kt05] Демо-клиент чата: http://localhost:${config.port}/chat.html`);
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  console.log(`[kt05] Получен ${signal}, останавливаем сервер...`);

  await new Promise((resolve) => io.close(resolve));

  if (httpServer.listening) {
    await new Promise((resolve) => httpServer.close(resolve));
  }

  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

module.exports = httpServer;
