'use strict';

const { SOCKET_EVENTS } = require('./events');

/**
 * Единый формат ответа на событие с ack-колбэком.
 * Клиент может либо передать ack, либо слушать `chat:error`.
 */
function replySuccess(ack, payload = {}) {
  if (typeof ack === 'function') {
    ack({ ok: true, ...payload });
  }
}

function replyError(socket, ack, code, message, details) {
  const error = { code, message };

  if (details) {
    error.details = details;
  }

  if (typeof ack === 'function') {
    ack({ ok: false, error });
  }

  socket.emit(SOCKET_EVENTS.ERROR, error);
}

module.exports = { replySuccess, replyError };
