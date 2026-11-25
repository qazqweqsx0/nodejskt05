'use strict';

const request = require('supertest');
const {
  app,
  prisma,
  resetDatabase,
  registerUser,
  loginUser,
} = require('./helpers');

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('POST /auth/register', () => {
  test('регистрирует пользователя и хэширует пароль', async () => {
    const { res, payload } = await registerUser({ name: 'Alice' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      email: payload.email,
      name: 'Alice',
      role: 'USER',
    });
    expect(res.body.data.password).toBeUndefined();

    const stored = await prisma.user.findUnique({ where: { email: payload.email } });
    expect(stored.password).not.toBe(payload.password);
    expect(stored.password.startsWith('$2')).toBe(true);
  });

  test('отклоняет дублирующийся email', async () => {
    const { payload } = await registerUser();
    const res = await request(app).post('/auth/register').send(payload);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/email/i);
  });
});

describe('POST /auth/login', () => {
  test('выдаёт access token и httpOnly refresh cookie', async () => {
    const { payload } = await registerUser();
    const res = await request(app).post('/auth/login').send({
      email: payload.email,
      password: payload.password,
    });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.user.email).toBe(payload.email);

    const cookies = res.headers['set-cookie'].join(';');
    expect(cookies).toContain('refreshToken=');
    expect(cookies.toLowerCase()).toContain('httponly');
  });

  test('возвращает 401 при неверном пароле', async () => {
    const { payload } = await registerUser();
    const res = await request(app).post('/auth/login').send({
      email: payload.email,
      password: 'wrong-password',
    });

    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
  });
});

describe('GET /auth/me', () => {
  test('возвращает текущего пользователя с токеном', async () => {
    const { payload } = await registerUser();
    const { token } = await loginUser(payload.email, payload.password);

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(payload.email);
    expect(res.body.data.password).toBeUndefined();
  });

  test('возвращает 401 без токена', async () => {
    const res = await request(app).get('/auth/me');

    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh и POST /auth/logout', () => {
  test('обновляет access token по refresh cookie', async () => {
    const { payload } = await registerUser();
    const agent = request.agent(app);

    const login = await agent.post('/auth/login').send({
      email: payload.email,
      password: payload.password,
    });
    expect(login.status).toBe(200);

    const refreshed = await agent.post('/auth/refresh');
    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.accessToken).toBe('string');

    const me = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`);
    expect(me.status).toBe(200);
  });

  test('возвращает 401 при refresh без cookie', async () => {
    const res = await request(app).post('/auth/refresh');

    expect(res.status).toBe(401);
  });

  test('logout очищает refresh cookie', async () => {
    const { payload } = await registerUser();
    const login = await request(app).post('/auth/login').send({
      email: payload.email,
      password: payload.password,
    });
    const refreshCookie = login.headers['set-cookie']
      .find((cookie) => cookie.startsWith('refreshToken='))
      .split(';')[0];

    const res = await request(app)
      .post('/auth/logout')
      .set('Cookie', refreshCookie);

    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'].join(';')).toContain('refreshToken=;');
  });
});
