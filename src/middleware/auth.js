'use strict';

const { ApiError, asyncHandler } = require('./errorHandler');
const { verifyAccessToken } = require('../utils/jwt');

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
};

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new ApiError(401, 'Требуется аутентификация');
  }

  let payload;

  try {
    payload = verifyAccessToken(token);
  } catch (error) {
    throw new ApiError(401, 'Недействительный или истёкший токен');
  }

  const prisma = req.app.locals.prisma;
  const user = await prisma.user.findUnique({
    where: { id: Number(payload.sub) },
    select: publicUserSelect,
  });

  if (!user) {
    throw new ApiError(401, 'Пользователь не найден');
  }

  req.user = user;
  return next();
});

function requireRole(...roles) {
  return function checkRole(req, res, next) {
    if (!req.user) {
      return next(new ApiError(401, 'Требуется аутентификация'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Недостаточно прав'));
    }

    return next();
  };
}

const isPrivileged = (user) => user.role === 'MODERATOR' || user.role === 'ADMIN';

module.exports = { authenticate, requireRole, isPrivileged, publicUserSelect };
