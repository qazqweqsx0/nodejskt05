'use strict';

const request = require('supertest');
const config = require('../src/config');
const { app, prisma } = require('./helpers');
const { errorHandler } = require('../src/middleware/errorHandler');

afterAll(async () => {
  await prisma.$disconnect();
});

test('helmet выставляет X-Frame-Options и X-Content-Type-Options', async () => {
  const res = await request(app).get('/health');

  expect(res.status).toBe(200);
  expect(res.headers['x-frame-options']).toBeDefined();
  expect(res.headers['x-content-type-options']).toBe('nosniff');
});

test('тело запроса больше 10kb отклоняется с 413', async () => {
  const res = await request(app).post('/auth/register').send({
    email: 'big@example.com',
    name: 'Big',
    password: 'a'.repeat(11 * 1024),
  });

  expect(res.status).toBe(413);
});

test('error handler скрывает stack trace в production', () => {
  const previousEnv = config.env;
  config.env = 'production';

  const res = {
    statusCode: 0,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  errorHandler(new Error('boom'), {}, res, () => {});

  expect(res.statusCode).toBe(500);
  expect(res.body.error.stack).toBeUndefined();
  expect(consoleSpy).toHaveBeenCalled();

  consoleSpy.mockRestore();
  config.env = previousEnv;
});
