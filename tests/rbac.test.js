'use strict';

const request = require('supertest');
const {
  app,
  prisma,
  resetDatabase,
  createUserWithRole,
  createPost,
} = require('./helpers');

let owner;
let other;
let moderator;
let admin;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUserWithRole('USER');
  other = await createUserWithRole('USER');
  moderator = await createUserWithRole('MODERATOR');
  admin = await createUserWithRole('ADMIN');
});

afterAll(async () => {
  await prisma.$disconnect();
});

test('USER не имеет доступа к списку пользователей', async () => {
  const res = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${owner.token}`);

  expect(res.status).toBe(403);
});

test('MODERATOR и ADMIN получают список пользователей', async () => {
  for (const account of [moderator, admin]) {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${account.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(4);
  }
});

test('GET /api/posts требует аутентификации', async () => {
  const res = await request(app).get('/api/posts');

  expect(res.status).toBe(401);
});

test('все роли могут создавать посты, автор берётся из токена', async () => {
  for (const account of [owner, moderator, admin]) {
    const res = await createPost(account.token, {
      title: `Post by ${account.user.role}`,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.authorId).toBe(account.user.id);
  }
});

test('владелец может удалить свой пост', async () => {
  const post = await createPost(owner.token);

  const res = await request(app)
    .delete(`/api/posts/${post.body.data.id}`)
    .set('Authorization', `Bearer ${owner.token}`);

  expect(res.status).toBe(204);
});

test('другой USER получает 403 при удалении чужого поста', async () => {
  const post = await createPost(owner.token);
  const postId = post.body.data.id;

  const res = await request(app)
    .delete(`/api/posts/${postId}`)
    .set('Authorization', `Bearer ${other.token}`);

  expect(res.status).toBe(403);

  const stillExists = await request(app)
    .get(`/api/posts/${postId}`)
    .set('Authorization', `Bearer ${owner.token}`);
  expect(stillExists.status).toBe(200);
});

test('USER получает 403 при изменении чужого поста', async () => {
  const post = await createPost(owner.token);

  const res = await request(app)
    .patch(`/api/posts/${post.body.data.id}`)
    .set('Authorization', `Bearer ${other.token}`)
    .send({ title: 'Hacked' });

  expect(res.status).toBe(403);
});

test('MODERATOR может удалить чужой пост', async () => {
  const post = await createPost(owner.token);

  const res = await request(app)
    .delete(`/api/posts/${post.body.data.id}`)
    .set('Authorization', `Bearer ${moderator.token}`);

  expect(res.status).toBe(204);
});

test('только ADMIN может изменить роль пользователя', async () => {
  const target = await createUserWithRole('USER');

  const forbidden = await request(app)
    .patch(`/admin/users/${target.user.id}/role`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ role: 'MODERATOR' });

  expect(forbidden.status).toBe(403);

  const allowed = await request(app)
    .patch(`/admin/users/${target.user.id}/role`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ role: 'MODERATOR' });

  expect(allowed.status).toBe(200);
  expect(allowed.body.data.role).toBe('MODERATOR');
});

test('MODERATOR не может изменить роль пользователя', async () => {
  const target = await createUserWithRole('USER');

  const res = await request(app)
    .patch(`/admin/users/${target.user.id}/role`)
    .set('Authorization', `Bearer ${moderator.token}`)
    .send({ role: 'ADMIN' });

  expect(res.status).toBe(403);
});
