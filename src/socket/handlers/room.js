'use strict';

const { SOCKET_EVENTS, roomChannel } = require('../events');
const { parsePayload, roomOnlySchema, roomMessageSchema } = require('../validation');
const { replyError, replySuccess } = require('../responses');
const { authorSelect, serializeMessage, serializeUser } = require('../serialize');

/** Уникальные онлайн-участники комнаты (по одному на пользователя). */
async function fetchRoomMembers(io, channel) {
  const sockets = await io.in(channel).fetchSockets();
  const members = new Map();

  for (const remoteSocket of sockets) {
    const user = remoteSocket.data?.user;
    if (user) {
      members.set(user.id, serializeUser(user));
    }
  }

  return [...members.values()].sort((a, b) => a.id - b.id);
}

/**
 * Комнаты:
 *  - `room:join`  — создаёт комнату при первом входе и подписывает сокет на канал;
 *  - `room:leave` — отписывает сокет (история сообщений остаётся в БД);
 *  - `room:message` — сообщение только участникам комнаты, с сохранением в БД.
 */
function registerRoomHandlers(io, socket, { prisma }) {
  socket.on(SOCKET_EVENTS.ROOM_JOIN, async (payload, ack) => {
    const { value, errors } = parsePayload(roomOnlySchema, payload);

    if (errors) {
      return replyError(socket, ack, 'VALIDATION_ERROR', 'Некорректное имя комнаты', errors);
    }

    const { room } = value;
    const channel = roomChannel(room);

    try {
      await prisma.chatRoom.upsert({
        where: { name: room },
        update: {},
        create: { name: room },
      });

      await socket.join(channel);

      const members = await fetchRoomMembers(io, channel);
      const response = { room, members, count: members.length };

      socket.emit(SOCKET_EVENTS.ROOM_JOINED, response);
      return replySuccess(ack, response);
    } catch (error) {
      console.error('[socket] room:join:', error);
      return replyError(socket, ack, 'INTERNAL_ERROR', 'Не удалось присоединиться к комнате');
    }
  });

  socket.on(SOCKET_EVENTS.ROOM_LEAVE, async (payload, ack) => {
    const { value, errors } = parsePayload(roomOnlySchema, payload);

    if (errors) {
      return replyError(socket, ack, 'VALIDATION_ERROR', 'Некорректное имя комнаты', errors);
    }

    const { room } = value;
    await socket.leave(roomChannel(room));

    socket.emit(SOCKET_EVENTS.ROOM_LEFT, { room });
    return replySuccess(ack, { room });
  });

  socket.on(SOCKET_EVENTS.ROOM_MESSAGE, async (payload, ack) => {
    const { value, errors } = parsePayload(roomMessageSchema, payload);

    if (errors) {
      return replyError(socket, ack, 'VALIDATION_ERROR', 'Некорректное сообщение комнаты', errors);
    }

    const { room, content } = value;
    const channel = roomChannel(room);

    if (!socket.rooms.has(channel)) {
      return replyError(
        socket,
        ack,
        'NOT_IN_ROOM',
        `Сначала присоединитесь к комнате «${room}» (room:join)`,
      );
    }

    try {
      const exists = await prisma.chatRoom.findUnique({
        where: { name: room },
        select: { id: true },
      });

      if (!exists) {
        return replyError(socket, ack, 'ROOM_NOT_FOUND', `Комната «${room}» не найдена`);
      }

      const message = await prisma.chatMessage.create({
        data: {
          content,
          room,
          authorId: socket.data.user.id,
        },
        include: { author: { select: authorSelect } },
      });

      const data = serializeMessage(message);
      io.to(channel).emit(SOCKET_EVENTS.ROOM_MESSAGE, data);

      return replySuccess(ack, { message: data });
    } catch (error) {
      console.error('[socket] room:message:', error);
      return replyError(socket, ack, 'INTERNAL_ERROR', 'Не удалось отправить сообщение в комнату');
    }
  });
}

module.exports = { registerRoomHandlers, fetchRoomMembers };
