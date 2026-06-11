const socket = io();

let currentRoomId = null;
let partnerId = null;
let isMuted = false;
let isCameraOff = false;
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let isSearching = false;
let typingTimeout = null;
let connectionState = 'idle';

const STUN = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

const $ = (id) => document.getElementById(id);
const el = {
  landingPage: $('landing-page'),
  chatPage: $('chat-page'),
  startChatBtn: $('start-chat-btn'),
  statusText: $('status-text'),
  statusDot: $('status-indicator'),
  typingDots: $('typing-indicator'),
  chatBox: $('chat-messages'),
  msgInput: $('message-input'),
  sendBtn: $('send-btn'),
  waitingSection: $('waiting-section'),
  chatSection: $('chat-section'),
  videoSection: $('video-section'),
  cancelBtn: $('cancel-search-btn'),
  nextBtn: $('next-stranger-btn'),
  muteBtn: $('mute-btn'),
  camBtn: $('camera-btn'),
  localVid: $('local-video'),
  remoteVid: $('remote-video'),
  localPlh: $('local-placeholder'),
  remotePlh: $('remote-placeholder'),
  waitTitle: $('waiting-title'),
  waitSub: $('waiting-subtitle'),
  onlineLanding: $('landing-online-count'),
  onlineChat: $('chat-online-count')
};

