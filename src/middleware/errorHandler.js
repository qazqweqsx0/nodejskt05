'use strict';

const { Prisma } = require('@prisma/client');
const config = require('../config');

class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(message = 'Некорректный запрос', details) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'Требуется аутентификация') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Недостаточно прав') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Ресурс не найден') {
    return new ApiError(404, message);
  }

  static conflict(message = 'Конфликт данных', details) {
    return new ApiError(409, message, details);
  }
}

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Маршрут ${req.method} ${req.originalUrl} не найден`));
}

function fromPrismaError(error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? target.join(', ') : target;
        return new ApiError(409, `Нарушено ограничение уникальности${fields ? `: ${fields}` : ''}`, {
          fields,
        });
      }
      case 'P2003':
        return new ApiError(400, 'Связанная запись не существует', {
          field: error.meta?.field_name,
        });
      case 'P2014':
        return new ApiError(409, 'Изменение нарушило бы обязательную связь между записями');
      case 'P2025':
        return new ApiError(404, error.meta?.cause || 'Запись не найдена');
      default:
        return new ApiError(500, `Запрос к базе данных завершился ошибкой (код ${error.code})`);
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return new ApiError(400, 'Некорректные данные для запроса к базе данных');
  }

  return null;
}

function errorHandler(err, req, res, next) {
  let error = err;

  if (!(error instanceof ApiError)) {
    if (error.type === 'entity.parse.failed') {
      error = ApiError.badRequest('Некорректный JSON в теле запроса');
    } else if (error.type === 'entity.too.large') {
      error = new ApiError(413, 'Тело запроса слишком большое');
    } else {
      error = fromPrismaError(error) || error;
    }
  }

  const statusCode = error instanceof ApiError ? error.statusCode : 500;
  const isServerError = statusCode >= 500;

  if (isServerError) {
    console.error('[error]', err);
  }

  const payload = {
    error: {
      status: statusCode,
      message: error instanceof ApiError ? error.message : 'Внутренняя ошибка сервера',
    },
  };

  if (error instanceof ApiError && error.details !== undefined) {
    payload.error.details = error.details;
  }

  if (isServerError && config.env !== 'production') {
    payload.error.stack = err.stack;
  }

  res.status(statusCode).json(payload);
}

module.exports = { ApiError, asyncHandler, errorHandler, notFoundHandler };
