'use strict';

/**
 * Имена событий Socket.io собраны в одном месте: и сервер, и клиентские примеры
 * используют эти константы, поэтому в коде нет «магических строк».
 */
const SOCKET_EVENTS = Object.freeze({
  // presence
  USER_ONLINE: 'user:online',
  USER_OFFLINE: 'user:offline',

  // общий чат
  MESSAGE_SEND: 'message:send',
  MESSAGE_NEW: 'message:new',

  // комнаты
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  ROOM_MESSAGE: 'room:message',
  ROOM_JOINED: 'room:joined',
  ROOM_LEFT: 'room:left',

  // ошибки обработчиков (в дополнение к ack-ответу)
  ERROR: 'chat:error',
});

/** Префикс канала Socket.io для комнаты: room:general. */
const ROOM_CHANNEL_PREFIX = 'room:';

function roomChannel(roomName) {
  return `${ROOM_CHANNEL_PREFIX}${roomName}`;
}

module.exports = { SOCKET_EVENTS, ROOM_CHANNEL_PREFIX, roomChannel };
