// Live socket integration test for chat. Requires the server running on PORT (default 3001).
// Run with: npx tsx server/chat.test.ts
import { io, type Socket } from 'socket.io-client';
import type { ChatMessage } from '../shared/types.ts';

const URL = `http://localhost:${process.env.PORT || 3001}`;
const ROOM = ('CT' + (Date.now() % 1000000)).toUpperCase();
let failures = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error('  ✗', m); failures++; } else console.log('  ✓', m); };

function mkClient(): Promise<{ sock: Socket; msgs: ChatMessage[]; history: ChatMessage[][] }> {
  return new Promise((resolve) => {
    const sock = io(URL, { forceNew: true, transports: ['websocket', 'polling'] });
    const bag = { sock, msgs: [] as ChatMessage[], history: [] as ChatMessage[][] };
    sock.on('chatMsg', (m: ChatMessage) => bag.msgs.push(m));
    sock.on('chatHistory', (h: ChatMessage[]) => bag.history.push(h));
    sock.on('connect', () => resolve(bag));
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const last = <T,>(a: T[]) => a[a.length - 1];

async function main() {
  const a = await mkClient();
  const b = await mkClient();

  a.sock.emit('join', { roomId: ROOM, playerId: 'A', name: 'Ash' });
  await wait(120);
  b.sock.emit('join', { roomId: ROOM, playerId: 'B', name: 'Misty' });
  await wait(150);

  // A speaks; both A and B should receive the broadcast.
  a.sock.emit('chat', { text: 'hello there' });
  await wait(150);
  ok(last(a.msgs)?.text === 'hello there', 'sender receives their own message (echo)');
  ok(last(b.msgs)?.text === 'hello there', 'other player receives the message');
  ok(last(b.msgs)?.name === 'Ash', 'message attributed to the sender name');
  ok(last(b.msgs)?.playerId === 'A', 'message carries the sender playerId');

  // Empty / whitespace-only messages are dropped (and don't consume the flood guard).
  const beforeEmpty = b.msgs.length;
  a.sock.emit('chat', { text: '   ' });
  await wait(450); // also clears the 400ms flood window before the next real message
  ok(b.msgs.length === beforeEmpty, 'blank message is ignored');

  // Overlong messages are truncated to 300 chars.
  a.sock.emit('chat', { text: 'x'.repeat(500) });
  await wait(150);
  ok(last(b.msgs)?.text.length === 300, 'overlong message truncated to 300 chars');

  // Flood guard: a burst from one socket is rate-limited.
  const beforeFlood = b.msgs.length;
  for (let i = 0; i < 5; i++) a.sock.emit('chat', { text: `spam ${i}` });
  await wait(250);
  ok(b.msgs.length - beforeFlood < 5, 'rapid burst is rate-limited (not all delivered)');

  // A late joiner receives chat history.
  const c = await mkClient();
  c.sock.emit('join', { roomId: ROOM, playerId: 'C', name: 'Brock' });
  await wait(200);
  ok(!!last(c.history), 'joiner receives chat history');
  ok(last(c.history)!.some((m) => m.text === 'hello there'), 'history contains earlier messages');

  // A message before joining a room is ignored (no crash, no delivery).
  const d = await mkClient();
  d.sock.emit('chat', { text: 'orphan' });
  await wait(120);
  ok(d.msgs.length === 0, 'chat before joining a room is a no-op');

  a.sock.disconnect(); b.sock.disconnect(); c.sock.disconnect(); d.sock.disconnect();
  await wait(60);
  console.log(failures ? `\n${failures} chat check(s) failed.` : '\n✓ All chat checks passed.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
