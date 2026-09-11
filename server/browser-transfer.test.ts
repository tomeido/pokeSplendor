// Standalone browser-transfer regression test. Starts and stops its own server.
// Run: node --import tsx server/browser-transfer.test.ts
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io, type Socket } from 'socket.io-client';
import { payment, type ClientState } from '../shared/engine.ts';
import { GEM_TYPES, TOKEN_TYPES, type Action, type Card, type ChatMessage, type Player, type TokenPool } from '../shared/types.ts';

type Lobby = { roomId: string; hostId: string; players: { id: string; connected: boolean }[] };
type Joined = { roomId: string; playerId: string; name?: string; resumeKey?: string; hostId: string };
type Created = { ok: true; token: string; expiresAt: number } | { ok: false; error: string };
type Resumed = { ok: true; roomId: string; playerId: string; name: string; resumeKey: string } | { ok: false; error: string };
type Client = {
  socket: Socket; states: ClientState[]; lobbies: Lobby[]; joined: Joined[];
  history: ChatMessage[][]; messages: ChatMessage[]; errors: string[]; moved: unknown[];
};

const root = fileURLToPath(new URL('..', import.meta.url));
const clients: Client[] = [];
const last = <T,>(items: T[]): T => {
  assert.ok(items.length, 'expected an event payload');
  return items[items.length - 1];
};
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, description: string, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert.ok(Date.now() < deadline, `timed out: ${description}`);
    await delay(10);
  }
}

