import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import type { Action, ChatMessage, Player } from '../shared/types.ts';
import { aiChooseAction, applyAction, createGame, newPlayer, serializeFor } from '../shared/engine.ts';
import type { GameState } from '../shared/types.ts';
import type { BrowserTransferResult, BrowserTransferTicket } from '../shared/browser-transfer.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const isProd = process.env.NODE_ENV === 'production';
// When served behind a reverse-proxy sub-path (e.g. /splendor), every URL the app
// exposes — static assets, the SPA fallback, and the Socket.IO endpoint — must live
// under it. Empty by default, so the app still serves from the root.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');

interface Member {
  id: string;
  name: string;
  connected: boolean;
  socketId: string | null;
  isAI: boolean;
  resumeKey?: string;
  transferToken?: string;
}
interface Room {
  id: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  members: Map<string, Member>; // keyed by persistent playerId
  order: string[]; // seating order of playerIds
  chat: ChatMessage[]; // recent chat lines (capped), replayed to (re)joiners
  game?: GameState;
}

const CHAT_HISTORY = 60; // lines kept per room and sent to a (re)joining client
const CHAT_MAXLEN = 300; // max characters per message
let chatSeq = 0; // makes message ids unique even within the same millisecond

const rooms = new Map<string, Room>();
const socketIndex = new Map<string, { roomId: string; playerId: string }>(); // socket.id -> location

// Only one ticket (including its retry record) is retained per seat. A claim ID
// stays private to the destination browser; the URL itself works only once.
const BROWSER_TRANSFER_TTL_MS = Math.max(100, Math.min(
  Number(process.env.BROWSER_TRANSFER_TTL_MS) || 5 * 60 * 1000, 5 * 60 * 1000,
));
interface BrowserTransfer {
  room: Room;
  member: Member;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  claimId?: string;
  resumeKey?: string;
}
const browserTransfers = new Map<string, BrowserTransfer>();

function forgetBrowserTransfer(member: Member) {
  if (!member.transferToken) return;
  const transfer = browserTransfers.get(member.transferToken);
  if (transfer) clearTimeout(transfer.timer);
  browserTransfers.delete(member.transferToken);
  member.transferToken = undefined;
}

function currentBrowserTransfer(member: Member): BrowserTransfer | undefined {
  const transfer = member.transferToken ? browserTransfers.get(member.transferToken) : undefined;
  return transfer && transfer.member === member && transfer.expiresAt > Date.now()
    && (!transfer.claimId || transfer.resumeKey === member.resumeKey) ? transfer : undefined;
}

// ── Visitor stats ───────────────────────────────────────────────────────────
// A simple hit counter, persisted to disk so it survives restarts. `pageViews`
// counts every app load; `visitors` counts distinct browsers (the client reports
// whether this is its first-ever visit, so we never store any per-user identifier).
interface Stats { pageViews: number; visitors: number }
const STATS_FILE = process.env.STATS_FILE || path.resolve(__dirname, '..', 'data', 'stats.json');

function loadStats(): Stats {
  try {
    const s = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    return { pageViews: Number(s.pageViews) || 0, visitors: Number(s.visitors) || 0 };
  } catch { return { pageViews: 0, visitors: 0 }; }
}
const stats = loadStats();

let statsSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveStats() {
  if (statsSaveTimer) return; // debounce bursts of visits into a single write
  statsSaveTimer = setTimeout(() => {
    statsSaveTimer = null;
    try {
      fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
      fs.writeFileSync(STATS_FILE, JSON.stringify(stats));
    } catch (e) { console.error('failed to save stats:', e); }
  }, 1000);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: `${BASE_PATH}/socket.io`, cors: { origin: '*' } });

// Read-only endpoint so the counts can be checked directly (must be registered
// before the SPA catch-all fallback below).
app.get(`${BASE_PATH}/api/stats`, (_req, res) => res.json(stats));

// ── Helpers ───────────────────────────────────────────────────────────────
function lobbyPayload(room: Room) {
  return {
    roomId: room.id,
    hostId: room.hostId,
    status: room.status,
    players: room.order.map((pid) => {
      const m = room.members.get(pid)!;
      return { id: m.id, name: m.name, connected: m.connected, isAI: m.isAI };
    }),
  };
}

function broadcastRoom(room: Room) {
  if (room.status === 'playing' || room.status === 'finished') {
    if (!room.game) return;
    // Sync live connection state into the game players so clients see who's online
    // (e.g. the host-disconnected handoff and the in-game "offline" indicator).
    for (const p of room.game.players) {
      const m = room.members.get(p.id);
      if (m) p.connected = m.connected;
    }
    for (const pid of room.order) {
      const m = room.members.get(pid)!;
      if (m.socketId) io.to(m.socketId).emit('state', serializeFor(room.game, pid));
    }
  } else {
    io.to(room.id).emit('lobby', lobbyPayload(room));
  }
}

