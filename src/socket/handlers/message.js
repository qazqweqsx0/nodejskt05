'use strict';

const { SOCKET_EVENTS } = require('../events');
const { parsePayload, messageSendSchema } = require('../validation');
const { replyError, replySuccess } = require('../responses');
const { authorSelect, serializeMessage } = require('../serialize');

/**
 * Общий чат: `message:send` -> сохранение в БД -> `message:new` всем подключённым.
 */
function registerMessageHandlers(io, socket, { prisma }) {
  socket.on(SOCKET_EVENTS.MESSAGE_SEND, async (payload, ack) => {
    const { value, errors } = parsePayload(messageSendSchema, payload);

    if (errors) {
      return replyError(socket, ack, 'VALIDATION_ERROR', 'Некорректное сообщение', errors);
    }

    try {
      const message = await prisma.chatMessage.create({
        data: {
          content: value.content,
          authorId: socket.data.user.id,
        },
        include: { author: { select: authorSelect } },
      });

      const data = serializeMessage(message);
      io.emit(SOCKET_EVENTS.MESSAGE_NEW, data);

      return replySuccess(ack, { message: data });
    } catch (error) {
      console.error('[socket] message:send:', error);
      return replyError(socket, ack, 'INTERNAL_ERROR', 'Не удалось сохранить сообщение');
    }
  });
}

module.exports = { registerMessageHandlers };
