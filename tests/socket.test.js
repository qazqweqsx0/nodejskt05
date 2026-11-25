'use strict';

const http = require('http');
const request = require('supertest');
const { io: createClient } = require('socket.io-client');

const app = require('../src/app');
const { createSocketServer } = require('../src/socket');
const { presenceStore } = require('../src/socket/presence');
const {
  prisma,
  resetDatabase,
  createUserWithRole,
} = require('./helpers');

let httpServer;
let ioServer;
let baseUrl;

const clients = [];

function connect(token, options = {}) {
  const client = createClient(baseUrl, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    ...options,
  });

  clients.push(client);
  return client;
}

function once(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Таймаут: событие «${event}» не получено`));
    }, timeout);

    function onEvent(payload) {
      clearTimeout(timer);
      resolve(payload);
    }

    socket.once(event, onEvent);
  });
}

function waitForConnection(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

/** Подключается и дожидается первого `user:online` со списком онлайн-пользователей. */
async function connectReady(token) {
  const socket = connect(token);
  const onlinePromise = once(socket, 'user:online');

  await waitForConnection(socket);
  const online = await onlinePromise;

  return { socket, online };
}

/** Проверяет, что событие не пришло в течение `windowMs`. */
function expectNoEvent(socket, event, windowMs = 300) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve();
    }, windowMs);

    function onEvent(payload) {
      clearTimeout(timer);
      socket.off(event, onEvent);
      reject(new Error(`Неожиданное событие «${event}»: ${JSON.stringify(payload)}`));
    }

    socket.on(event, onEvent);
  });
}

beforeAll(async () => {
  httpServer = http.createServer(app);
  ioServer = createSocketServer(httpServer, { prisma });

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const { port } = httpServer.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.disconnect();
  }

  presenceStore.clear();
  await resetDatabase();
});

afterAll(async () => {
  await new Promise((resolve) => ioServer.close(resolve));

  if (httpServer.listening) {
    await new Promise((resolve) => httpServer.close(resolve));
  }

  await prisma.$disconnect();
});

describe('Аутентификация Socket.io', () => {
  test('отклоняет подключение без токена', async () => {
    const socket = connect(null);
    const error = await once(socket, 'connect_error');

    expect(socket.connected).toBe(false);
    expect(error.message).toMatch(/access-токен/i);
  });

  test('отклоняет подключение с недействительным токеном', async () => {
    const socket = connect('not-a-valid-jwt');
    const error = await once(socket, 'connect_error');

    expect(socket.connected).toBe(false);
    expect(error.message).toMatch(/недействительный|истёкший/i);
  });

  test('пускает с валидным access-токеном', async () => {
    const alice = await createUserWithRole('USER');
    const { socket, online } = await connectReady(alice.token);

    expect(socket.connected).toBe(true);
    expect(online.user).toMatchObject({ id: alice.user.id, name: alice.user.name });
  });
});

describe('Presence', () => {
  test('новый пользователь получает список онлайн-пользователей', async () => {
    const alice = await createUserWithRole('USER');
    const bob = await createUserWithRole('MODERATOR');

    const { socket: aliceSocket } = await connectReady(alice.token);

    const aliceSeesBob = once(aliceSocket, 'user:online');
    const { online: bobOnline } = await connectReady(bob.token);

    const ids = bobOnline.users.map((user) => user.id).sort();
    expect(ids).toEqual([alice.user.id, bob.user.id].sort());
    expect(bobOnline.count).toBe(2);

    const alicePayload = await aliceSeesBob;
    expect(alicePayload.user.id).toBe(bob.user.id);
    expect(alicePayload.count).toBe(2);
  });

  test('при отключении остальные получают user:offline', async () => {
    const alice = await createUserWithRole('USER');
    const bob = await createUserWithRole('USER');

    const { socket: aliceSocket } = await connectReady(alice.token);
    const { socket: bobSocket } = await connectReady(bob.token);

    const bobSeesOffline = once(bobSocket, 'user:offline');
    aliceSocket.disconnect();

    const payload = await bobSeesOffline;
    expect(payload.user.id).toBe(alice.user.id);
    expect(payload.users.map((user) => user.id)).toEqual([bob.user.id]);
    expect(payload.count).toBe(1);
  });

  test('вторая вкладка пользователя не создаёт дубликат и не шлёт offline раньше времени', async () => {
    const alice = await createUserWithRole('USER');
    const bob = await createUserWithRole('USER');

    const { socket: aliceFirst } = await connectReady(alice.token);
    const { socket: bobSocket } = await connectReady(bob.token);

    const bobEvents = [];
    bobSocket.on('user:online', (payload) => bobEvents.push(payload));

    const { socket: aliceSecond } = await connectReady(alice.token);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Вторая вкладка не должна выглядеть как «новый онлайн-пользователь».
    expect(bobEvents).toHaveLength(0);

    const noOffline = expectNoEvent(bobSocket, 'user:offline', 300);
    aliceFirst.disconnect();
    await noOffline;

    const offlinePromise = once(bobSocket, 'user:offline');
    aliceSecond.disconnect();

    const payload = await offlinePromise;
    expect(payload.user.id).toBe(alice.user.id);
  });

  test('REST /api/chat/online показывает тех же онлайн-пользователей', async () => {
    const alice = await createUserWithRole('USER');
    await connectReady(alice.token);

    const res = await request(app)
      .get('/api/chat/online')
      .set('Authorization', `Bearer ${alice.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: alice.user.id, name: alice.user.name });
    expect(res.body.meta.count).toBe(1);
  });
});