function emitError(socketId: string, message: string) {
  io.to(socketId).emit('errorMsg', { message });
}

// ── Computer (AI) seats ───────────────────────────────────────────────────
const AI_NAMES = ['🤖 CPU-1', '🤖 CPU-2', '🤖 CPU-3'];
const aiTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearAITimer(roomId: string) {
  const t = aiTimers.get(roomId);
  if (t) { clearTimeout(t); aiTimers.delete(roomId); }
}
function hasConnectedHuman(room: Room): boolean {
  return room.order.some((pid) => { const m = room.members.get(pid)!; return !m.isAI && m.connected; });
}
/** Who may rematch / return to lobby: the host, or any connected human if the host has left. */
function canControlRoom(room: Room, playerId: string): boolean {
  if (playerId === room.hostId) return true;
  const host = room.members.get(room.hostId);
  const hostGone = !host || !host.connected;
  const m = room.members.get(playerId);
  return hostGone && !!m && !m.isAI && m.connected;
}
/** When the host has left and another player takes control, make them the new host. */
function promoteHostIfGone(room: Room, playerId: string) {
  const host = room.members.get(room.hostId);
  if (playerId !== room.hostId && (!host || !host.connected)) room.hostId = playerId;
}

// ── Room cleanup ──────────────────────────────────────────────────────────
// Abandoned in-progress/finished rooms are removed after a grace period so a
// refresh (brief disconnect) can still reconnect, but memory isn't leaked forever.
const ROOM_GRACE_MS = 2 * 60 * 1000;
const roomCleanup = new Map<string, ReturnType<typeof setTimeout>>();

function cancelRoomCleanup(roomId: string) {
  const t = roomCleanup.get(roomId);
  if (t) { clearTimeout(t); roomCleanup.delete(roomId); }
}
function scheduleRoomCleanup(room: Room) {
  if (roomCleanup.has(room.id) || hasConnectedHuman(room)) return;
  const transferExpiry = Math.max(0, ...Array.from(room.members.values(),
    (member) => currentBrowserTransfer(member)?.expiresAt ?? 0));
  const t = setTimeout(() => {
    roomCleanup.delete(room.id);
    const r = rooms.get(room.id);
    if (r === room && !hasConnectedHuman(r)) deleteRoom(r);
  }, Math.max(ROOM_GRACE_MS, transferExpiry - Date.now()));
  roomCleanup.set(room.id, t);
}

function deleteRoom(room: Room) {
  cancelRoomCleanup(room.id);
  clearAITimer(room.id);
  for (const member of room.members.values()) forgetBrowserTransfer(member);
  if (rooms.get(room.id) === room) rooms.delete(room.id);
}

function removeDisconnectedLobbyMember(room: Room, member: Member) {
  if (rooms.get(room.id) !== room || room.status !== 'lobby'
    || room.members.get(member.id) !== member || member.connected) return;
  forgetBrowserTransfer(member);
  room.members.delete(member.id);
  room.order = room.order.filter((pid) => pid !== member.id);
  const humans = room.order.filter((pid) => !room.members.get(pid)!.isAI);
  if (humans.length === 0) { deleteRoom(room); return; }
  if (room.hostId === member.id) room.hostId = humans[0];
  broadcastRoom(room);
}
// A disconnected human on their turn would otherwise freeze the table (AIs can't
// move — not their turn; other humans can't act — not their turn). After this grace
// the AI plays the absent player's turn so the game keeps going; if they reconnect
// in time the timer yields and they resume control.
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS) || 30 * 1000;

function isAbsentHumanTurn(room: Room): boolean {
  if (!room.game) return false;
  const cur = room.game.players[room.game.current];
  if (cur.isAI) return false;
  const m = room.members.get(cur.id);
  return !m || !m.connected;
}

/** Keep the turn moving: auto-play AI turns (short delay) and disconnected-human
 *  turns (after a grace period), then recurse for the next non-human-controlled turn. */
