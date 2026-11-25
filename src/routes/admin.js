'use strict';

const express = require('express');
const Joi = require('joi');

const { validate } = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

const idSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
});

const roleSchema = Joi.object({
  role: Joi.string().valid('USER', 'MODERATOR', 'ADMIN').required(),
});

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
};

router.patch(
  '/users/:id/role',
  authenticate,
  requireRole('ADMIN'),
  validate(idSchema, 'params'),
  validate(roleSchema),
  asyncHandler(async (req, res) => {
    const prisma = req.app.locals.prisma;

    try {
      const user = await prisma.user.update({
        where: { id: req.params.id },
        data: { role: req.body.role },
        select: userSelect,
      });

      res.json({ data: user });
    } catch (error) {
      if (error.code === 'P2025') {
        throw ApiError.notFound(`Пользователь с id ${req.params.id} не найден`);
      }
      throw error;
    }
  }),
);

module.exports = router;
