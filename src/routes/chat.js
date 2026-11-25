'use strict';

const express = require('express');
const Joi = require('joi');

const config = require('../config');
const { validate } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { presenceStore } = require('../socket/presence');
const { ROOM_NAME_PATTERN } = require('../socket/validation');
const { authorSelect, serializeMessage } = require('../socket/serialize');
const { roomChannel } = require('../socket/events');

const router = express.Router();

router.use(authenticate);

const roomParamsSchema = Joi.object({
  room: Joi.string().trim().pattern(ROOM_NAME_PATTERN).required(),
});

const historyQuerySchema = Joi.object({
  limit: Joi.number()
    .integer()
    .min(1)
    .max(config.chat.historyMaxLimit)
    .default(config.chat.historyDefaultLimit),
  before: Joi.number().integer().positive(),
});

const createRoomSchema = Joi.object({
  name: Joi.string().trim().pattern(ROOM_NAME_PATTERN).required(),
});

async function findRoomOrFail(prisma, name) {
  const room = await prisma.chatRoom.findUnique({
    where: { name },
    select: { id: true, name: true, createdAt: true },
  });

  if (!room) {
    throw ApiError.notFound(`Комната «${name}» не найдена`);
  }

  return room;
}

/** История сообщений: от старых к новым, с пагинацией по `before` (id). */
async function loadHistory(prisma, where, { limit, before }) {
  const messages = await prisma.chatMessage.findMany({
    where: {
      ...where,
      ...(before !== undefined ? { id: { lt: before } } : {}),
    },
    orderBy: { id: 'desc' },
    take: limit,
    include: { author: { select: authorSelect } },
  });

  return messages.reverse().map(serializeMessage);
}

async function roomOnlineCount(io, roomName) {
  if (!io) {
    return 0;
  }

  const sockets = await io.in(roomChannel(roomName)).fetchSockets();
  const users = new Set(sockets.map((socket) => socket.data?.user?.id).filter(Boolean));
  return users.size;
}

router.get('/online', (req, res) => {
  res.json({
    data: presenceStore.list(),
    meta: { count: presenceStore.count() },
  });
});

router.get(
  '/rooms',
  asyncHandler(async (req, res) => {
    const prisma = req.app.locals.prisma;
    const io = req.app.locals.io;

    const [rooms, counters] = await Promise.all([
      prisma.chatRoom.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, createdAt: true },
      }),
      prisma.chatMessage.groupBy({
        by: ['room'],
        where: { room: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const messageCounts = new Map(counters.map((item) => [item.room, item._count._all]));

    const data = await Promise.all(
      rooms.map(async (room) => ({
        ...room,
        messageCount: messageCounts.get(room.name) ?? 0,
        online: await roomOnlineCount(io, room.name),
      })),
    );

    res.json({ data });
  }),
);

router.post(
  '/rooms',
  validate(createRoomSchema),
  asyncHandler(async (req, res) => {
    const prisma = req.app.locals.prisma;
    const { name } = req.body;

    try {
      const room = await prisma.chatRoom.create({
        data: { name },
        select: { id: true, name: true, createdAt: true },
      });

      res.status(201).json({ data: room });
    } catch (error) {
      if (error.code === 'P2002') {
        throw ApiError.conflict(`Комната «${name}» уже существует`, { field: 'name' });
      }
      throw error;
    }
  }),
);

router.get(
  '/messages',
  validate(historyQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const prisma = req.app.locals.prisma;
    const messages = await loadHistory(prisma, { room: null }, req.query);

    res.json({
      data: messages,
      meta: { room: null, limit: req.query.limit, count: messages.length },
    });
  }),
);

router.get(
  '/rooms/:room/messages',
  validate(roomParamsSchema, 'params'),
  validate(historyQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const prisma = req.app.locals.prisma;
    const room = await findRoomOrFail(prisma, req.params.room);
    const messages = await loadHistory(prisma, { room: room.name }, req.query);

    res.json({
      data: messages,
      meta: { room: room.name, limit: req.query.limit, count: messages.length },
    });
  }),
);

module.exports = router;
