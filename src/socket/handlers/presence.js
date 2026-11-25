'use strict';

const { SOCKET_EVENTS } = require('../events');
const { serializeUser } = require('../serialize');

/**
 * Presence: кто сейчас онлайн.
 *
 * - при подключении сокет получает `user:online` со списком всех онлайн-пользователей;
 * - остальные получают `user:online` только когда пользователь появился впервые
 *   (вторая вкладка того же пользователя не создаёт дубликат);
 * - `user:offline` уходит всем, когда закрылся последний сокет пользователя.
 */
function registerPresenceHandlers(io, socket, presence) {
  const user = socket.data.user;

  if (!user) {
    // Защита от ошибки конфигурации: без пользователя работать нельзя.
    socket.disconnect(true);
    return;
  }

  const snapshot = () => ({
    user: serializeUser(user),
    users: presence.list(),
    count: presence.count(),
  });

  const { becameOnline } = presence.add(user, socket.id);

  socket.emit(SOCKET_EVENTS.USER_ONLINE, snapshot());

  if (becameOnline) {
    socket.broadcast.emit(SOCKET_EVENTS.USER_ONLINE, snapshot());
  }

  socket.on('disconnect', () => {
    const { becameOffline } = presence.remove(user.id, socket.id);

    if (!becameOffline) {
      return;
    }

    io.emit(SOCKET_EVENTS.USER_OFFLINE, snapshot());
  });
}

module.exports = { registerPresenceHandlers };
