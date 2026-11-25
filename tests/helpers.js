'use strict';

const request = require('supertest');
const app = require('../src/app');

const prisma = app.locals.prisma;

let sequence = 0;

function uniqueEmail(prefix = 'user') {
  sequence += 1;
  return `${prefix}.${Date.now()}.${sequence}@example.com`;
}

async function resetDatabase() {
  await prisma.chatMessage.deleteMany();
  await prisma.chatRoom.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.user.deleteMany();
}

async function registerUser(overrides = {}) {
  const payload = {
    email: uniqueEmail(),
    name: 'Test User',
    password: 'Password123!',
    ...overrides,
  };

  const res = await request(app).post('/auth/register').send(payload);
  return { res, payload };
}

async function loginUser(email, password) {
  const res = await request(app).post('/auth/login').send({ email, password });
  return { res, token: res.body.accessToken };
}

async function createUserWithRole(role) {
  const { res, payload } = await registerUser({ name: `User ${role}` });

  if (res.status !== 201) {
    throw new Error(`Не удалось создать пользователя: ${res.status}`);
  }

  const user = await prisma.user.update({
    where: { email: payload.email },
    data: { role },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  const { token } = await loginUser(payload.email, payload.password);

  return { user, token, password: payload.password };
}

async function createPost(token, overrides = {}) {
  return request(app)
    .post('/api/posts')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: `Post ${Date.now()}`,
      content: 'Текст поста',
      published: true,
      tags: ['test'],
      ...overrides,
    });
}

module.exports = {
  app,
  prisma,
  request,
  uniqueEmail,
  resetDatabase,
  registerUser,
  loginUser,
  createUserWithRole,
  createPost,
};
