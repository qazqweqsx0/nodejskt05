# КТ-05 — realtime-чат на Socket.io (направление A)

Проект КТ-04 (REST API блог-платформы с JWT-аутентификацией, RBAC и тестами),
в который добавлен **WebSocket-чат с аутентификацией**: общий чат, комнаты и
список онлайн-пользователей. Всё работает на существующей Express-архитектуре и
использует тех же пользователей и JWT-токены из базы данных.

Стек: Node.js, Express 4, **Socket.io 4**, Prisma ORM 6, SQLite, JWT
(`jsonwebtoken`), Joi, helmet, Jest + Supertest + `socket.io-client`.

## Соответствие заданию

| Требование направления A | Где реализовано |
| --- | --- |
| Socket.io подключён к существующему Express-серверу | `src/server.js`: `http.createServer(app)` + `createSocketServer(httpServer)` |
| При подключении проверяется JWT через middleware | `src/socket/middleware/auth.js`, подключён через `io.use(...)` |
| События `message:send`, `message:new` | `src/socket/handlers/message.js` |
| События `user:online`, `user:offline` | `src/socket/handlers/presence.js` |
| Комнаты `room:join`, `room:leave`, `room:message` | `src/socket/handlers/room.js` |
| Новый пользователь получает список онлайн-пользователей | `src/socket/handlers/presence.js` (событие `user:online` при подключении) |
| При отключении остальные получают уведомление | `src/socket/handlers/presence.js` (событие `user:offline`) |
| Использует аутентификацию и данные из БД | пользователь читается из БД на handshake; сообщения и комнаты хранятся в `ChatMessage` / `ChatRoom` |
| Структура проекта и отсутствие хардкода | `src/socket/*`, `src/routes/chat.js`, настройки в `src/config/index.js`, имена событий в `src/socket/events.js` |

## Быстрый старт

```bash
cd kt05
npm install

# Windows (PowerShell)
Copy-Item .env.example .env
# Linux / macOS
# cp .env.example .env

npx prisma generate
npx prisma migrate dev
npm start                    # http://localhost:3000
```

После запуска:

- демо-клиент чата — <http://localhost:3000/chat.html>;
- REST API — `http://localhost:3000/api/...`;
- Socket.io — `ws://localhost:3000/socket.io`.

Проверка в браузере: откройте `http://localhost:3000/chat.html` в двух окнах
(или обычном и приватном), зарегистрируйте двух пользователей — они увидят друг
друга в списке «Онлайн», смогут писать в общий чат и создавать комнаты.

Тесты:

```bash
npm test
```

## Переменные окружения

| Переменная | По умолчанию | Описание |
| --- | --- | --- |
| `NODE_ENV` | `development` | окружение; в `production` обязательны JWT-секреты |
| `PORT` | `3000` | порт HTTP-сервера (он же порт Socket.io) |
| `DATABASE_URL` | `file:./dev.db` | подключение Prisma (SQLite-файл относительно `prisma/`) |
| `JWT_ACCESS_SECRET` | — | секрет access-токенов |
| `JWT_REFRESH_SECRET` | — | секрет refresh-токенов |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | время жизни access-токена |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | время жизни refresh-токена |
| `BCRYPT_ROUNDS` | `10` | сложность хэширования пароля |
| `LOGIN_RATE_LIMIT_MAX` | `10` | число попыток логина за 15 минут |
| `BODY_LIMIT` | `10kb` | максимальный размер JSON-тела |
| `SOCKET_PATH` | `/socket.io` | путь Socket.io |
| `SOCKET_CORS_ORIGIN` | — (отражать origin) | список origin через запятую для WebSocket |
| `CHAT_MESSAGE_MAX_LENGTH` | `1000` | максимальная длина сообщения |
| `CHAT_HISTORY_DEFAULT_LIMIT` | `20` | размер истории по умолчанию |
| `CHAT_HISTORY_MAX_LIMIT` | `100` | максимум сообщений в одном ответе истории |

## Архитектура

```
                    ┌──────────────────────────────┐
  HTTP/REST ───────▶│ Express: /auth, /api, /admin │──┐
                    └──────────────────────────────┘  │
                                                      ├──▶ Prisma ──▶ SQLite
                    ┌──────────────────────────────┐  │
  WebSocket ───────▶│ Socket.io (io.use JWT-auth)  │──┘
                    │ presence / message / room    │
                    └──────────────────────────────┘
```

`src/app.js` собирает Express-приложение (без `listen`), `src/server.js` создаёт
`http.Server`, навешивает на него Socket.io и запускает прослушивание. Благодаря
этому REST и WebSocket живут на одном порту, а приложение остаётся тестируемым
через Supertest.

