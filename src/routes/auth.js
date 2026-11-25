'use strict';

const express = require('express');
const Joi = require('joi');
const rateLimit = require('express-rate-limit');

const config = require('../config');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');

const router = express.Router();

const registerSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().max(254).required(),
  name: Joi.string().trim().min(1).max(120).required(),
  password: Joi.string().min(8).max(72).required(),
});

const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  password: Joi.string().required(),
});

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
};

const loginLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  max: config.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      status: 429,
      message: 'Слишком много попыток входа. Попробуйте позже.',
    },
  },
});

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: config.cookie.maxAgeMs,
  };
}

function clearRefreshCookie(res) {
  res.clearCookie(config.cookie.name, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}

router.post(
  '/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const prisma = req.app.locals.prisma;
    const { email, name, password } = req.body;
    const passwordHash = await hashPassword(password);

    try {
      const user = await prisma.user.create({
        data: { email, name, password: passwordHash },
        select: userSelect,
      });

      res.status(201).json({ data: user });
    } catch (error) {
      if (error.code === 'P2002') {
        throw ApiError.conflict('Пользователь с таким email уже зарегистрирован', { field: 'email' });
      }
      throw error;
    }
  }),
);

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const prisma = req.app.locals.prisma;
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    const passwordMatches = user ? await verifyPassword(password, user.password) : false;

    if (!user || !passwordMatches) {
      throw new ApiError(401, 'Неверный email или пароль');
    }

    res.cookie(config.cookie.name, signRefreshToken(user), refreshCookieOptions());
    res.json({
      accessToken: signAccessToken(user),
      user: toPublicUser(user),
    });
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const prisma = req.app.locals.prisma;
    const token = req.cookies ? req.cookies[config.cookie.name] : undefined;

    if (!token) {
      throw new ApiError(401, 'Refresh token не найден');
    }

    let payload;

    try {
      payload = verifyRefreshToken(token);
    } catch (error) {
      throw new ApiError(401, 'Недействительный refresh token');
    }

    const user = await prisma.user.findUnique({
      where: { id: Number(payload.sub) },
      select: userSelect,
    });

    if (!user) {
      throw new ApiError(401, 'Пользователь не найден');
    }

    res.cookie(config.cookie.name, signRefreshToken(user), refreshCookieOptions());
    res.json({ accessToken: signAccessToken(user) });
  }),
);

router.post('/logout', (req, res) => {
  clearRefreshCookie(res);
  res.status(204).send();
});

router.get('/me', authenticate, (req, res) => {
  res.json({ data: req.user });
});

module.exports = router;
