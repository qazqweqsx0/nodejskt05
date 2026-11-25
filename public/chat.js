'use strict';

/**
 * Демо-клиент realtime-чата.
 * Аутентификация — обычный JWT из POST /auth/login, дальше Socket.io
 * подключается с `auth.token`; события и payload'ы описаны в README.
 */
(function initChatDemo() {
  const STORAGE_KEY = 'kt05.chat.auth';
  const ROOM_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;
  const HISTORY_LIMIT = 50;

  const state = {
    token: null,
    user: null,
    socket: null,
    rooms: [],
    joinedRooms: new Set(),
    active: { type: 'global' },
    messages: new Map(),
  };

  const el = {
    authPanel: document.getElementById('auth-panel'),
    chatPanel: document.getElementById('chat-panel'),
    authForm: document.getElementById('auth-form'),
    email: document.getElementById('email'),
    name: document.getElementById('name'),
    nameField: document.getElementById('name-field'),
    password: document.getElementById('password'),
    registerBtn: document.getElementById('register-btn'),
    authError: document.getElementById('auth-error'),
    currentUser: document.getElementById('current-user'),
    logoutBtn: document.getElementById('logout-btn'),
    onlineCount: document.getElementById('online-count'),
    onlineList: document.getElementById('online-list'),
    chatTitle: document.getElementById('chat-title'),
    chatSubtitle: document.getElementById('chat-subtitle'),
    status: document.getElementById('status'),
    messages: document.getElementById('messages'),
    messageForm: document.getElementById('message-form'),
    messageInput: document.getElementById('message-input'),
    roomForm: document.getElementById('room-form'),
    roomInput: document.getElementById('room-input'),
    roomList: document.getElementById('room-list'),
  };

  function chatKey(active) {
    return active.type === 'global' ? 'global' : `room:${active.room}`;
  }

  function setStatus(message) {
    if (!message) {
      el.status.hidden = true;
      el.status.textContent = '';
      return;
    }

    el.status.hidden = false;
    el.status.textContent = message;
  }

  function showAuthError(message) {
    el.authError.hidden = false;
    el.authError.textContent = message;
  }

  function hideAuthError() {
    el.authError.hidden = true;
    el.authError.textContent = '';
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };

    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(path, { ...options, headers });

    if (response.status === 204) {
      return null;
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
      error.status = response.status;
      error.details = data?.error?.details;
      throw error;
    }

    return data;
  }

  function readStoredSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function setSession(token, user) {
    state.token = token;
    state.user = user;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function showAuthScreen() {
    el.authPanel.hidden = false;
    el.chatPanel.hidden = true;
    el.currentUser.hidden = true;
    el.logoutBtn.hidden = true;
  }

  function enterChat() {
    el.authPanel.hidden = true;
    el.chatPanel.hidden = false;
    el.currentUser.hidden = false;
    el.currentUser.textContent = `${state.user.name} · ${state.user.role}`;
    el.logoutBtn.hidden = false;

    connectSocket();
    loadRooms();
    loadHistory({ type: 'global' });
  }

  function connectSocket() {
    if (state.socket) {
      state.socket.removeAllListeners();
      state.socket.disconnect();
    }

    const socket = io({ auth: { token: state.token } });
    state.socket = socket;

    socket.on('connect', () => {
      setStatus('');

      // После переподключения сервер не помнит комнаты — входим заново.
      for (const room of state.joinedRooms) {
        socket.emit('room:join', { room }, () => {});
      }
    });

    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        setStatus(`Соединение потеряно (${reason}). Переподключение…`);
      }
    });

    socket.on('connect_error', (error) => {
      if (error.data?.code === 'UNAUTHORIZED' || /токен/i.test(error.message)) {
        clearSession();
        state.token = null;
        state.user = null;
        showAuthScreen();
        showAuthError(`Сессия недействительна: ${error.message}`);
        return;
      }

      setStatus(`Ошибка соединения: ${error.message}`);
    });

    socket.on('user:online', renderOnline);
    socket.on('user:offline', renderOnline);
    socket.on('message:new', (message) => receiveMessage('global', message));
    socket.on('room:message', (message) => receiveMessage(`room:${message.room}`, message));
    socket.on('chat:error', (error) => setStatus(`Ошибка: ${error.message}`));
  }

  function renderOnline(payload) {
    el.onlineCount.textContent = String(payload.count ?? payload.users.length);

    el.onlineList.replaceChildren(
      ...payload.users.map((user) => {
        const item = document.createElement('li');
        item.className = 'list-item';

        const name = document.createElement('span');
        name.textContent = user.id === state.user?.id ? `${user.name} (вы)` : user.name;

        const role = document.createElement('span');
        role.className = 'badge';
        role.textContent = user.role;

        item.append(name, role);
        return item;
      }),
    );
  }

  function renderChatHeader() {
    if (state.active.type === 'global') {
      el.chatTitle.textContent = 'Общий чат';
      el.chatSubtitle.textContent = 'сообщения видят все подключённые';
      el.messageInput.placeholder = 'Написать в общий чат…';
      return;
    }

    el.chatTitle.textContent = `# ${state.active.room}`;
    el.chatSubtitle.textContent = 'сообщения видят только участники комнаты';
    el.messageInput.placeholder = `Написать в #${state.active.room}…`;
  }

  function formatTime(isoString) {
    const date = new Date(isoString);
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function renderMessage(message) {
    const item = document.createElement('li');
    item.className = 'message';
    if (message.author?.id === state.user?.id) {
      item.classList.add('own');
    }

    const head = document.createElement('div');
    head.className = 'message-head';

    const author = document.createElement('span');
    author.className = 'message-author';
    author.textContent = message.author?.name || 'Неизвестный';

    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = formatTime(message.createdAt);

    head.append(author, time);

    const text = document.createElement('p');
    text.className = 'message-text';
    text.textContent = message.content;

    item.append(head, text);
    return item;
  }

  function renderMessages() {
    const messages = state.messages.get(chatKey(state.active)) || [];

    if (messages.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'muted';
      empty.textContent =
        state.active.type === 'global'
          ? 'Сообщений пока нет — напишите первым.'
          : 'В комнате пока нет сообщений.';
      el.messages.replaceChildren(empty);
      return;
    }

    el.messages.replaceChildren(...messages.map(renderMessage));
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function renderRooms() {
    if (state.rooms.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'muted';
      empty.textContent = 'Комнат пока нет — создайте первую.';
      el.roomList.replaceChildren(empty);
      return;
    }

    el.roomList.replaceChildren(
      ...state.rooms.map((room) => {
        const item = document.createElement('li');
        item.className = 'list-item';

        if (state.active.type === 'room' && state.active.room === room.name) {
          item.classList.add('active');
        }

        const info = document.createElement('div');

        const name = document.createElement('span');
        name.textContent = `# ${room.name}`;

        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = `${room.messageCount} сообщ. · ${room.online} онлайн`;

        info.append(name, meta);

        const button = document.createElement('button');
        button.className = 'small';

        if (state.joinedRooms.has(room.name)) {
          button.textContent = 'Выйти';
          button.classList.add('ghost');
          button.addEventListener('click', () => leaveRoom(room.name));
        } else {
          button.textContent = 'Войти';
          button.addEventListener('click', () => joinRoom(room.name));
        }

        item.append(info, button);
        return item;
      }),
    );
  }

  function receiveMessage(key, message) {
    const list = state.messages.get(key) || [];

    if (list.some((item) => item.id === message.id)) {
      return;
    }

    list.push(message);
    list.sort((a, b) => a.id - b.id);
    state.messages.set(key, list);

    if (chatKey(state.active) === key) {
      renderMessages();
    }
  }

  async function loadHistory(active) {
    const key = chatKey(active);
    const path =
      active.type === 'global'
        ? `/api/chat/messages?limit=${HISTORY_LIMIT}`
        : `/api/chat/rooms/${encodeURIComponent(active.room)}/messages?limit=${HISTORY_LIMIT}`;

    try {
      const result = await api(path);
      const merged = [...result.data];
      const known = state.messages.get(key) || [];

      for (const message of known) {
        if (!merged.some((item) => item.id === message.id)) {
          merged.push(message);
        }
      }

      merged.sort((a, b) => a.id - b.id);
      state.messages.set(key, merged);
    } catch (error) {
      if (error.status !== 404) {
        setStatus(error.message);
      }
      if (!state.messages.has(key)) {
        state.messages.set(key, []);
      }
    }

    if (chatKey(state.active) === key) {
      renderMessages();
    }
  }

  async function loadRooms() {
    try {
      const result = await api('/api/chat/rooms');
      state.rooms = result.data;
      renderRooms();
    } catch (error) {
      setStatus(error.message);
    }
  }

  function switchChat(active) {
    state.active = active;
    renderChatHeader();
    renderMessages();
    renderRooms();
  }

  function joinRoom(room) {
    if (!state.socket?.connected) {
      setStatus('Нет соединения с сервером');
      return;
    }

    state.socket.emit('room:join', { room }, async (ack) => {
      if (!ack?.ok) {
        setStatus(ack?.error?.message || 'Не удалось войти в комнату');
        return;
      }

      state.joinedRooms.add(room);
      await loadHistory({ type: 'room', room });
      switchChat({ type: 'room', room });
      await loadRooms();
    });
  }

  function leaveRoom(room) {
    if (!state.socket?.connected) {
      setStatus('Нет соединения с сервером');
      return;
    }

    state.socket.emit('room:leave', { room }, async (ack) => {
      if (!ack?.ok) {
        setStatus(ack?.error?.message || 'Не удалось выйти из комнаты');
        return;
      }

      state.joinedRooms.delete(room);

      if (state.active.type === 'room' && state.active.room === room) {
        switchChat({ type: 'global' });
      }

      await loadRooms();
    });
  }

  function sendMessage() {
    const content = el.messageInput.value.trim();

    if (!content) {
      return;
    }

    if (!state.socket?.connected) {
      setStatus('Нет соединения с сервером');
      return;
    }

    const active = state.active;
    const isGlobal = active.type === 'global';
    const event = isGlobal ? 'message:send' : 'room:message';
    const payload = isGlobal ? { content } : { room: active.room, content };

    el.messageInput.value = '';

    state.socket.emit(event, payload, (ack) => {
      if (ack?.ok) {
        setStatus('');
        return;
      }

      el.messageInput.value = content;
      setStatus(ack?.error?.message || 'Не удалось отправить сообщение');
    });
  }

  function login(email, password) {
    return api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  function bindEvents() {
    el.authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideAuthError();

      try {
        const result = await login(el.email.value.trim(), el.password.value);
        setSession(result.accessToken, result.user);
        enterChat();
      } catch (error) {
        showAuthError(error.message);
      }
    });

    el.registerBtn.addEventListener('click', async () => {
      if (el.nameField.hidden) {
        el.nameField.hidden = false;
        el.registerBtn.textContent = 'Создать аккаунт';
        el.name.focus();
        return;
      }

      hideAuthError();
      const email = el.email.value.trim();
      const name = el.name.value.trim();
      const password = el.password.value;

      if (!name) {
        showAuthError('Укажите имя');
        return;
      }

      try {
        await api('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, name, password }),
        });

        const result = await login(email, password);
        setSession(result.accessToken, result.user);
        enterChat();
      } catch (error) {
        showAuthError(error.message);
      }
    });

    el.logoutBtn.addEventListener('click', () => {
      if (state.socket) {
        state.socket.removeAllListeners();
        state.socket.disconnect();
        state.socket = null;
      }

      clearSession();
      state.token = null;
      state.user = null;
      state.rooms = [];
      state.joinedRooms.clear();
      state.messages.clear();

      showAuthScreen();
      hideAuthError();
      el.password.value = '';
    });

    el.messageForm.addEventListener('submit', (event) => {
      event.preventDefault();
      sendMessage();
    });

    el.roomForm.addEventListener('submit', (event) => {
      event.preventDefault();

      const room = el.roomInput.value.trim();

      if (!ROOM_NAME_PATTERN.test(room)) {
        setStatus('Имя комнаты: 1–32 символа, латиница, цифры, дефис или подчёркивание');
        return;
      }

      el.roomInput.value = '';
      joinRoom(room);
    });
  }

  async function boot() {
    bindEvents();
    renderChatHeader();
    renderMessages();

    const stored = readStoredSession();

    if (!stored?.token) {
      return;
    }

    state.token = stored.token;

    try {
      const me = await api('/auth/me');
      state.user = me.data;
      enterChat();
    } catch (error) {
      clearSession();
      state.token = null;
      state.user = null;
    }
  }

  boot();
})();
