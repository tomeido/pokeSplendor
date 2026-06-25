// Verifies control (rematch / return-to-lobby) transfers to a remaining player
// when the host disconnects — so nobody gets stuck. Requires the server running.
// Run: PORT=3001 npx tsx server/host-handoff.test.ts
import { io, type Socket } from 'socket.io-client';
import type { ClientState } from '../shared/engine.ts';

const URL = `http://localhost:${process.env.PORT || 3001}`;
const ROOM = ('HH' + (Date.now() % 1000000)).toUpperCase();
let failures = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗', m); failures++; } else console.log('  ✓', m); };

function mkClient(): Promise<{ sock: Socket; states: ClientState[]; errors: string[] }> {
  return new Promise((resolve) => {
    const sock = io(URL, { forceNew: true, transports: ['websocket', 'polling'] });
    const bag = { sock, states: [] as ClientState[], errors: [] as string[] };
    sock.on('state', (s: ClientState) => bag.states.push(s));
    sock.on('errorMsg', (e: any) => bag.errors.push(e.message));
    sock.on('connect', () => resolve(bag));
  });
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const last = <T,>(a: T[]) => a[a.length - 1];

async function main() {
  const a = await mkClient(); // host
  const b = await mkClient();
  a.sock.emit('join', { roomId: ROOM, playerId: 'HA', name: 'Host' });
  await wait(120);
  b.sock.emit('join', { roomId: ROOM, playerId: 'HB', name: 'Guest' });
  await wait(150);
  a.sock.emit('startGame');
  await wait(150);
  ok(!!last(a.states), 'game started');

  // While the host is connected, a non-host cannot rematch.
  b.errors.length = 0;
  b.sock.emit('rematch');
  await wait(150);
  ok(b.errors.some((e) => /host/i.test(e)), 'non-host blocked from rematch while host present');

  // Host leaves.
  a.sock.disconnect();
  await wait(250);

  // Now the remaining human may rematch (control transfers).
  b.errors.length = 0;
  const statesBefore = b.states.length;
  b.sock.emit('rematch');
  await wait(250);
  ok(b.errors.length === 0, 'no error when guest rematches after host left');
  ok(b.states.length > statesBefore, 'guest received a fresh game state');
  ok(last(b.states)?.turnCount === 0, 'rematch produced a brand-new game (turn 0)');

  b.sock.disconnect();
  await wait(60);
  console.log(failures ? `\n${failures} check(s) failed.` : '\n✓ Host-handoff works.');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
