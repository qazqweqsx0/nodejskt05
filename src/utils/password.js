'use strict';

const bcrypt = require('bcryptjs');
const config = require('../config');

function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, config.security.bcryptRounds);
}

function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

module.exports = { hashPassword, verifyPassword };
