import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { Action, Player } from '../shared/types.ts';
import { aiChooseAction, applyAction, createGame, newPlayer, serializeFor } from '../shared/engine.ts';
import type { GameState } from '../shared/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const isProd = process.env.NODE_ENV === 'production';

interface Member { id: string; name: string; connected: boolean; socketId: string | null; isAI: boolean }
interface Room {
  id: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  members: Map<string, Member>; // keyed by persistent playerId
  order: string[]; // seating order of playerIds
  game?: GameState;
}

const rooms = new Map<string, Room>();
const socketIndex = new Map<string, { roomId: string; playerId: string }>(); // socket.id -> location

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

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
  const t = setTimeout(() => {
    roomCleanup.delete(room.id);
    const r = rooms.get(room.id);
    if (r && !hasConnectedHuman(r)) { clearAITimer(r.id); rooms.delete(r.id); }
  }, ROOM_GRACE_MS);
  roomCleanup.set(room.id, t);
}
/** If it's an AI's turn, play one move after a short delay, then recurse for further AI turns. */
function maybeRunAI(room: Room) {
  if (!room.game || room.status !== 'playing' || aiTimers.has(room.id)) return;
  if (!room.game.players[room.game.current].isAI) return;
  if (!hasConnectedHuman(room)) return; // no one is watching — pause until a human (re)connects
  const timer = setTimeout(() => {
    aiTimers.delete(room.id);
    if (!room.game || room.status !== 'playing') return;
    const cur = room.game.players[room.game.current];
    if (!cur.isAI) return;
    let res;
    try { res = applyAction(room.game, cur.id, aiChooseAction(room.game)); }
    catch (e) { console.error('AI move threw:', e); return; }
    // Guard against an illegal AI move: stop (don't re-schedule) so we never spin forever.
    if (!res.ok) { console.error('AI produced an illegal move:', res.error); return; }
    if (room.game.status === 'finished') room.status = 'finished';
    broadcastRoom(room);
    maybeRunAI(room);
  }, 850);
  aiTimers.set(room.id, timer);
}

// ── Socket handlers ──────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join', ({ roomId, playerId, name }: { roomId: string; playerId: string; name: string }) => {
    roomId = String(roomId || '').toUpperCase().trim();
    name = String(name || '').slice(0, 16).trim() || 'Trainer';
    if (!roomId || !playerId) { emitError(socket.id, 'Missing room or player id.'); return; }

    let room = rooms.get(roomId);
    if (!room) {
      room = { id: roomId, hostId: playerId, status: 'lobby', members: new Map(), order: [] };
      rooms.set(roomId, room);
    }

    const existing = room.members.get(playerId);
    if (existing) {
      // Reconnect to an existing seat.
      existing.connected = true;
      existing.socketId = socket.id;
      existing.name = name;
    } else {
      if (room.status !== 'lobby') { emitError(socket.id, 'That game has already started.'); return; }
      if (room.order.length >= 4) { emitError(socket.id, 'Room is full (4 players max).'); return; }
      room.members.set(playerId, { id: playerId, name, connected: true, socketId: socket.id, isAI: false });
      room.order.push(playerId);
    }

    cancelRoomCleanup(roomId); // a human is present again
    socket.join(roomId);
    socketIndex.set(socket.id, { roomId, playerId });
    socket.emit('joined', { roomId, playerId, hostId: room.hostId });
    broadcastRoom(room);
    maybeRunAI(room); // resume AI if a human reconnected mid-game
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
    room.status = 'lobby';
    room.game = undefined;
    clearAITimer(room.id);
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    const loc = socketIndex.get(socket.id);
    if (!loc) return;
    socketIndex.delete(socket.id);
    const room = rooms.get(loc.roomId);
    if (!room) return;
    const m = room.members.get(loc.playerId);
    if (m && m.socketId === socket.id) { m.connected = false; m.socketId = null; }

    if (room.status === 'lobby') {
      // Drop disconnected humans from a lobby that hasn't started.
      room.members.delete(loc.playerId);
      room.order = room.order.filter((pid) => pid !== loc.playerId);
      const humans = room.order.filter((pid) => !room.members.get(pid)!.isAI);
      if (humans.length === 0) { clearAITimer(room.id); rooms.delete(room.id); return; }
      if (room.hostId === loc.playerId) room.hostId = humans[0];
    } else if (!hasConnectedHuman(room)) {
      // Game in progress/finished but everyone left — clean up after a grace period.
      scheduleRoomCleanup(room);
    }
    broadcastRoom(room);
  });
});

// ── Static client in production ──────────────────────────────────────────
if (isProd) {
  const dist = path.resolve(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

server.listen(PORT, () => {
  console.log(`\n  Splendor: Pokémon Edition server running on http://localhost:${PORT}`);
  if (!isProd) console.log('  (dev) open the Vite client at http://localhost:5173\n');
});
