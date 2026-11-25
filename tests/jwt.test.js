'use strict';

const jwt = require('jsonwebtoken');
const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
} = require('../src/utils/jwt');

test('access token подписывается и проверяется', () => {
  const token = signAccessToken({ id: 42, email: 'user@example.com', role: 'USER' });
  const payload = verifyAccessToken(token);

  expect(payload.sub).toBe('42');
  expect(payload.email).toBe('user@example.com');
  expect(payload.role).toBe('USER');
  expect(payload.type).toBe('access');
});

test('refresh token отклоняется при проверке как access token', () => {
  const token = signRefreshToken({ id: 42 });

  expect(() => verifyAccessToken(token)).toThrow();
});

test('токен с чужой подписью отклоняется', () => {
  const token = jwt.sign({ sub: '42', type: 'access' }, 'foreign-secret');

  expect(() => verifyAccessToken(token)).toThrow();
});
