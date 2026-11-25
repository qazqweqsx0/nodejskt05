'use strict';

const Joi = require('joi');

const config = require('../config');

/** Имя комнаты: латиница/цифры, до 32 символов, допускаются `-` и `_`. */
const ROOM_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;

const contentSchema = Joi.string()
  .trim()
  .min(1)
  .max(config.chat.messageMaxLength)
  .required()
  .messages({
    'string.empty': 'Сообщение не может быть пустым',
    'string.max': `Сообщение длиннее ${config.chat.messageMaxLength} символов`,
  });

const roomNameSchema = Joi.string()
  .trim()
  .pattern(ROOM_NAME_PATTERN)
  .required()
  .messages({
    'string.pattern.base':
      'Имя комнаты: 1–32 символа, латиница, цифры, дефис или подчёркивание; начинается с буквы или цифры',
  });

const messageSendSchema = Joi.object({
  content: contentSchema,
});

const roomOnlySchema = Joi.object({
  room: roomNameSchema,
});

const roomMessageSchema = Joi.object({
  room: roomNameSchema,
  content: contentSchema,
});

/**
 * Валидация payload WebSocket-события.
 * @returns {{ value?: object, errors?: Array<{path: string, message: string}> }}
 */
function parsePayload(schema, payload) {
  const { value, error } = schema.validate(payload ?? {}, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    return {
      errors: error.details.map((item) => ({
        path: item.path.join('.'),
        message: item.message,
      })),
    };
  }

  return { value };
}

module.exports = {
  ROOM_NAME_PATTERN,
  messageSendSchema,
  roomOnlySchema,
  roomMessageSchema,
  parsePayload,
};
