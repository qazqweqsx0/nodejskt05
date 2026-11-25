'use strict';

const { serializeUser } = require('./serialize');

/**
 * Реестр онлайн-пользователей.
 *
 * Один пользователь может открыть несколько вкладок, поэтому хранится
 * множество socket.id на пользователя: `user:online` отправляется только при
 * первом подключении, `user:offline` — только после закрытия последнего.
 */
class PresenceStore {
  constructor() {
    /** @type {Map<number, Set<string>>} userId -> socket ids */
    this.sockets = new Map();
    /** @type {Map<number, object>} userId -> публичные данные пользователя */
    this.users = new Map();
  }

  add(user, socketId) {
    this.users.set(user.id, user);

    let socketIds = this.sockets.get(user.id);
    if (!socketIds) {
      socketIds = new Set();
      this.sockets.set(user.id, socketIds);
    }
    socketIds.add(socketId);

    return { becameOnline: socketIds.size === 1 };
  }

  remove(userId, socketId) {
    const socketIds = this.sockets.get(userId);

    if (!socketIds) {
      return { becameOffline: false, user: undefined };
    }

    socketIds.delete(socketId);

    if (socketIds.size > 0) {
      return { becameOffline: false, user: undefined };
    }

    this.sockets.delete(userId);
    const user = this.users.get(userId);
    this.users.delete(userId);

    return { becameOffline: true, user };
  }

  isOnline(userId) {
    return this.sockets.has(userId);
  }

  connections(userId) {
    return this.sockets.get(userId)?.size ?? 0;
  }

  /** Публичный список онлайн-пользователей (по одному на пользователя). */
  list() {
    return [...this.users.values()].map(serializeUser).sort((a, b) => a.id - b.id);
  }

  count() {
    return this.users.size;
  }

  clear() {
    this.sockets.clear();
    this.users.clear();
  }
}

// Один реестр на процесс: его используют и Socket.io-обработчики, и REST-роут /api/chat/online.
const presenceStore = new PresenceStore();

module.exports = { PresenceStore, presenceStore };
