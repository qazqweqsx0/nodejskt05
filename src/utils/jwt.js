'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.role,
      type: 'access',
    },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiresIn },
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      type: 'refresh',
    },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn },
  );
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.jwt.accessSecret);

  if (payload.type !== 'access') {
    throw new jwt.JsonWebTokenError('Неверный тип токена');
  }

  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, config.jwt.refreshSecret);

  if (payload.type !== 'refresh') {
    throw new jwt.JsonWebTokenError('Неверный тип токена');
  }

  return payload;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