### Аутентификация Socket.io

Middleware уровня соединения (`src/socket/middleware/auth.js`) выполняется
**до** события `connection`:

1. Токен берётся из `socket.handshake.auth.token` (браузер) или из заголовка
   `Authorization: Bearer <token>` (CLI, тесты).
2. `verifyAccessToken` проверяет подпись, срок жизни и тип токена (`access`).
3. Пользователь загружается из БД по `sub` из токена — роль и факт удаления
   учитываются без перевыпуска токена.
4. Сокет получает `socket.data.user`; при ошибке соединение отклоняется
   событием `connect_error` (`err.data.code = 'UNAUTHORIZED'`).

```js
const { io } = require('socket.io-client');

const socket = io('http://localhost:3000', {
  auth: { token: accessToken }, // тот же access-токен, что и для REST
});

socket.on('connect_error', (error) => {
  console.error('Не подключились:', error.message); // err.data.code === 'UNAUTHORIZED'
});
```

## События

Формат сообщения (`message:new` и `room:message`):

```json
{
  "id": 12,
  "content": "Привет!",
  "room": null,
  "createdAt": "2026-11-25T12:00:00.000Z",
  "author": { "id": 1, "name": "Alice", "role": "USER" }
}
```

У `room:message` поле `room` содержит имя комнаты. Email и пароль в
realtime-события не попадают.

### Клиент → сервер

| Событие | Payload | Ответ (ack) | Описание |
| --- | --- | --- | --- |
| `message:send` | `{ content }` | `{ ok, message }` | сообщение в общий чат; рассылается `message:new` всем |
| `room:join` | `{ room }` | `{ ok, room, members, count }` | вход в комнату; комната создаётся при первом входе |
| `room:leave` | `{ room }` | `{ ok, room }` | выход из комнаты (история в БД сохраняется) |
| `room:message` | `{ room, content }` | `{ ok, message }` | сообщение участникам комнаты; требует предварительного `room:join` |

Если клиент передал ack-колбэк, он получает `{ ok: true, ... }` либо
`{ ok: false, error: { code, message, details? } }`. Дополнительно ошибки всегда
дублируются событием `chat:error` — можно использовать любой стиль.

### Сервер → клиент

| Событие | Payload | Когда приходит |
| --- | --- | --- |
| `user:online` | `{ user, users, count }` | подключившемуся (список всех онлайн) и остальным, когда пользователь появился в сети |
| `user:offline` | `{ user, users, count }` | всем оставшимся, когда закрылся последний сокет пользователя |
| `message:new` | сообщение | всем подключённым после `message:send` |
| `room:message` | сообщение | только участникам комнаты |
| `room:joined` | `{ room, members, count }` | инициатору `room:join` |
| `room:left` | `{ room }` | инициатору `room:leave` |
| `chat:error` | `{ code, message, details? }` | при ошибке обработчика |

`users` — публичные данные: `id`, `name`, `role`. Пользователь с несколькими
вкладками учитывается один раз; `user:online` приходит только при первой вкладке,
`user:offline` — только после закрытия последней.

Пример обмена:

```js
socket.on('user:online', ({ user, users, count }) => {
  console.log(`${user.name} в сети, всего ${count}:`, users.map((u) => u.name));
});

socket.on('message:new', (message) => {
  console.log(`${message.author.name}: ${message.content}`);
});

socket.emit('message:send', { content: 'Привет!' }, (ack) => {
  if (!ack.ok) console.error(ack.error);
});

socket.emit('room:join', { room: 'general' }, (ack) => {
  if (ack.ok) console.log('В комнате:', ack.members.map((m) => m.name));
});

socket.emit('room:message', { room: 'general', content: 'Всем привет' }, (ack) => {
  if (!ack.ok) console.error(ack.error);
});
```

Коды ошибок `chat:error`: `VALIDATION_ERROR`, `NOT_IN_ROOM`, `ROOM_NOT_FOUND`,
`INTERNAL_ERROR`.

### Комнаты

- имя комнаты: 1–32 символа, латиница, цифры, `-` или `_`; начинается с буквы
  или цифры (регулярка `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$`);
- комната создаётся автоматически при первом `room:join` (запись в `ChatRoom`)
  или явно через `POST /api/chat/rooms`;
- Socket.io-канал комнаты — `room:<имя>`, поэтому имена не пересекаются с
  личными комнатами сокетов;
- при выходе история сообщений остаётся в БД и доступна через REST;
- сообщение в комнату можно отправить только после `room:join` (иначе
  `NOT_IN_ROOM`);
