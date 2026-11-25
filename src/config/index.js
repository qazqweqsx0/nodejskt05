'use strict';

require('dotenv').config();

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOrigins(value) {
  if (!value || value.trim() === '*') {
    return true;
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL,
  pagination: {
    defaultPage: toInt(process.env.DEFAULT_PAGE, 1),
    defaultLimit: toInt(process.env.DEFAULT_LIMIT, 10),
    maxLimit: toInt(process.env.MAX_LIMIT, 100),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  security: {
    bodyLimit: process.env.BODY_LIMIT || '10kb',
    bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, 10),
  },
  rateLimit: {
    loginWindowMs: 15 * 60 * 1000,
    loginMax: toInt(process.env.LOGIN_RATE_LIMIT_MAX, 10),
  },
  cookie: {
    name: 'refreshToken',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },
  socket: {
    path: process.env.SOCKET_PATH || '/socket.io',
    corsOrigin: parseOrigins(process.env.SOCKET_CORS_ORIGIN),
  },
  chat: {
    messageMaxLength: toInt(process.env.CHAT_MESSAGE_MAX_LENGTH, 1000),
    historyDefaultLimit: toInt(process.env.CHAT_HISTORY_DEFAULT_LIMIT, 20),
    historyMaxLimit: toInt(process.env.CHAT_HISTORY_MAX_LIMIT, 100),
  },
};

if (!config.databaseUrl) {
  throw new Error(
    'DATABASE_URL не задан. Скопируйте .env.example в .env и укажите строку подключения к базе данных.',
  );
}

if (config.env === 'production' && (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET)) {
  throw new Error('В production необходимо задать JWT_ACCESS_SECRET и JWT_REFRESH_SECRET');
}

config.isPostgres = /^postgres(ql)?:\/\//i.test(config.databaseUrl);

module.exports = config;