async function unusedPort(): Promise<number> {
  const listener = net.createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function connect(url: string): Promise<Client> {
  const socket = io(url, { forceNew: true, autoConnect: false, reconnection: false, transports: ['websocket'] });
  const client: Client = { socket, states: [], lobbies: [], joined: [], history: [], messages: [], errors: [], moved: [] };
  clients.push(client);
  socket.on('state', (value) => client.states.push(value));
  socket.on('lobby', (value) => client.lobbies.push(value));
  socket.on('joined', (value) => client.joined.push(value));
  socket.on('chatHistory', (value) => client.history.push(value));
  socket.on('chatMsg', (value) => client.messages.push(value));
  socket.on('errorMsg', (value) => client.errors.push(value.message));
  socket.on('sessionMoved', (value) => client.moved.push(value));
  socket.connect();
  await until(() => socket.connected, 'socket connection');
  return client;
}

async function join(client: Client, roomId: string, playerId: string, name: string, resumeKey?: string) {
  const before = client.joined.length;
  client.socket.emit('join', { roomId, playerId, name, resumeKey });
  await until(() => client.joined.length > before, `${playerId} joins ${roomId}`);
  return last(client.joined);
}

async function request<T>(client: Client, event: string, payload: object): Promise<T> {
  if (!client.socket.connected) {
    client.socket.connect();
    await until(() => client.socket.connected, 'unjoined socket reconnect');
  }
  return new Promise<T>((resolve, reject) => {
    client.socket.timeout(3000).emit(event, payload, (error: Error | null, response: T) => {
      if (error) reject(new Error(`${event} acknowledgement timed out`, { cause: error }));
      else resolve(response);
    });
  });
}

async function mint(client: Client) {
  const result = await request<Created>(client, 'createBrowserTransfer', {});
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.ok(result.token.length >= 24, 'handoff token is unguessable');
  assert.ok(result.expiresAt > Date.now(), 'handoff has a future expiry');
  return result;
}

async function resume(client: Client, token: string, claimId: string) {
  const result = await request<Resumed>(client, 'resumeBrowserTransfer', { token, claimId });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.ok(result.resumeKey.length >= 24, 'destination receives a new private reconnect key');
  return result;
}

async function action(client: Client, value: Action) {
  const count = client.states.length;
  const errors = client.errors.length;
  client.socket.emit('action', { action: value });
  await until(() => client.states.length > count || client.errors.length > errors, `action ${value.type}`);
  assert.equal(client.errors.length, errors, last(client.errors.length ? client.errors : ['']));
}

function self(client: Client): Player {
  return last(client.states).players.find((player) => player.isYou)! as Player;
}

// Advance a real two-human game using legal actions, including a purchased card,
// a private reservation, and token holdings before exercising the browser move.
async function prepareGame(host: Client, guest: Client) {
  host.socket.emit('startGame');
  await until(() => host.states.length > 0 && guest.states.length > 0, 'game start');
  const target = last(host.states).board[1].filter((card): card is Card => !!card)
    .sort((a, b) => Object.values(a.cost).reduce((x, y) => x + y, 0) - Object.values(b.cost).reduce((x, y) => x + y, 0))[0];
  await action(host, { type: 'RESERVE', cardId: target.id });

  for (let step = 0; step < 40; step++) {
    const state = last(host.states);
    const owner = state.players[state.current].id === self(host).id ? host : guest;
    const player = self(owner);
    if (state.pendingDiscard) {
      let remaining = state.pendingDiscard;
      const tokens: Partial<TokenPool> = {};
      for (const gem of TOKEN_TYPES) {
        tokens[gem] = Math.min(remaining, player.tokens[gem]);
        remaining -= tokens[gem]!;
      }
      await action(owner, { type: 'DISCARD', tokens });
    } else if (owner === host && player.purchased.length && player.reserved.length) {
      assert.ok(TOKEN_TYPES.some((gem) => player.tokens[gem] > 0));
      return;
    } else if (owner === host && player.purchased.length) {
      await action(host, { type: 'RESERVE', deckTier: 2 });
    } else if (owner === host && payment(player, target).affordable) {
      await action(host, { type: 'BUY', cardId: target.id });
    } else if (owner === guest && player.reserved.length < 3) {
      await action(guest, { type: 'RESERVE', deckTier: 3 });
    } else {
      const deficit = (gem: typeof GEM_TYPES[number]) => Math.max(0, target.cost[gem] - self(host).tokens[gem]);
      const available = GEM_TYPES.filter((gem) => state.bank[gem] > 0)
        .sort((a, b) => owner === host ? deficit(b) - deficit(a) : deficit(a) - deficit(b));
      const double = owner === host && available.find((gem) => state.bank[gem] >= 4 && deficit(gem) >= 2);
      if (double) await action(owner, { type: 'TAKE_TWO', gem: double });
      else {
        assert.ok(available.length, 'setup must have a legal gem action');
        await action(owner, { type: 'TAKE_THREE', gems: available.slice(0, 3) });
      }
    }
  }
  assert.fail('could not prepare purchased/reserved card holdings within 40 actions');
}

async function expectJoinRejected(client: Client, roomId: string, playerId: string, resumeKey?: string) {
  if (!client.socket.connected) {
    client.socket.connect();
    await until(() => client.socket.connected, 'join-attempt socket connection');
  }
  const errors = client.errors.length;
  const joined = client.joined.length;
  client.socket.emit('join', { roomId, playerId, name: 'Unauthorized', resumeKey });
  await until(() => client.errors.length > errors, 'unauthorized join rejection');
  assert.equal(client.joined.length, joined, 'unauthorized join did not attach a seat');
}

async function activeGameTransfer(url: string) {
  const host = await connect(url);
  const guest = await connect(url);
  await join(host, 'TRANSFERGAME', 'host-id', '지우');
  await join(guest, 'TRANSFERGAME', 'guest-id', '이슬');
  await prepareGame(host, guest);
  host.socket.emit('chat', { text: '사파리에서도 이 대화와 내 카드를 이어서 봐야 해요.' });
  await until(() => guest.messages.length === 1, 'chat before transfer');
  const before = last(host.states);
  assert.ok(self(host).purchased.length > 0 && self(host).reserved.length > 0);
  assert.equal(before.players[before.current].id, 'host-id', 'host owns the active turn');

  const token = await mint(host);
  const claimId = 'destination-claim-secret-00000001';
  const destination = await connect(url);
  const moved = await resume(destination, token.token, claimId);
  await until(() => destination.states.length > 0 && host.moved.length === 1 && !host.socket.connected, 'destination joined and source evicted');
  assert.equal(moved.playerId, 'host-id');
  assert.equal(moved.roomId, 'TRANSFERGAME');
  assert.equal(moved.name, '지우');
  assert.equal(last(destination.joined).resumeKey, moved.resumeKey);
  assert.equal(last(destination.joined).hostId, 'host-id');
  assert.deepEqual(last(destination.states), before, 'all game state and private cards survive without advancing the turn');
  assert.deepEqual(last(destination.history), guest.messages, 'chat history survives the browser move');
  assert.equal(JSON.stringify(last(guest.states)).includes(moved.resumeKey), false, 'private reconnect key is not broadcast to other players');
  assert.deepEqual(await resume(destination, token.token, claimId), moved, 'same socket can retry a lost acknowledgement');

  const replay = await connect(url);
  assert.deepEqual(await request(replay, 'resumeBrowserTransfer', { token: token.token, claimId: 'different-claim-secret-00000002' }),
    { ok: false, error: 'invalid_transfer' }, 'another claimant cannot replay a redeemed token');
  await expectJoinRejected(replay, 'TRANSFERGAME', 'new-invited-player');
  await expectJoinRejected(replay, 'TRANSFERGAME', 'host-id');
  await expectJoinRejected(replay, 'TRANSFERGAME', 'host-id', 'wrong-reconnect-secret');
  replay.socket.emit('action', { action: { type: 'RESERVE', deckTier: 1 } });
  replay.socket.emit('chat', { text: 'must not enter room history' });
  assert.deepEqual(await request(replay, 'createBrowserTransfer', {}), { ok: false, error: 'not_joined' });
  assert.deepEqual(last(destination.states), before, 'rejected sockets cannot act on the game');

  host.socket.connect();
  await until(() => host.socket.connected, 'source browser reconnects after eviction');
  await expectJoinRejected(host, 'TRANSFERGAME', 'host-id');
  assert.equal(host.joined.length, 1, 'old source cannot silently reclaim its previous seat');

  // Losing the first acknowledgement must not strand a seat: the original
  // browser-local claim secret can recover its result after a reconnect.
  destination.socket.disconnect();
  const retry = await connect(url);
  const recovered = await resume(retry, token.token, claimId);
  await until(() => retry.states.length > 0, 'lost-ack retry state');
  assert.deepEqual(recovered, moved, 'same claim recovers the original reconnect key');
  assert.deepEqual(last(retry.states), before, 'retry restores the same game');
  assert.deepEqual(last(retry.history), guest.messages, 'unjoined attacker did not add chat');

  retry.socket.disconnect();
  const reconnected = await connect(url);
  await join(reconnected, 'TRANSFERGAME', 'host-id', '지우', moved.resumeKey);
  await until(() => reconnected.states.length > 0, 'normal private-key reconnect');
  assert.deepEqual(last(reconnected.states), before, 'normal refresh with private key resumes the seat');

  // A second handoff invalidates both the earlier token and reconnect key.
  const nextToken = await mint(reconnected);
  const finalDestination = await connect(url);
  const next = await resume(finalDestination, nextToken.token, 'destination-claim-secret-00000003');
  assert.notEqual(next.resumeKey, moved.resumeKey, 'each browser move rotates the private key');
  await expectJoinRejected(replay, 'TRANSFERGAME', 'host-id', moved.resumeKey);
  assert.deepEqual(await request(replay, 'resumeBrowserTransfer', { token: token.token, claimId }), { ok: false, error: 'invalid_transfer' });
  const guestErrors = guest.errors.length;
  guest.socket.emit('returnToLobby');
  await until(() => guest.errors.length > guestErrors, 'guest remains unable to control the connected host room');
  finalDestination.socket.emit('returnToLobby');
  await until(() => finalDestination.lobbies.length > 0, 'transferred host keeps room control');
  assert.equal(last(finalDestination.lobbies).hostId, 'host-id');
  assert.deepEqual(last(finalDestination.lobbies).players.map((player) => player.id), ['host-id', 'guest-id']);
  console.log('✓ Active host transfer preserves cards, tokens, turn, host and chat; claims and reconnect keys prevent seat takeover.');
}

async function lobbyAndInvalidTransfers(url: string) {
  const stranger = await connect(url);
  assert.deepEqual(await request(stranger, 'createBrowserTransfer', {}), { ok: false, error: 'not_joined' });
  assert.deepEqual(await request(stranger, 'resumeBrowserTransfer', { token: 'not-a-real-token', claimId: 'invalid-token-claim-secret' }),
    { ok: false, error: 'invalid_transfer' });

  const host = await connect(url);
  const guest = await connect(url);
  await join(host, 'TRANSFERLOBBY', 'lobby-host', '웅');
  await join(guest, 'TRANSFERLOBBY', 'lobby-guest', '봄이');
  const token = await mint(host);
  assert.deepEqual(await request(guest, 'resumeBrowserTransfer', { token: token.token, claimId: 'already-joined-claim-secret' }),
    { ok: false, error: 'already_joined' });
  host.socket.disconnect();
  await until(() => last(guest.lobbies).players.some((player) => player.id === 'lobby-host' && !player.connected), 'pending handoff retains disconnected lobby host');
  assert.equal(last(guest.lobbies).hostId, 'lobby-host', 'pending handoff preserves host');
  await resume(stranger, token.token, 'lobby-destination-claim-secret');
  await until(() => stranger.lobbies.length > 0, 'lobby destination receives members');
  assert.deepEqual(last(stranger.lobbies).players.map((player) => player.id), ['lobby-host', 'lobby-guest']);
  assert.ok(last(stranger.lobbies).players.every((player) => player.connected));
  assert.equal(last(stranger.lobbies).hostId, 'lobby-host');

  const expired = await mint(stranger);
  const before = last(guest.lobbies);
  await delay(Math.max(0, expired.expiresAt - Date.now()) + 30);
  const late = await connect(url);
  assert.deepEqual(await request(late, 'resumeBrowserTransfer', { token: expired.token, claimId: 'expired-claim-secret-0001' }),
    { ok: false, error: 'invalid_transfer' });
  assert.equal(late.joined.length, 0);
  assert.deepEqual(last(guest.lobbies), before, 'expired token cannot change room membership');
  assert.equal(stranger.socket.connected, true, 'invalid redemption does not evict the owner');

  const lone = await connect(url);
  await join(lone, 'TRANSFERLONE', 'solo-host', '레드');
  const loneToken = await mint(lone);
  lone.socket.disconnect();
  await resume(late, loneToken.token, 'single-host-claim-secret-0001');
  await until(() => late.lobbies.length > 0, 'single-player lobby survives closing source browser');
  assert.deepEqual(last(late.lobbies).players.map((player) => player.id), ['solo-host']);
  assert.equal(last(late.lobbies).hostId, 'solo-host');
  console.log('✓ Lobby handoff survives source close; invalid, expired and already-joined claims cannot mutate a room.');
}

async function explicitLobbyLeave(url: string) {
  const host = await connect(url);
  await join(host, 'TRANSFERCANCEL', 'leaving-host', '레드');
  const token = await mint(host);
  await request<void>(host, 'cancelBrowserTransfer', {});
  host.socket.disconnect();

  const newcomer = await connect(url);
  await join(newcomer, 'TRANSFERCANCEL', 'new-host', '블루');
  await until(() => newcomer.lobbies.length > 0, 'new lobby after explicit leave');
  assert.deepEqual(last(newcomer.lobbies).players.map((player) => player.id), ['new-host'], 'cancelled handoff does not retain the departing seat');
  assert.equal(last(newcomer.lobbies).hostId, 'new-host', 'new player owns the recreated lobby');
  assert.deepEqual(await request(newcomer, 'resumeBrowserTransfer', { token: token.token, claimId: 'cancelled-token-claim-secret' }),
    { ok: false, error: 'invalid_transfer' }, 'explicitly cancelled ticket cannot reclaim a seat');
  console.log('✓ Explicit lobby leave cancels pending transfer before disconnect and releases the host seat.');
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 1000);
  try { await exited; } finally { clearTimeout(force); }
}

async function main() {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'splendor-browser-transfer-'));
  let child: ChildProcess | undefined;
  let logs = '';
  const deadline = setTimeout(() => {
    child?.kill('SIGKILL');
    for (const client of clients) client.socket.disconnect();
  }, 30000);
  try {
    const port = await unusedPort();
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'test', BASE_PATH: '', PORT: String(port), STATS_FILE: path.join(scratch, 'stats.json'), BROWSER_TRANSFER_TTL_MS: '1000', DISCONNECT_GRACE_MS: '60000' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (data: Buffer) => { logs += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { logs += data.toString(); });
    child.on('error', (error) => { logs += error.message; });
    await until(() => {
      assert.equal(child!.exitCode, null, `isolated server exited: ${logs}`);
      return logs.includes('server running on');
    }, 'isolated server start', 8000);
    const url = `http://127.0.0.1:${port}`;
    await activeGameTransfer(url);
    await lobbyAndInvalidTransfers(url);
    await explicitLobbyLeave(url);
  } catch (error) {
    console.error(logs);
    throw error;
  } finally {
    clearTimeout(deadline);
    for (const client of clients) client.socket.disconnect();
    if (child) await stop(child);
    await rm(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