- комнаты публичные: история комнаты доступна любому аутентифицированному
  пользователю.

## REST API чата

Все маршруты требуют access-токен (`Authorization: Bearer <token>`).

| Метод и путь | Описание |
| --- | --- |
| `GET /api/chat/online` | список онлайн-пользователей и их количество |
| `GET /api/chat/rooms` | комнаты: `id`, `name`, `createdAt`, `messageCount`, `online` |
| `POST /api/chat/rooms` | создать комнату: `{ "name": "general" }` |
| `GET /api/chat/messages?limit=20&before=42` | история общего чата (от старых к новым) |
| `GET /api/chat/rooms/:room/messages?limit=20&before=42` | история комнаты |

```bash
TOKEN="<accessToken>"

curl http://localhost:3000/api/chat/online -H "Authorization: Bearer $TOKEN"

curl -X POST http://localhost:3000/api/chat/rooms \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"general"}'

curl "http://localhost:3000/api/chat/rooms/general/messages?limit=50" \
  -H "Authorization: Bearer $TOKEN"
```

`before` — id сообщения, до которого нужна страница (курсорная пагинация).
Ответ истории: `{ "data": [сообщения], "meta": { "room": "general", "limit": 20, "count": 20 } }`.

## Демо-клиент и CLI

### Браузер

`public/chat.html` + `public/chat.css` + `public/chat.js` — минимальный клиент:
вход/регистрация через REST, подключение с `auth.token`, общий чат, комнаты,
онлайн-список, история сообщений. Страница отдаётся Express по адресу
`/chat.html`, клиент Socket.io — самим Socket.io по `/socket.io/socket.io.js`.
HTML рендерится через `textContent`, поэтому сообщения не могут внедрить HTML.

### CLI

```bash
# по email и паролю
node examples/chat-client.js --email alice@example.com --password Password123!

# с входом в комнату
node examples/chat-client.js --email bob@example.com --password Password123! --room general

# по готовому токену и произвольному URL
node examples/chat-client.js --token "$TOKEN" --url http://localhost:3000
```

Строки из stdin отправляются в общий чат или в комнату (`--room`), входящие
события печатаются в консоль. Удобно запустить два терминала с разными
аккаунтами.

## Структура

```
kt05/
├── prisma/
│   ├── schema.prisma              # User, Post, Tag + ChatRoom, ChatMessage
│   └── migrations/                # init (КТ-04) + add_chat
├── public/
│   ├── chat.html                  # демо-клиент чата
│   ├── chat.css
│   └── chat.js
├── examples/
│   └── chat-client.js             # CLI-клиент
├── src/
│   ├── app.js                     # Express-приложение (без listen)
│   ├── server.js                  # http.Server + Socket.io + graceful shutdown
│   ├── config/
│   │   └── index.js               # .env, JWT, cookie, socket, chat, лимиты
│   ├── middleware/
│   │   ├── auth.js                # authenticate, requireRole (REST)
│   │   ├── validate.js            # Joi-валидация REST
│   │   └── errorHandler.js        # ApiError, 404, маппинг ошибок Prisma
│   ├── routes/
│   │   ├── auth.js                # /auth/register|login|refresh|logout|me
│   │   ├── users.js               # /api/users
│   │   ├── posts.js               # /api/posts
│   │   ├── chat.js                # /api/chat: онлайн, комнаты, история
│   │   └── admin.js               # /admin/users/:id/role
│   ├── socket/
│   │   ├── index.js               # createSocketServer(httpServer, { prisma })
│   │   ├── events.js              # имена событий, roomChannel()
│   │   ├── validation.js          # Joi-схемы payload'ов
│   │   ├── responses.js           # единый формат ack и chat:error
│   │   ├── presence.js            # реестр онлайн-пользователей
│   │   ├── serialize.js           # публичные user/message
│   │   ├── middleware/
│   │   │   └── auth.js            # JWT-middleware уровня соединения
│   │   └── handlers/
│   │       ├── presence.js        # user:online / user:offline
│   │       ├── message.js         # message:send / message:new
│   │       └── room.js            # room:join / room:leave / room:message
│   └── utils/
│       ├── jwt.js
│       └── password.js
├── tests/
│   ├── auth.test.js               # регистрация, логин, refresh, logout, me
│   ├── rbac.test.js               # права ролей и владение постами
│   ├── security.test.js           # helmet, лимит тела, скрытие stack trace
│   ├── jwt.test.js                # unit-тесты JWT
│   ├── socket.test.js             # Socket.io: auth, presence, чат, комнаты
│   ├── chat-api.test.js           # REST чата: комнаты и история
│   ├── helpers.js
│   ├── setupEnv.js
│   └── globalSetup.js
├── .env
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Модели данных

```prisma
model ChatRoom {
  id        Int      @id @default(autoincrement())
  name      String   @unique
  createdAt DateTime @default(now())
}

