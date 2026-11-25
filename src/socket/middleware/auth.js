'use strict';

const { publicUserSelect } = require('../../middleware/auth');
const { verifyAccessToken } = require('../../utils/jwt');

const AUTH_ERROR_CODE = 'UNAUTHORIZED';

/**
 * Access-токен можно передать двумя способами:
 *  - `io(url, { auth: { token } })` — основной вариант для браузера;
 *  - заголовок `Authorization: Bearer <token>` — удобно для CLI и тестов.
 */
function extractToken(socket) {
  const authToken = socket.handshake.auth?.token;

  if (typeof authToken === 'string' && authToken.trim().length > 0) {
    return authToken.trim();
  }

  const header = socket.handshake.headers?.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme === 'Bearer' && token) {
    return token;
  }

  return null;
}

function rejectConnection(next, message) {
  const error = new Error(message);
  error.data = { code: AUTH_ERROR_CODE };
  next(error);
}

/**
 * Middleware уровня соединения: выполняется до события `connection`.
 * Проверяет JWT и загружает актуального пользователя из БД (роль и удаление
 * пользователя учитываются без перевыпуска токена).
 */
function createSocketAuthMiddleware({ prisma }) {
  if (!prisma) {
    throw new Error('createSocketAuthMiddleware: параметр prisma обязателен');
  }

  return async function socketAuthMiddleware(socket, next) {
    const token = extractToken(socket);

    if (!token) {
      return rejectConnection(next, 'Требуется access-токен');
    }

    let payload;

    try {
      payload = verifyAccessToken(token);
    } catch (error) {
      return rejectConnection(next, 'Недействительный или истёкший токен');
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: Number(payload.sub) },
        select: publicUserSelect,
      });

      if (!user) {
        return rejectConnection(next, 'Пользователь не найден');
      }

      socket.data.user = user;
      return next();
    } catch (error) {
      return next(new Error('Не удалось проверить access-токен'));
    }
  };
}

module.exports = { createSocketAuthMiddleware, extractToken, AUTH_ERROR_CODE };