function maybeRunAI(room: Room) {
  if (!room.game || room.status !== 'playing' || aiTimers.has(room.id)) return;
  if (!hasConnectedHuman(room)) return; // no one is watching — pause until a human (re)connects
  const cur = room.game.players[room.game.current];
  const absentHuman = isAbsentHumanTurn(room);
  if (!cur.isAI && !absentHuman) return; // a connected human's turn — wait for them
  const delay = cur.isAI ? 850 : DISCONNECT_GRACE_MS;
  const timer = setTimeout(() => {
    aiTimers.delete(room.id);
    if (!room.game || room.status !== 'playing') return;
    const c = room.game.players[room.game.current];
    const m = room.members.get(c.id);
    if (!c.isAI && m && m.connected) return; // human reconnected in time — yield control back
    let res;
    try { res = applyAction(room.game, c.id, aiChooseAction(room.game)); }
    catch (e) { console.error('auto move threw:', e); return; }
    // Guard against an illegal move: stop (don't re-schedule) so we never spin forever.
    if (!res.ok) { console.error('auto move was illegal:', res.error); return; }
    if (room.game.status === 'finished') room.status = 'finished';
    broadcastRoom(room);
    maybeRunAI(room);
  }, delay);
  aiTimers.set(room.id, timer);
}

/** Attach exactly one socket to a seat, keeping turn, private cards and host ID. */
function bindMember(socket: Socket, room: Room, member: Member) {
  const previousSocketId = member.socketId;
  member.connected = true;
  member.socketId = socket.id;
  if (previousSocketId && previousSocketId !== socket.id) {
    // Revoke commands and room broadcasts before disconnect triggers its handler.
    socketIndex.delete(previousSocketId);
    const previousSocket = io.sockets.sockets.get(previousSocketId);
    previousSocket?.leave(room.id);
    previousSocket?.emit('sessionMoved');
    previousSocket?.disconnect(true);
  }
  cancelRoomCleanup(room.id);
  // A bystander's reconnect must not restart the current absent player's clock.
  if (room.game && room.status === 'playing' && room.game.players[room.game.current].id === member.id) {
    clearAITimer(room.id);
  }
  socket.join(room.id);
  socketIndex.set(socket.id, { roomId: room.id, playerId: member.id });
  socket.emit('joined', {
    roomId: room.id, playerId: member.id, hostId: room.hostId,
    name: member.name, ...(member.resumeKey ? { resumeKey: member.resumeKey } : {}),
  });
  socket.emit('chatHistory', room.chat);
  broadcastRoom(room);
  maybeRunAI(room);
}

