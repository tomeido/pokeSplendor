// Live socket integration test. Requires the server running on PORT (default 3001).
// Run with: npx tsx server/integration.test.ts
import { io, type Socket } from 'socket.io-client';
import type { ClientState } from '../shared/engine.ts';

const URL = `http://localhost:${process.env.PORT || 3001}`;
const ROOM = 'ITEST';
let failures = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗', m); failures++; } else console.log('  ✓', m); };

function mkClient(name: string): Promise<{ sock: Socket; states: ClientState[]; lobbies: any[]; errors: string[] }> {
  return new Promise((resolve) => {
    const sock = io(URL, { forceNew: true, transports: ['websocket', 'polling'] });
    const bag = { sock, states: [] as ClientState[], lobbies: [] as any[], errors: [] as string[] };
    sock.on('state', (s: ClientState) => bag.states.push(s));
    sock.on('lobby', (l: any) => bag.lobbies.push(l));
    sock.on('errorMsg', (e: any) => bag.errors.push(e.message));
    sock.on('connect', () => resolve(bag));
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const last = <T,>(a: T[]) => a[a.length - 1];

async function main() {
  const a = await mkClient('Ash');
  const b = await mkClient('Misty');

  a.sock.emit('join', { roomId: ROOM, playerId: 'A', name: 'Ash' });
  await wait(120);
  b.sock.emit('join', { roomId: ROOM, playerId: 'B', name: 'Misty' });
  await wait(150);

  ok(last(a.lobbies)?.players.length === 2, 'both players appear in lobby');
  ok(last(a.lobbies)?.hostId === 'A', 'first joiner is host');

  // Non-host cannot start.
  b.sock.emit('startGame');
  await wait(120);
  ok(b.errors.some((e) => /host/i.test(e)), 'non-host blocked from starting');

  a.sock.emit('startGame');
  await wait(150);
  ok(!!last(a.states), 'host received game state');
  ok(last(a.states)?.players.length === 2, 'game state has 2 players');
  ok(last(a.states)?.current === 0, 'player A (index 0) starts');

  // It's A's turn. B acting should error.
  b.sock.emit('action', { action: { type: 'TAKE_TWO', gem: 'red' } });
  await wait(120);
  ok(b.errors.some((e) => /your turn/i.test(e)), "B blocked when it's not their turn");

  // A takes 3 different gems.
  const bankBefore = last(a.states)!.bank.white;
  a.sock.emit('action', { action: { type: 'TAKE_THREE', gems: ['white', 'blue', 'green'] } });
  await wait(150);
  const sA = last(a.states)!;
  ok(sA.bank.white === bankBefore - 1, 'bank decremented after take');
  ok(sA.current === 1, 'turn advanced to B');
  // Both clients should have a fresh state broadcast.
  ok(last(b.states)?.current === 1, 'B also received the updated turn');

  // B reserves a card → gains gold.
  const cardId = last(b.states)!.board[1][0]!.id;
  b.sock.emit('action', { action: { type: 'RESERVE', cardId } });
  await wait(150);
  const bSelf = last(b.states)!.players.find((p) => p.isYou)!;
  ok(bSelf.tokens.gold === 1, 'B gained a wild token from reserving');
  ok(bSelf.reservedCount === 1, 'B has 1 reserved card');
  // A must not see B's reserved card identity.
  const bFromA = last(a.states)!.players.find((p) => p.id === 'B')!;
  ok((bFromA.reserved[0] as any)?.hidden === true, "A cannot see B's reserved card");

  // Reconnect test: drop A, rejoin with same id, expect to resume.
  a.sock.disconnect();
  await wait(120);
  const a2 = await mkClient('Ash');
  a2.sock.emit('join', { roomId: ROOM, playerId: 'A', name: 'Ash' });
  await wait(180);
  ok(!!last(a2.states), 'reconnected player A received current game state');
  ok(last(a2.states)?.turnCount === sA.turnCount + 1, 'resumed at the correct turn');

  a2.sock.disconnect();
  b.sock.disconnect();
  await wait(60);
  console.log(failures ? `\n${failures} integration check(s) failed.` : '\n✓ All integration checks passed.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
