const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

const waitingQueue = [];
const rooms = {};
const userSockets = {};
const userTimestamps = {};

const RATE_LIMIT = 10;
const RATE_WINDOW = 1000;
const MESSAGE_LIMIT = 20;
const MESSAGE_WINDOW = 5000;
const MAX_MESSAGE_LENGTH = 500;

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>&"']/g, function (m) {
    const map = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };
    return map[m];
  });
}

function isRateLimited(socketId) {
  const now = Date.now();
  if (!userTimestamps[socketId]) userTimestamps[socketId] = { actions: [], messages: [] };
  const data = userTimestamps[socketId];
  data.actions = data.actions.filter(t => now - t < RATE_WINDOW);
  if (data.actions.length >= RATE_LIMIT) return true;
  data.actions.push(now);
  return false;
}

function isMessageSpam(socketId) {
  const now = Date.now();
  if (!userTimestamps[socketId]) userTimestamps[socketId] = { actions: [], messages: [] };
  const data = userTimestamps[socketId];
  data.messages = data.messages.filter(t => now - t < MESSAGE_WINDOW);
  if (data.messages.length >= MESSAGE_LIMIT) return true;
  data.messages.push(now);
  return false;
}

function generateRoomId() {
  return 'room_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

function getOnlineCount() {
  return Object.keys(userSockets).length;
}

function broadcastOnlineCount() {
  io.emit('online-count', getOnlineCount());
}

function findMatch(socket) {
  if (waitingQueue.length === 0) {
    waitingQueue.push(socket.id);
    socket.emit('waiting', { message: 'Waiting for a stranger...' });
    return;
  }

  for (let i = 0; i < waitingQueue.length; i++) {
    if (waitingQueue[i] !== socket.id) {
      const partnerId = waitingQueue[i];
      if (userSockets[partnerId]) {
        waitingQueue.splice(i, 1);
        const roomId = generateRoomId();
        rooms[roomId] = {
          users: [socket.id, partnerId],
          roomId: roomId
        };
        socket.join(roomId);
        userSockets[partnerId].join(roomId);
        socket.emit('matched', { roomId: roomId, partnerId: partnerId });
        userSockets[partnerId].emit('matched', { roomId: roomId, partnerId: socket.id });
        return;
      }
    }
  }

  waitingQueue.push(socket.id);
  socket.emit('waiting', { message: 'Waiting for a stranger...' });
}

function getPartnerId(socket, roomId) {
  const room = rooms[roomId];
  if (!room) return null;
  return room.users.find(id => id !== socket.id) || null;
}

function cleanupRoom(socket, roomId) {
  if (!roomId) return;
  const room = rooms[roomId];
  if (!room) return;

  const partnerId = getPartnerId(socket, roomId);
  if (partnerId && userSockets[partnerId]) {
    userSockets[partnerId].emit('stranger-disconnected', { message: 'Stranger has disconnected.' });
    userSockets[partnerId].leave(roomId);
  }

  delete rooms[roomId];
}

function removeFromQueue(socketId) {
  const idx = waitingQueue.indexOf(socketId);
  if (idx !== -1) waitingQueue.splice(idx, 1);
}

io.on('connection', (socket) => {
  userSockets[socket.id] = socket;
  broadcastOnlineCount();

  socket.on('join-queue', () => {
    if (isRateLimited(socket.id)) {
      socket.emit('error-msg', { message: 'Please slow down. Too many requests.' });
      return;
    }
    removeFromQueue(socket.id);
    findMatch(socket);
  });

  socket.on('next-stranger', (data) => {
    if (isRateLimited(socket.id)) {
      socket.emit('error-msg', { message: 'Please slow down. Too many requests.' });
      return;
    }
    const currentRoomId = data?.roomId;
    cleanupRoom(socket, currentRoomId);
    removeFromQueue(socket.id);
    findMatch(socket);
  });

  socket.on('leave-queue', () => {
    removeFromQueue(socket.id);
  });

  socket.on('send-message', (data) => {
    if (!data || !data.roomId || !data.message) return;
    if (isMessageSpam(socket.id)) {
      socket.emit('error-msg', { message: 'Please slow down. Too many messages.' });
      return;
    }
    const clean = sanitize(data.message).trim();
    if (!clean || clean.length > MAX_MESSAGE_LENGTH) return;
    const roomId = data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const partnerId = getPartnerId(socket, roomId);
    if (partnerId && userSockets[partnerId]) {
      userSockets[partnerId].emit('receive-message', {
        message: clean,
        timestamp: Date.now(),
        from: socket.id
      });
      socket.emit('receive-message', {
        message: clean,
        timestamp: Date.now(),
        from: 'me'
      });
    }
  });

  socket.on('typing', (data) => {
    if (!data || !data.roomId) return;
    const roomId = data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const partnerId = getPartnerId(socket, roomId);
    if (partnerId && userSockets[partnerId]) {
      userSockets[partnerId].emit('stranger-typing', {});
    }
  });

  socket.on('stop-typing', (data) => {
    if (!data || !data.roomId) return;
    const roomId = data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const partnerId = getPartnerId(socket, roomId);
    if (partnerId && userSockets[partnerId]) {
      userSockets[partnerId].emit('stranger-stop-typing', {});
    }
  });

  socket.on('video-offer', (data) => {
    if (!data || !data.roomId || !data.offer) return;
    const roomId = data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const partnerId = getPartnerId(socket, roomId);
    if (partnerId && userSockets[partnerId]) {
      userSockets[partnerId].emit('video-offer', { offer: data.offer, from: socket.id });
    }
  });

  socket.on('video-answer', (data) => {
    if (!data || !data.roomId || !data.answer) return;
    const roomId = data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const partnerId = getPartnerId(socket, roomId);
    if (partnerId && userSockets[partnerId]) {
      userSockets[partnerId].emit('video-answer', { answer: data.answer, from: socket.id });
    }
  });

  socket.on('ice-candidate', (data) => {
    if (!data || !data.roomId || !data.candidate) return;
    const roomId = data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const partnerId = getPartnerId(socket, roomId);
    if (partnerId && userSockets[partnerId]) {
      userSockets[partnerId].emit('ice-candidate', { candidate: data.candidate, from: socket.id });
    }
  });

  socket.on('end-call', (data) => {
    const roomId = data?.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const partnerId = getPartnerId(socket, roomId);
    if (partnerId && userSockets[partnerId]) {
      userSockets[partnerId].emit('call-ended', { message: 'Stranger ended the call.' });
    }
  });

  socket.on('disconnect', () => {
    let currentRoomId = null;
    for (const [rid, room] of Object.entries(rooms)) {
      if (room.users.includes(socket.id)) {
        currentRoomId = rid;
        break;
      }
    }
    cleanupRoom(socket, currentRoomId);
    removeFromQueue(socket.id);
    delete userSockets[socket.id];
    delete userTimestamps[socket.id];
    broadcastOnlineCount();
  });

  socket.on('ping-server', () => {
    socket.emit('pong-server');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
