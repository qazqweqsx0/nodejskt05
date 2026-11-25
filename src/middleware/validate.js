'use strict';

const { ApiError } = require('./errorHandler');

function formatDetails(error) {
  return error.details.map((item) => ({
    path: item.path.join('.'),
    message: item.message,
  }));
}

function validate(schema, property = 'body') {
  return function validateRequest(req, res, next) {
    const { value, error } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      return next(ApiError.badRequest('Ошибка валидации', formatDetails(error)));
    }

    req[property] = value;
    return next();
  };
}

module.exports = { validate };