// ─── Canvas animated background ───
(function() {
  try {
  const c = document.getElementById('bg-canvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  let dots = [], animId;

  function resize() { c.width = window.innerWidth; c.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  class Dot {
    constructor() {
      this.x = Math.random() * c.width;
      this.y = Math.random() * c.height;
      this.s = Math.random() * 2 + 0.5;
      this.vx = (Math.random() - 0.5) * 0.25;
      this.vy = (Math.random() - 0.5) * 0.25;
      this.o = Math.random() * 0.35 + 0.08;
      this.ph = Math.random() * Math.PI * 2;
    }
    tick() {
      this.ph += 0.008;
      this.x += this.vx;
      this.y += this.vy;
      if (this.x < 0 || this.x > c.width) this.vx *= -1;
      if (this.y < 0 || this.y > c.height) this.vy *= -1;
    }
    draw() {
      const al = this.o * (0.6 + 0.4 * Math.sin(this.ph));
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.s, 0, 6.28);
      ctx.fillStyle = `rgba(167,139,250,${al})`;
      ctx.fill();
    }
  }

  for (let i = 0; i < 70; i++) dots.push(new Dot());

  let mx = -1000, my = -1000;
  document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
  document.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (t) { mx = t.clientX; my = t.clientY; }
  }, { passive: true });

  function lines() {
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 110) {
          ctx.beginPath();
          ctx.moveTo(dots[i].x, dots[i].y);
          ctx.lineTo(dots[j].x, dots[j].y);
          ctx.strokeStyle = `rgba(167,139,250,${0.05 * (1 - d / 110)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
  }

  function frame() {
    ctx.clearRect(0, 0, c.width, c.height);
    dots.forEach(d => { d.tick(); d.draw(); });
    lines();
    dots.forEach(d => {
      const dx = mx - d.x, dy = my - d.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 150) {
        const a = Math.atan2(dy, dx);
        const f = (1 - dist / 150) * 0.4;
        d.x -= Math.cos(a) * f;
        d.y -= Math.sin(a) * f;
      }
    });
    animId = requestAnimationFrame(frame);
  }
  frame();
  } catch(e) { console.warn('Canvas bg error:', e); }
})();

// ─── Hero title animation ───
(function() {
  const h = document.getElementById('hero-title');
  if (!h) return;
  const txt = h.textContent;
  h.innerHTML = '';
  [...txt].forEach((ch, i) => {
    const s = document.createElement('span');
    s.className = 'hero-title-char';
    s.textContent = ch === ' ' ? '\u00A0' : ch;
    s.style.animationDelay = `${i * 0.04}s`;
    h.appendChild(s);
  });
})();

// ─── Keepalive ───
setInterval(() => { if (socket.connected) socket.emit('ping-server'); }, 25000);

// ─── UI helpers ───
function toast(msg, dur) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), dur || 3000);
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function setStatus(text, type) {
  el.statusText.textContent = text;
  if (el.statusDot) el.statusDot.className = 'status-indicator' + (type ? ' ' + type : '');
}

function scrollDown() {
  requestAnimationFrame(() => { el.chatBox.scrollTop = el.chatBox.scrollHeight; });
}

// ─── Page navigation ───
function goLanding() {
  el.landingPage.classList.remove('hidden');
  el.chatPage.classList.add('hidden');
  connectionState = 'idle';
}

function goChat() {
  el.landingPage.classList.add('hidden');
  el.chatPage.classList.remove('hidden');
  connectionState = 'chat';
}

function goWaiting() {
  el.waitingSection.classList.remove('hidden');
  el.chatSection.classList.add('hidden');
  el.videoSection.classList.add('hidden');
  setStatus('Searching for stranger...', 'searching');
}

function goChatOnly() {
  el.waitingSection.classList.add('hidden');
  el.chatSection.classList.remove('hidden');
  el.videoSection.classList.add('hidden');
}

function goVideoChat() {
  el.waitingSection.classList.add('hidden');
  el.chatSection.classList.remove('hidden');
  el.videoSection.classList.remove('hidden');
}

function addSysMsg(text, anim) {
  const d = document.createElement('div');
  d.className = 'system-message' + (anim ? ' match-animation' : '');
  d.textContent = text;
  el.chatBox.appendChild(d);
  scrollDown();
}

function addMsg(text, side, ts) {
  const d = document.createElement('div');
  d.className = `message message-${side}`;
  d.innerHTML = `<div class="message-text">${text}</div><div class="message-time">${fmtTime(ts)}</div>`;
  el.chatBox.appendChild(d);
  scrollDown();
}

// ─── Camera/mic ───
async function startMedia() {
  if (localStream) return true;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    el.localVid.srcObject = localStream;
    el.localPlh.classList.add('hidden');
    return true;
  } catch (_) {
    console.warn('Media denied — text-only mode');
    return false;
  }
}

function stopMedia() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  el.localVid.srcObject = null;
  el.localPlh.classList.remove('hidden');
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  el.muteBtn.classList.toggle('active-off', isMuted);
  el.muteBtn.dataset.tooltip = isMuted ? 'Unmute' : 'Mute';
  el.muteBtn.innerHTML = isMuted
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
}

function toggleCam() {
  if (!localStream) return;
  isCameraOff = !isCameraOff;
  localStream.getVideoTracks().forEach(t => t.enabled = !isCameraOff);
  el.camBtn.classList.toggle('active-off', isCameraOff);
  el.camBtn.dataset.tooltip = isCameraOff ? 'Camera On' : 'Camera Off';
  el.localPlh.classList.toggle('hidden', !isCameraOff);
  el.camBtn.innerHTML = isCameraOff
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><line x1="1" y1="1" x2="23" y2="23"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
}

// ─── WebRTC ───
function mkPC() {
  if (peerConnection) peerConnection.close();
  try {
    peerConnection = new RTCPeerConnection(STUN);
  } catch (e) {
    console.error('PC failed:', e);
    return false;
  }
  peerConnection.onicecandidate = e => {
    if (e.candidate && currentRoomId) {
      socket.emit('ice-candidate', { roomId: currentRoomId, candidate: e.candidate });
    }
  };
  peerConnection.ontrack = e => {
    if (!remoteStream) {
      remoteStream = new MediaStream();
      el.remoteVid.srcObject = remoteStream;
    }
    remoteStream.addTrack(e.track);
    el.remotePlh.classList.add('hidden');
  };
  peerConnection.oniceconnectionstatechange = () => {
    const s = peerConnection.iceConnectionState;
    if (s === 'disconnected' || s === 'failed') {
      toast('Video connection lost — text still works');
    }
  };
  if (localStream) {
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
  }
  return true;
}

async function createOffer() {
  if (!mkPC()) return;
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('video-offer', { roomId: currentRoomId, offer });
  } catch (e) {
    console.error('Offer error:', e);
  }
}

async function onOffer(offer) {
  const hadStream = !!localStream;
  if (!hadStream) await startMedia();
  if (!mkPC()) return;
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const ans = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(ans);
    socket.emit('video-answer', { roomId: currentRoomId, answer: ans });
  } catch (e) {
    console.error('Answer error:', e);
    if (!hadStream) stopMedia();
  }
}

async function onAnswer(answer) {
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (e) {
    console.error('Answer set error:', e);
  }
}

async function onIce(candidate) {
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    // ignore — often harmless race conditions
  }
}

function cleanupWebRTC() {
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  if (remoteStream) { remoteStream.getTracks().forEach(t => t.stop()); remoteStream = null; }
  el.remoteVid.srcObject = null;
  el.remotePlh.classList.remove('hidden');
  el.localPlh.classList.remove('hidden');
  isMuted = false; isCameraOff = false;
  el.muteBtn.classList.remove('active-off');
  el.camBtn.classList.remove('active-off');
  el.muteBtn.dataset.tooltip = 'Mute';
  el.camBtn.dataset.tooltip = 'Camera';
  el.muteBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
  el.camBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
}

function fullCleanup() { cleanupWebRTC(); stopMedia(); }

// ─── Chat flow ───
function startChat() {
  goChat();
  goWaiting();
  el.waitTitle.textContent = 'Searching for Stranger...';
  el.waitSub.textContent = 'Please wait while we find someone for you';
  isSearching = true;
  socket.emit('join-queue');
}

function nextStranger() {
  fullCleanup();
  el.chatBox.innerHTML = '';
  el.typingDots.classList.add('hidden');
  goWaiting();
  el.waitTitle.textContent = 'Finding next stranger...';
  el.waitSub.textContent = 'Connecting you with someone new';
  isSearching = true;
  socket.emit('next-stranger', { roomId: currentRoomId });
  currentRoomId = null;
  partnerId = null;
}

function sendMsg() {
  const txt = el.msgInput.value.trim();
  if (!txt || !currentRoomId) return;
  socket.emit('send-message', { roomId: currentRoomId, message: txt });
  el.msgInput.value = '';
  el.msgInput.style.height = 'auto';
  el.sendBtn.disabled = true;
  clearTimeout(typingTimeout);
  typingTimeout = null;
  if (currentRoomId) socket.emit('stop-typing', { roomId: currentRoomId });
}

// ─── Socket events ───
socket.on('connect', () => console.log('connected'));

socket.on('online-count', n => {
  el.onlineLanding.textContent = n;
  el.onlineChat.textContent = n;
});

socket.on('waiting', () => {
  el.waitTitle.textContent = 'Searching for Stranger...';
  el.waitSub.textContent = 'Please wait while we find someone for you';
  setStatus('Searching for stranger...', 'searching');
});

socket.on('matched', async (data) => {
  currentRoomId = data.roomId;
  partnerId = data.partnerId;
  isSearching = false;
  setStatus('Stranger Connected', 'connected');
  goVideoChat();
  addSysMsg('Connected to a stranger! Say hello!', true);

  const mediaOk = await startMedia();
  if (!mediaOk) {
    goChatOnly();
    return;
  }
  // Only one peer creates the offer (deterministic: lower socket id)
  if (socket.id < partnerId) {
    await createOffer();
  }
});

socket.on('receive-message', (data) => {
  addMsg(data.message, data.from === 'me' ? 'right' : 'left', data.timestamp);
});

socket.on('stranger-typing', () => {
  el.typingDots.classList.remove('hidden');
  scrollDown();
});

socket.on('stranger-stop-typing', () => {
  el.typingDots.classList.add('hidden');
});

socket.on('stranger-disconnected', () => {
  addSysMsg('Stranger disconnected.');
  setStatus('Stranger Disconnected', 'disconnected');
  fullCleanup();
  goChatOnly();
  partnerId = null;
  currentRoomId = null;
});

socket.on('call-ended', () => {
  addSysMsg('Stranger ended the video call.');
  fullCleanup();
  goChatOnly();
});

socket.on('video-offer', (data) => {
  if (data.from !== partnerId) return;
  onOffer(data.offer);
});

socket.on('video-answer', (data) => {
  if (data.from !== partnerId) return;
  onAnswer(data.answer);
});

socket.on('ice-candidate', (data) => {
  if (data.from !== partnerId) return;
  onIce(data.candidate);
});

socket.on('error-msg', (data) => toast(data.message));

socket.on('disconnect', () => {
  toast('Connection lost. Reconnecting...');
  fullCleanup();
  goChatOnly();
});

// ─── DOM listeners ───
el.startChatBtn.addEventListener('click', startChat);

el.cancelBtn.addEventListener('click', () => {
  socket.emit('leave-queue');
  isSearching = false;
  goLanding();
});

el.nextBtn.addEventListener('click', nextStranger);

el.msgInput.addEventListener('input', () => {
  el.msgInput.style.height = 'auto';
  el.msgInput.style.height = Math.min(el.msgInput.scrollHeight, 100) + 'px';
  el.sendBtn.disabled = !el.msgInput.value.trim();
  if (currentRoomId) {
    socket.emit('typing', { roomId: currentRoomId });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      if (currentRoomId) socket.emit('stop-typing', { roomId: currentRoomId });
    }, 1000);
  }
});

el.msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (el.msgInput.value.trim()) sendMsg();
  }
});

el.sendBtn.addEventListener('click', sendMsg);
el.muteBtn.addEventListener('click', toggleMute);
el.camBtn.addEventListener('click', toggleCam);

window.addEventListener('popstate', () => {
  if (connectionState === 'chat' || isSearching) { nextStranger(); goLanding(); }
});