describe('Общий чат: message:send / message:new', () => {
  test('рассылает сообщение всем и сохраняет его в БД', async () => {
    const alice = await createUserWithRole('USER');
    const bob = await createUserWithRole('USER');

    const { socket: aliceSocket } = await connectReady(alice.token);
    const { socket: bobSocket } = await connectReady(bob.token);

    const aliceGets = once(aliceSocket, 'message:new');
    const bobGets = once(bobSocket, 'message:new');

    const ack = await aliceSocket
      .timeout(5000)
      .emitWithAck('message:send', { content: 'Привет из теста!' });

    expect(ack).toMatchObject({ ok: true });

    const [aliceMessage, bobMessage] = await Promise.all([aliceGets, bobGets]);

    expect(aliceMessage).toMatchObject({
      content: 'Привет из теста!',
      room: null,
      author: { id: alice.user.id, name: alice.user.name },
    });
    expect(bobMessage.id).toBe(aliceMessage.id);
    expect(typeof aliceMessage.createdAt).toBe('string');

    const stored = await prisma.chatMessage.findUnique({ where: { id: aliceMessage.id } });
    expect(stored).not.toBeNull();
    expect(stored.content).toBe('Привет из теста!');
    expect(stored.room).toBeNull();
    expect(stored.authorId).toBe(alice.user.id);
  });

  test('отклоняет пустое сообщение', async () => {
    const alice = await createUserWithRole('USER');
    const { socket } = await connectReady(alice.token);

    const errorEvent = once(socket, 'chat:error');
    const ack = await socket.timeout(5000).emitWithAck('message:send', { content: '   ' });

    expect(ack.ok).toBe(false);
    expect(ack.error.code).toBe('VALIDATION_ERROR');

    const error = await errorEvent;
    expect(error.code).toBe('VALIDATION_ERROR');

    expect(await prisma.chatMessage.count()).toBe(0);
  });
});

describe('Комнаты: room:join / room:leave / room:message', () => {
  test('сообщение комнаты получают только её участники', async () => {
    const alice = await createUserWithRole('USER');
    const bob = await createUserWithRole('USER');
    const carol = await createUserWithRole('USER');

    const { socket: aliceSocket } = await connectReady(alice.token);
    const { socket: bobSocket } = await connectReady(bob.token);
    const { socket: carolSocket } = await connectReady(carol.token);

    const room = `team-${Date.now()}`;

    const aliceJoin = await aliceSocket.timeout(5000).emitWithAck('room:join', { room });
    expect(aliceJoin).toMatchObject({ ok: true, room, count: 1 });
    expect(aliceJoin.members.map((member) => member.id)).toEqual([alice.user.id]);

    const bobJoin = await bobSocket.timeout(5000).emitWithAck('room:join', { room });
    expect(bobJoin.ok).toBe(true);
    expect(bobJoin.members.map((member) => member.id).sort()).toEqual(
      [alice.user.id, bob.user.id].sort(),
    );

    const carolNoMessage = expectNoEvent(carolSocket, 'room:message', 400);
    const bobGetsMessage = once(bobSocket, 'room:message');
    const aliceGetsMessage = once(aliceSocket, 'room:message');

    const ack = await aliceSocket
      .timeout(5000)
      .emitWithAck('room:message', { room, content: 'Только для команды' });

    expect(ack.ok).toBe(true);

    const [aliceMessage, bobMessage] = await Promise.all([aliceGetsMessage, bobGetsMessage]);
    expect(aliceMessage.room).toBe(room);
    expect(bobMessage.id).toBe(aliceMessage.id);

    await carolNoMessage;

    const stored = await prisma.chatMessage.findUnique({ where: { id: ack.message.id } });
    expect(stored.room).toBe(room);

    const roomRecord = await prisma.chatRoom.findUnique({ where: { name: room } });
    expect(roomRecord).not.toBeNull();
  });

  test('после room:leave сообщения комнаты больше не приходят', async () => {
    const alice = await createUserWithRole('USER');
    const bob = await createUserWithRole('USER');

    const { socket: aliceSocket } = await connectReady(alice.token);
    const { socket: bobSocket } = await connectReady(bob.token);

    const room = `leave-${Date.now()}`;

    await aliceSocket.timeout(5000).emitWithAck('room:join', { room });
    await bobSocket.timeout(5000).emitWithAck('room:join', { room });

    const leaveAck = await bobSocket.timeout(5000).emitWithAck('room:leave', { room });
    expect(leaveAck).toMatchObject({ ok: true, room });

    const bobNoMessage = expectNoEvent(bobSocket, 'room:message', 400);
    const aliceGetsMessage = once(aliceSocket, 'room:message');

    await aliceSocket.timeout(5000).emitWithAck('room:message', { room, content: 'После выхода' });

    const message = await aliceGetsMessage;
    expect(message.content).toBe('После выхода');
    await bobNoMessage;
  });

  test('нельзя писать в комнату, не присоединившись к ней', async () => {
    const alice = await createUserWithRole('USER');
    const { socket } = await connectReady(alice.token);

    const errorEvent = once(socket, 'chat:error');
    const ack = await socket
      .timeout(5000)
      .emitWithAck('room:message', { room: 'unknown-room', content: 'Привет' });

    expect(ack.ok).toBe(false);
    expect(ack.error.code).toBe('NOT_IN_ROOM');
    expect((await errorEvent).code).toBe('NOT_IN_ROOM');
  });

  test('отклоняет некорректное имя комнаты', async () => {
    const alice = await createUserWithRole('USER');
    const { socket } = await connectReady(alice.token);

    const ack = await socket.timeout(5000).emitWithAck('room:join', { room: 'плохое имя!' });

    expect(ack.ok).toBe(false);
    expect(ack.error.code).toBe('VALIDATION_ERROR');
    expect(ack.error.details[0].path).toBe('room');
  });
});
