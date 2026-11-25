'use strict';

/** Поля автора, которые возвращаются вместе с сообщением. */
const authorSelect = { id: true, name: true, role: true };

/**
 * Приведение сущностей Prisma к виду, который уходит по WebSocket.
 * Email и пароль в realtime-события не попадают.
 */
function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
  };
}

function serializeMessage(message) {
  return {
    id: message.id,
    content: message.content,
    room: message.room ?? null,
    createdAt: new Date(message.createdAt).toISOString(),
    author: message.author ? serializeUser(message.author) : undefined,
  };
}

module.exports = { authorSelect, serializeUser, serializeMessage };