model ChatMessage {
  id        Int      @id @default(autoincrement())
  content   String
  room      String?  // null — общий чат
  createdAt DateTime @default(now())
  authorId  Int
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@index([room, id])
  @@index([createdAt])
}
```

Миграция: `prisma/migrations/*_add_chat/migration.sql`. Удаление пользователя
каскадно удаляет его сообщения.

## Тесты

```bash
npm test
```

48 тестов в 6 файлах. Тесты Socket.io поднимают настоящий HTTP-сервер на
случайном порту и подключаются `socket.io-client`; REST-тесты используют
Supertest. Тестовая БД `prisma/test.db` пересоздаётся в `globalSetup`, боевая
`prisma/dev.db` не затрагивается.

Что проверяется в новых тестах:

- `socket.test.js`:
  - подключение без токена и с невалидным токеном отклоняется;
  - с валидным токеном соединение устанавливается;
  - новый пользователь получает список онлайн-пользователей;
  - второй пользователь получает `user:online`, а при отключении — `user:offline`;
  - вторая вкладка не создаёт дубликат и не отправляет `user:offline` раньше времени;
  - `message:send` рассылает `message:new` всем и сохраняет сообщение в БД;
  - пустое сообщение отклоняется с `VALIDATION_ERROR`;
  - `room:message` получают только участники комнаты;
  - после `room:leave` сообщения не приходят;
  - нельзя писать в комнату без `room:join` (`NOT_IN_ROOM`);
  - некорректное имя комнаты отклоняется;
  - REST `/api/chat/online` показывает тех же пользователей, что и Socket.io.
- `chat-api.test.js`:
  - `/api/chat/online` требует аутентификацию и без сокетов пуст;
  - создание комнаты, дубликат (`409`), валидация имени (`400`);
  - список комнат с количеством сообщений;
  - история комнаты и общего чата, `limit`/`before`, `404` для неизвестной комнаты.

Ожидаемый результат:

```
Test Suites: 6 passed, 6 total
Tests:       48 passed, 48 total
```

## Безопасность

- JWT проверяется **до** установки WebSocket-соединения; refresh-токен как
  access не принимается.
- При handshake пользователь перечитывается из БД: удалённый пользователь или
  смена роли применяются сразу.
- Все payload'ы проходят Joi-валидацию (`stripUnknown`), длина сообщения и имя
  комнаты ограничены настройками.
- В realtime-события не попадают email и хэш пароля — только `id`, `name`, `role`.
- CSP helmet разрешает подключения только к своему origin (`connect-src 'self' ws: wss:`),
  демо-страница не использует inline-скрипты.
- CORS для Socket.io настраивается через `SOCKET_CORS_ORIGIN`; по умолчанию
  origin отражается, как и в REST (`cors({ origin: true })`).
- SQL-инъекции исключены: доступ к данным только через Prisma.
- REST сохраняет прежние меры КТ-04: helmet, rate limiting логина, лимит тела
  10 kb, bcrypt, httpOnly refresh-cookie.

## Отличия от КТ-04

- добавлены зависимости `socket.io` (runtime) и `socket.io-client` (dev/test);
- в Prisma появились модели `ChatRoom` и `ChatMessage` + миграция `add_chat`;
- `src/server.js` создаёт `http.Server`, навешивает Socket.io и корректно
  закрывает оба сервера при `SIGINT`/`SIGTERM`;
- появился слой `src/socket/` (auth-middleware, presence, обработчики, события,
  валидация) и REST-роутер `/api/chat`;
- Express отдаёт статику из `public/` — демо-клиент чата;
- добавлен CLI-пример `examples/chat-client.js` и скрипт `npm run chat:demo`;
- 48 тестов вместо 25; тестовые хелперы очищают сообщения и комнаты.

## Возможные развития

- Redis-adapter Socket.io и общий presence-store для нескольких инстансов
  (сейчас реестр онлайна хранится в памяти процесса).
- Rate limiting на socket-сообщения и проверка членства в комнате для истории.
- Приватные комнаты и приглашения, редактирование/удаление сообщений,
  индикатор «печатает…», доставка непрочитанных.
- Хранение refresh-токенов и их отзыв (сейчас refresh-cookie stateless).
