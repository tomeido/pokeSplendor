// Verifies a human disconnecting ON THEIR TURN does not freeze the table:
// after the grace period the AI auto-plays the absent seat so the game continues.
// Spawns its own short-grace server. Run: npx tsx server/disconnect-turn.test.ts
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io, type Socket } from 'socket.io-client';
import type { ClientState } from '../shared/engine.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3098;
const URL = `http://localhost:${PORT}`;
let failures = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗', m); failures++; } else console.log('  ✓', m); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const last = <T,>(a: T[]) => a[a.length - 1];

function mkClient(): Promise<{ sock: Socket; states: ClientState[]; errors: string[] }> {
  return new Promise((resolve) => {
    const sock = io(URL, { forceNew: true, transports: ['websocket', 'polling'] });
    const bag = { sock, states: [] as ClientState[], errors: [] as string[] };
    sock.on('state', (s: ClientState) => bag.states.push(s));
    sock.on('errorMsg', (e: any) => bag.errors.push(e.message));
    sock.on('connect', () => resolve(bag));
  });
}

async function main() {
  const server = spawn('npx', ['tsx', path.join(__dirname, 'index.ts')], {
    env: { ...process.env, PORT: String(PORT), DISCONNECT_GRACE_MS: '400', NODE_ENV: 'development' },
    stdio: 'ignore', shell: process.platform === 'win32',
  });
  await wait(1800); // let the server boot

  try {
    const ROOM = 'DT' + (Date.now() % 100000);
    const a = await mkClient(); // host, plays first
    const b = await mkClient();
    a.sock.emit('join', { roomId: ROOM, playerId: 'DA', name: 'Alice' });
    await wait(120);
    b.sock.emit('join', { roomId: ROOM, playerId: 'DB', name: 'Bob' });
    await wait(150);
    a.sock.emit('startGame');
    await wait(200);

    ok(last(a.states)?.current === 0, "it is Alice's (the host's) turn");
    const turnsBefore = last(b.states)?.turnCount ?? 0;

    // Alice disconnects on her own turn. Bob is still connected → would freeze without the fix.
    a.sock.disconnect();
    await wait(250);
    ok((last(b.states)?.turnCount ?? 0) === turnsBefore, 'turn has not advanced yet (still within grace)');

    // After the grace, the AI should auto-play Alice's turn and the game continues.
    await wait(700);
    const s = last(b.states)!;
    ok(s.turnCount > turnsBefore, 'turn advanced after grace (table did not freeze)');
    ok(s.status === 'playing', 'game still in progress');
    // Bob should be the one disconnected... no: Bob is connected; the absent Alice shows offline.
    ok(s.players.find((p) => p.id === 'DA')?.connected === false, 'Alice shows as disconnected');

    b.sock.disconnect();
    await wait(60);
  } finally {
    server.kill();
  }
  console.log(failures ? `\n${failures} check(s) failed.` : '\n✓ Disconnect-on-turn no longer freezes the game.');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