// ── Socket handlers ──────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Send the current counts right away so the badge shows without waiting for a load event.
  socket.emit('stats', stats);
  // One page view per socket (guards against a flapping reconnect inflating the count).
  let counted = false;
  socket.on('pageview', ({ first }: { first?: boolean } = {}) => {
    if (counted) return;
    counted = true;
    stats.pageViews++;
    if (first) stats.visitors++;
    saveStats();
    io.emit('stats', stats);
  });

  socket.on('join', ({ roomId, playerId, name, resumeKey }: {
    roomId: string; playerId: string; name: string; resumeKey?: string;
  }) => {
    roomId = String(roomId || '').toUpperCase().trim();
    name = String(name || '').slice(0, 16).trim() || 'Trainer';
    if (!roomId || !playerId) { emitError(socket.id, 'Missing room or player id.'); return; }

    let room = rooms.get(roomId);
    if (!room) {
      room = { id: roomId, hostId: playerId, status: 'lobby', members: new Map(), order: [], chat: [] };
      rooms.set(roomId, room);
    }

    const existing = room.members.get(playerId);
    if (existing) {
      if (existing.resumeKey && existing.resumeKey !== resumeKey) {
        // A suspended source may have missed the notification sent at transfer.
        socket.emit('sessionMoved');
        emitError(socket.id, 'This seat has moved to another browser.');
        socket.disconnect(true);
        return;
      }
      // Reconnect to an existing seat.
      existing.name = name;
    } else {
      if (room.status !== 'lobby') { emitError(socket.id, 'That game has already started.'); return; }
      if (room.order.length >= 4) { emitError(socket.id, 'Room is full (4 players max).'); return; }
      room.members.set(playerId, { id: playerId, name, connected: true, socketId: socket.id, isAI: false });
      room.order.push(playerId);
    }

    bindMember(socket, room, room.members.get(playerId)!);
  });

  socket.on('createBrowserTransfer', (_payload: unknown, reply?: (result: BrowserTransferTicket) => void) => {
    if (typeof reply !== 'function') return;
    const loc = socketIndex.get(socket.id);
    const room = loc && rooms.get(loc.roomId);
    const member = room && loc && room.members.get(loc.playerId);
    if (!room || !member || member.isAI || !member.connected || member.socketId !== socket.id) {
      reply({ ok: false, error: 'not_joined' }); return;
    }
    forgetBrowserTransfer(member);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + BROWSER_TRANSFER_TTL_MS;
    const timer = setTimeout(() => {
      // A later ticket must never be invalidated by this one's expired timer.
      if (member.transferToken !== token) return;
      forgetBrowserTransfer(member);
      removeDisconnectedLobbyMember(room, member);
    }, BROWSER_TRANSFER_TTL_MS);
    browserTransfers.set(token, { room, member, expiresAt, timer });
    member.transferToken = token;
    reply({ ok: true, token, expiresAt });
  });

  socket.on('cancelBrowserTransfer', (_payload: unknown, reply?: () => void) => {
    const loc = socketIndex.get(socket.id);
    const room = loc && rooms.get(loc.roomId);
    const member = room && loc && room.members.get(loc.playerId);
    if (member?.socketId === socket.id) forgetBrowserTransfer(member);
    if (typeof reply === 'function') reply();
  });

  socket.on('resumeBrowserTransfer', (
    payload: { token?: unknown; claimId?: unknown } | null,
    reply?: (result: BrowserTransferResult) => void,
  ) => {
    if (typeof reply !== 'function') return;
    const token = payload?.token;
    const claimId = payload?.claimId;
    if (typeof token !== 'string' || token.length > 200
      || typeof claimId !== 'string' || claimId.length < 16 || claimId.length > 200) {
      reply({ ok: false, error: 'invalid_transfer' }); return;
    }
    const transfer = browserTransfers.get(token);
    if (!transfer || transfer.expiresAt <= Date.now()
      || rooms.get(transfer.room.id) !== transfer.room
      || transfer.room.members.get(transfer.member.id) !== transfer.member
      || transfer.member.transferToken !== token
      || (transfer.claimId && (transfer.claimId !== claimId || transfer.resumeKey !== transfer.member.resumeKey))) {
      reply({ ok: false, error: 'invalid_transfer' }); return;
    }
    const { room, member } = transfer;
    const loc = socketIndex.get(socket.id);
    if (loc && (loc.roomId !== room.id || loc.playerId !== member.id)) {
      reply({ ok: false, error: 'already_joined' }); return;
    }
    // Commit the one-time claim before attaching or replying. Only this browser's
    // private claim ID can retry a lost acknowledgement until the ticket expires.
    if (!transfer.claimId) {
      transfer.claimId = claimId;
      transfer.resumeKey = randomBytes(32).toString('base64url');
      member.resumeKey = transfer.resumeKey;
    }
    bindMember(socket, room, member);
    reply({
      ok: true, roomId: room.id, playerId: member.id,
      name: member.name, resumeKey: transfer.resumeKey!,
    });
  });

  socket.on('addAI', () => {
    const loc = socketIndex.get(socket.id);
    if (!loc) return;
    const room = rooms.get(loc.roomId);
    if (!room) return;
    if (loc.playerId !== room.hostId) { emitError(socket.id, 'Only the host can add a computer.'); return; }
    if (room.status !== 'lobby') { emitError(socket.id, 'Add computers before starting.'); return; }
    if (room.order.length >= 4) { emitError(socket.id, 'Room is full (4 players max).'); return; }
    const aiCount = room.order.filter((pid) => room.members.get(pid)!.isAI).length;
    const aiId = `ai_${room.id}_${aiCount + 1}_${Math.floor(Math.random() * 1e6)}`;
    const name = AI_NAMES[aiCount] ?? `🤖 CPU-${aiCount + 1}`;
    room.members.set(aiId, { id: aiId, name, connected: true, socketId: null, isAI: true });
    room.order.push(aiId);
    broadcastRoom(room);
  });

  socket.on('removeAI', () => {
    const loc = socketIndex.get(socket.id);
    if (!loc) return;
    const room = rooms.get(loc.roomId);
    if (!room) return;
    if (loc.playerId !== room.hostId) { emitError(socket.id, 'Only the host can remove a computer.'); return; }
    if (room.status !== 'lobby') return;
    for (let i = room.order.length - 1; i >= 0; i--) {
      const m = room.members.get(room.order[i])!;
      if (m.isAI) { room.members.delete(room.order[i]); room.order.splice(i, 1); break; }
    }
    broadcastRoom(room);
  });

  socket.on('startGame', () => {
    const loc = socketIndex.get(socket.id);
    if (!loc) return;
    const room = rooms.get(loc.roomId);
    if (!room) return;
    if (loc.playerId !== room.hostId) { emitError(socket.id, 'Only the host can start.'); return; }
    if (room.status === 'playing') { emitError(socket.id, 'Game already started.'); return; }
    if (room.order.length < 2) { emitError(socket.id, 'Need at least 2 players.'); return; }

    const players: Player[] = room.order.map((pid) => {
      const m = room.members.get(pid)!;
      return newPlayer(m.id, m.name, m.isAI);
    });
    room.game = createGame(room.id, players, room.hostId);
    room.status = 'playing';
    clearAITimer(room.id);
    broadcastRoom(room);
    maybeRunAI(room);
  });

  socket.on('action', ({ action }: { action: Action }) => {
    const loc = socketIndex.get(socket.id);
    if (!loc) return;
    const room = rooms.get(loc.roomId);
    if (!room || !room.game || room.status !== 'playing') return;
    const res = applyAction(room.game, loc.playerId, action);
    if (!res.ok) { emitError(socket.id, res.error); return; }
    if (room.game.status === 'finished') room.status = 'finished';
    broadcastRoom(room);
    maybeRunAI(room); // hand off to any AI players whose turn is next
  });

  socket.on('rematch', () => {
    const loc = socketIndex.get(socket.id);
    if (!loc) return;
    const room = rooms.get(loc.roomId);
    if (!room) return;
    if (!canControlRoom(room, loc.playerId)) { emitError(socket.id, 'Only the host can restart.'); return; }
    promoteHostIfGone(room, loc.playerId);
    const players: Player[] = room.order.map((pid) => {
      const m = room.members.get(pid)!;
      return newPlayer(m.id, m.name, m.isAI);
    });
    room.game = createGame(room.id, players, room.hostId);
    room.status = 'playing';
    clearAITimer(room.id);
    broadcastRoom(room);
    maybeRunAI(room);
  });

  socket.on('returnToLobby', () => {
    const loc = socketIndex.get(socket.id);
    if (!loc) return;
    const room = rooms.get(loc.roomId);
    if (!room) return;
    if (!canControlRoom(room, loc.playerId)) { emitError(socket.id, 'Only the host can do that.'); return; }
    promoteHostIfGone(room, loc.playerId);
    room.status = 'lobby';
    room.game = undefined;
    clearAITimer(room.id);
    broadcastRoom(room);
  });

  // ── Chat ──────────────────────────────────────────────────────────────
  // A short flood guard: drop messages sent faster than this from one socket.
  let lastChatAt = 0;
  socket.on('chat', ({ text }: { text?: string } = {}) => {
    const loc = socketIndex.get(socket.id);
    if (!loc) return;
    const room = rooms.get(loc.roomId);
    if (!room) return;
    const member = room.members.get(loc.playerId);
    if (!member) return;
    // Collapse whitespace (so newlines can't break the layout) and cap the length.
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAXLEN);
    if (!clean) return;
    const now = Date.now();
    if (now - lastChatAt < 400) return;
    lastChatAt = now;
    const msg: ChatMessage = {
      id: `m${now.toString(36)}${(chatSeq++).toString(36)}`,
      playerId: member.id, name: member.name, text: clean, ts: now,
    };
    room.chat.push(msg);
    if (room.chat.length > CHAT_HISTORY) room.chat.shift();
    io.to(room.id).emit('chatMsg', msg);
  });

  socket.on('disconnect', () => {
    const loc = socketIndex.get(socket.id);
    if (!loc) return;
    socketIndex.delete(socket.id);
    const room = rooms.get(loc.roomId);
    if (!room) return;
    const m = room.members.get(loc.playerId);
    if (!m || m.socketId !== socket.id) return;
    m.connected = false;
    m.socketId = null;

    if (room.status === 'lobby') {
      // Switching browsers may close Kakao before Safari connects. Reserve this
      // lobby seat (and its host role) until the outstanding transfer expires.
      if (!currentBrowserTransfer(m)) { removeDisconnectedLobbyMember(room, m); return; }
    } else if (!hasConnectedHuman(room)) {
      // Game in progress/finished but everyone left — clean up after a grace period.
      scheduleRoomCleanup(room);
    }
    broadcastRoom(room);
    // If the dropped player was the active seat, arm the grace timer so the table
    // doesn't freeze (the AI takes over their turn if they don't return in time).
    maybeRunAI(room);
  });
});

// ── Static client in production ──────────────────────────────────────────
if (isProd) {
  const dist = path.resolve(__dirname, '..', 'dist');
  app.use(BASE_PATH || '/', express.static(dist));
  // SPA fallback for anything under the base path, plus the bare base itself
  // (assets are referenced absolutely, so the bare path renders fine).
  app.get(`${BASE_PATH}/*`, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  if (BASE_PATH) app.get(BASE_PATH, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

server.listen(PORT, () => {
  console.log(`\n  Splendor: Pokémon Edition server running on http://localhost:${PORT}`);
  if (!isProd) console.log('  (dev) open the Vite client at http://localhost:5173\n');
});
