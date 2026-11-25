process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test.db';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-for-jest-only';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-jest-only';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.BCRYPT_ROUNDS = '4';
// Тесты создают много пользователей и логинятся чаще, чем разрешено в production.
process.env.LOGIN_RATE_LIMIT_MAX = '1000';
process.env.BODY_LIMIT = '10kb';
process.env.CHAT_MESSAGE_MAX_LENGTH = '1000';
process.env.CHAT_HISTORY_DEFAULT_LIMIT = '20';
process.env.CHAT_HISTORY_MAX_LIMIT = '100';
