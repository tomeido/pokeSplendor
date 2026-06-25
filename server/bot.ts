// A simple bot player for manual/visual testing.
// Usage: ROOM=ABCD PID=bot1 NAME=Misty npx tsx server/bot.ts
import { io } from 'socket.io-client';
import type { ClientState } from '../shared/engine.ts';
import { GEM_TYPES, type GemType, type TokenType } from '../shared/types.ts';

const URL = `http://localhost:${process.env.PORT || 3001}`;
const ROOM = (process.env.ROOM || 'TEST').toUpperCase();
const PID = process.env.PID || 'bot1';
const NAME = process.env.NAME || 'Brock';

const sock = io(URL, { transports: ['websocket', 'polling'] });
let acting = false;

sock.on('connect', () => {
  console.log(`[bot ${NAME}] connected, joining ${ROOM}`);
  sock.emit('join', { roomId: ROOM, playerId: PID, name: NAME });
});
sock.on('errorMsg', (e: any) => console.log(`[bot ${NAME}] error:`, e.message));

sock.on('state', (s: ClientState) => {
  if (s.status !== 'playing') return;
  const me = s.players[s.yourIndex];
  if (s.current !== s.yourIndex || !me) return;
  if (acting) return;
  acting = true;
  setTimeout(() => { acting = false; takeTurn(s); }, 700);
});

function takeTurn(s: ClientState) {
  const me = s.players[s.yourIndex];

  if (s.pendingDiscard > 0) {
    const tokens: Partial<Record<TokenType, number>> = {};
    let need = s.pendingDiscard;
    for (const t of [...GEM_TYPES, 'gold'] as TokenType[]) {
      while (need > 0 && (me.tokens[t] - (tokens[t] || 0)) > 0) { tokens[t] = (tokens[t] || 0) + 1; need--; }
    }
    return sock.emit('action', { action: { type: 'DISCARD', tokens } });
  }
  if (s.pendingNobles.length > 0) {
    return sock.emit('action', { action: { type: 'CHOOSE_NOBLE', nobleId: s.pendingNobles[0].id } });
  }

  // Prefer buying any affordable card.
  for (const tier of [1, 2, 3] as const) {
    for (const c of s.board[tier]) {
      if (c && affordable(me, c.cost, me.bonuses, me.tokens.gold)) {
        return sock.emit('action', { action: { type: 'BUY', cardId: c.id } });
      }
    }
  }
  // Otherwise take 2 of a plentiful gem.
  const two = GEM_TYPES.find((g) => s.bank[g] >= 4);
  if (two) return sock.emit('action', { action: { type: 'TAKE_TWO', gem: two } });
  // Otherwise take up to 3 different.
  const three = GEM_TYPES.filter((g) => s.bank[g] > 0).slice(0, 3);
  if (three.length > 0) return sock.emit('action', { action: { type: 'TAKE_THREE', gems: three } });
  // Last resort: reserve, or pass if genuinely stuck.
  const card = s.board[1].find(Boolean);
  if (me.reservedCount < 3 && card) return sock.emit('action', { action: { type: 'RESERVE', cardId: card.id } });
  if (s.currentNoMoves) return sock.emit('action', { action: { type: 'PASS' } });
}

function affordable(me: any, cost: Record<GemType, number>, bonuses: Record<GemType, number>, gold: number) {
  let need = 0;
  for (const g of GEM_TYPES) {
    const c = Math.max(0, cost[g] - bonuses[g]);
    need += c - Math.min(c, me.tokens[g]);
  }
  return need <= gold;
}

process.on('SIGINT', () => { sock.disconnect(); process.exit(0); });
