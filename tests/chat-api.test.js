'use strict';

const request = require('supertest');

const {
  app,
  prisma,
  resetDatabase,
  createUserWithRole,
} = require('./helpers');

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('GET /api/chat/online', () => {
  test('требует аутентификацию', async () => {
    const res = await request(app).get('/api/chat/online');

    expect(res.status).toBe(401);
  });

  test('без открытых сокетов возвращает пустой список', async () => {
    const { token } = await createUserWithRole('USER');

    const res = await request(app)
      .get('/api/chat/online')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.count).toBe(0);
  });
});

describe('POST /api/chat/rooms', () => {
  test('создаёт комнату', async () => {
    const { token } = await createUserWithRole('USER');

    const res = await request(app)
      .post('/api/chat/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'general' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'general' });

    const stored = await prisma.chatRoom.findUnique({ where: { name: 'general' } });
    expect(stored).not.toBeNull();
  });

  test('возвращает 409 для существующей комнаты', async () => {
    const { token } = await createUserWithRole('USER');
    await prisma.chatRoom.create({ data: { name: 'general' } });

    const res = await request(app)
      .post('/api/chat/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'general' });

    expect(res.status).toBe(409);
  });

  test('отклоняет некорректное имя комнаты', async () => {
    const { token } = await createUserWithRole('USER');

    const res = await request(app)
      .post('/api/chat/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'комната с пробелами' });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('name');
  });
});

describe('История сообщений', () => {
  async function seedHistory() {
    const { user } = await createUserWithRole('USER');
    await prisma.chatRoom.create({ data: { name: 'history-room' } });

    await prisma.chatMessage.createMany({
      data: [
        { content: 'global-1', authorId: user.id },
        { content: 'room-1', room: 'history-room', authorId: user.id },
        { content: 'room-2', room: 'history-room', authorId: user.id },
        { content: 'global-2', authorId: user.id },
      ],
    });

    return { user };
  }

  test('GET /api/chat/rooms возвращает комнаты с количеством сообщений', async () => {
    await seedHistory();
    const { token } = await createUserWithRole('USER');

    const res = await request(app)
      .get('/api/chat/rooms')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const room = res.body.data.find((item) => item.name === 'history-room');
    expect(room).toBeDefined();
    expect(room.messageCount).toBe(2);
    expect(room.online).toBe(0);
  });

  test('GET /api/chat/rooms/:room/messages возвращает сообщения комнаты по порядку', async () => {
    await seedHistory();
    const { token } = await createUserWithRole('USER');

    const res = await request(app)
      .get('/api/chat/rooms/history-room/messages')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((message) => message.content)).toEqual(['room-1', 'room-2']);
    expect(res.body.data[0].room).toBe('history-room');
    expect(res.body.data[0].author).toMatchObject({ id: expect.any(Number) });
    expect(res.body.meta.room).toBe('history-room');
  });

  test('GET /api/chat/messages возвращает только общий чат', async () => {
    await seedHistory();
    const { token } = await createUserWithRole('USER');

    const res = await request(app)
      .get('/api/chat/messages')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((message) => message.content)).toEqual(['global-1', 'global-2']);
    expect(res.body.data.every((message) => message.room === null)).toBe(true);
  });

  test('поддерживает limit и before', async () => {
    await seedHistory();
    const { token } = await createUserWithRole('USER');

    const lastTwo = await request(app)
      .get('/api/chat/rooms/history-room/messages?limit=1')
      .set('Authorization', `Bearer ${token}`);

    expect(lastTwo.body.data.map((message) => message.content)).toEqual(['room-2']);

    const roomMessages = await prisma.chatMessage.findMany({
      where: { room: 'history-room' },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    const beforeLast = await request(app)
      .get(`/api/chat/rooms/history-room/messages?before=${roomMessages[1].id}&limit=5`)
      .set('Authorization', `Bearer ${token}`);

    expect(beforeLast.body.data.map((message) => message.content)).toEqual(['room-1']);
  });

  test('возвращает 404 для неизвестной комнаты', async () => {
    const { token } = await createUserWithRole('USER');

    const res = await request(app)
      .get('/api/chat/rooms/does-not-exist/messages')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
