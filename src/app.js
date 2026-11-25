'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { PrismaClient } = require('@prisma/client');

const config = require('./config');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const postsRouter = require('./routes/posts');
const chatRouter = require('./routes/chat');
const adminRouter = require('./routes/admin');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const prisma = new PrismaClient();
const app = express();

app.disable('x-powered-by');
app.locals.prisma = prisma;

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // Демо-клиент открывает WebSocket на тот же origin.
        'connect-src': ["'self'", 'ws:', 'wss:'],
        // В development страница отдаётся по http, апгрейд ломал бы ws://localhost.
        'upgrade-insecure-requests': config.env === 'production' ? [] : null,
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: config.security.bodyLimit }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

if (config.env !== 'test') {
  app.use(morgan('dev'));
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'kt05 — REST API блог-платформы с JWT-аутентификацией и realtime-чатом',
    endpoints: {
      auth: '/auth',
      users: '/api/users',
      posts: '/api/posts',
      chat: '/api/chat',
      admin: '/admin',
      health: '/health',
      chatDemo: '/chat.html',
      socket: config.socket.path,
    },
  });
});

app.use('/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/posts', postsRouter);
app.use('/api/chat', chatRouter);
app.use('/admin', adminRouter);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
