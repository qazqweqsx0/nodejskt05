#!/usr/bin/env node
'use strict';

/**
 * CLI-клиент realtime-чата для проверки направления A.
 *
 * Примеры:
 *   node examples/chat-client.js --email alice@example.com --password Password123!
 *   node examples/chat-client.js --email bob@example.com --password Password123! --room general
 *   node examples/chat-client.js --token <accessToken> --url http://localhost:3000
 *
 * Строки, введённые в stdin, отправляются в общий чат или в комнату (если указан --room).
 * Для двух клиентов откройте два терминала с разными аккаунтами.
 */

const readline = require('readline');
const { io } = require('socket.io-client');

const USAGE = `
Использование:
  node examples/chat-client.js --email <email> --password <password> [--room <имя>] [--url <url>]
  node examples/chat-client.js --token <accessToken> [--room <имя>] [--url <url>]

Параметры:
  --email      email существующего пользователя
  --password   пароль пользователя
  --token      готовый access-токен (вместо email/password)
  --room       комната, в которую войти после подключения
  --url        базовый URL API (по умолчанию CHAT_URL или http://localhost:3000)
  --help       показать эту подсказку
`.trim();

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith('--')) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=');

    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
      continue;
    }

    const next = argv[index + 1];

    if (next !== undefined && !next.startsWith('--')) {
      args[rawKey] = next;
      index += 1;
    } else {
      args[rawKey] = true;
    }
  }

  return args;
}

async function fetchAccessToken(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`POST /auth/login -> ${response.status}: ${body}`);
  }

  return response.json();
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(USAGE);
    return;
  }

  const baseUrl = (args.url || process.env.CHAT_URL || 'http://localhost:3000').replace(/\/$/, '');

  let token = typeof args.token === 'string' ? args.token : null;

  if (!token) {
    if (!args.email || !args.password) {
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }

    const session = await fetchAccessToken(baseUrl, args.email, args.password);
    token = session.accessToken;
    console.log(`Вошли как ${session.user.name} <${session.user.email}>`);
  }

  const socket = io(baseUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });

  let targetRoom = typeof args.room === 'string' ? args.room : null;
  let ready = !targetRoom;
  const pending = [];

  function sendMessage(content) {
    const event = targetRoom ? 'room:message' : 'message:send';
    const payload = targetRoom ? { room: targetRoom, content } : { content };

    socket.emit(event, payload, (ack) => {
      if (!ack?.ok) {
        console.error(`[ошибка] ${ack?.error?.message || 'сообщение не отправлено'}`);
      }
      if (process.stdin.isTTY) {
        rl.prompt();
      }
    });
  }

  // Строки из pipe приходят раньше, чем комната подтверждена ack'ом.
  function markReady() {
    ready = true;
    while (pending.length > 0) {
      sendMessage(pending.shift());
    }
  }

  socket.on('connect', () => {
    console.log(`Подключено к ${baseUrl} (socket ${socket.id})`);

    if (targetRoom) {
      socket.emit('room:join', { room: targetRoom }, (ack) => {
        if (ack?.ok) {
          console.log(`Вошли в комнату #${targetRoom}: ${ack.count} участник(ов)`);
          markReady();
        } else {
          console.error(`Не удалось войти в комнату: ${ack?.error?.message}`);
        }
      });
    } else {
      markReady();
    }

    if (process.stdin.isTTY) {
      process.stdout.write('> ');
    }
  });

  socket.on('connect_error', (error) => {
    console.error(`Ошибка подключения: ${error.message}`);
    process.exitCode = 1;
    socket.close();
  });

  socket.on('user:online', (payload) => {
    if (payload.user.id === undefined) {
      return;
    }

    const names = payload.users.map((user) => user.name).join(', ');
    console.log(
      `[online] ${payload.user.name} в сети (${payload.count}): ${names || '—'}`,
    );
  });

  socket.on('user:offline', (payload) => {
    console.log(`[offline] ${payload.user.name} вышел (${payload.count} осталось)`);
  });

  socket.on('message:new', (message) => {
    console.log(`[общий ${formatTime(message.createdAt)}] ${message.author.name}: ${message.content}`);
  });

  socket.on('room:message', (message) => {
    console.log(`[#${message.room} ${formatTime(message.createdAt)}] ${message.author.name}: ${message.content}`);
  });

  socket.on('chat:error', (error) => {
    console.error(`[chat:error] ${error.code}: ${error.message}`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`Соединение закрыто: ${reason}`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
  });

  if (process.stdin.isTTY) {
    rl.setPrompt('> ');
  }

  rl.on('line', (line) => {
    const content = line.trim();

    if (!content) {
      if (process.stdin.isTTY) {
        rl.prompt();
      }
      return;
    }

    if (!ready) {
      pending.push(content);
      return;
    }

    sendMessage(content);
  });

  rl.on('close', () => {
    // Даём серверу доставить echo и ack по уже отправленным строкам.
    setTimeout(() => socket.disconnect(), 1200);
  });
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exitCode = 1;
});
