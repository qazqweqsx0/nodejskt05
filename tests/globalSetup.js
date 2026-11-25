'use strict';

const { execSync } = require('child_process');
const path = require('path');

module.exports = async () => {
  const cwd = path.resolve(__dirname, '..');
  const env = { ...process.env, DATABASE_URL: 'file:./test.db' };

  execSync('npx prisma db push --skip-generate --force-reset --accept-data-loss', {
    cwd,
    env,
    stdio: 'inherit',
  });
};
