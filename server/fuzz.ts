// Self-play fuzzer: plays many full random-but-legal games through the engine,
// checking invariants after every action. Run: npx tsx server/fuzz.ts [games]
import { applyAction, canAfford, createGame, newPlayer } from '../shared/engine.ts';
import { GEM_TYPES, type Action, type GameState, type GemType, type Player, type TokenType } from '../shared/types.ts';

const GAMES = Number(process.argv[2]) || 400;
const MAX_TURNS = 4000;
let bugCount = 0;
const seenErrors = new Set<string>();

function bug(msg: string, ctx?: unknown) {
  bugCount++;
  const key = msg.split(' [')[0];
  if (seenErrors.has(key)) return;
  seenErrors.add(key);
  console.error('  ✗ BUG:', msg);
  if (ctx) console.error('       ', JSON.stringify(ctx).slice(0, 300));
}

// A simple xorshift PRNG so failures are reproducible by seed.
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0xffffffff; };
}

function legalActions(g: GameState): Action[] {
  const p = g.players[g.current];
  const acts: Action[] = [];

  if (g.pendingDiscard > 0) {
    // Build one valid discard returning exactly pendingDiscard tokens.
    const tokens: Partial<Record<TokenType, number>> = {};
    let need = g.pendingDiscard;
    for (const t of [...GEM_TYPES, 'gold'] as TokenType[]) {
      const take = Math.min(p.tokens[t], need);
      if (take > 0) { tokens[t] = take; need -= take; }
    }
    return [{ type: 'DISCARD', tokens }];
  }
  if (g.pendingNobles.length > 0) {
    return g.pendingNobles.map((n) => ({ type: 'CHOOSE_NOBLE', nobleId: n.id }));
  }

  const avail = GEM_TYPES.filter((c) => g.bank[c] > 0);
  if (avail.length >= 3) {
    // a few random 3-combos
    acts.push({ type: 'TAKE_THREE', gems: avail.slice(0, 3) });
    if (avail.length > 3) acts.push({ type: 'TAKE_THREE', gems: [avail[0], avail[2], avail[3] ?? avail[1]] });
  } else if (avail.length > 0) {
    acts.push({ type: 'TAKE_THREE', gems: avail });
  }
  for (const c of GEM_TYPES) if (g.bank[c] >= 4) acts.push({ type: 'TAKE_TWO', gem: c });

  if (p.reserved.length < 3) {
    for (const tier of [1, 2, 3] as const) {
      for (const c of g.board[tier]) if (c) acts.push({ type: 'RESERVE', cardId: c.id });
      if (g.decks[tier].length > 0) acts.push({ type: 'RESERVE', deckTier: tier });
    }
  }
  for (const tier of [1, 2, 3] as const) for (const c of g.board[tier]) if (c && canAfford(p, c)) acts.push({ type: 'BUY', cardId: c.id });
  for (const c of p.reserved) if (canAfford(p, c)) acts.push({ type: 'BUY', cardId: c.id });

  // Only legal when nothing else is — keeps a globally-stuck game from hanging.
  if (acts.length === 0) acts.push({ type: 'PASS' });
  return acts;
}

function pickAction(g: GameState, acts: Action[], rand: () => number): Action {
  // Bias toward buying so games make progress and actually end.
  const buys = acts.filter((a) => a.type === 'BUY');
  if (buys.length && rand() < 0.65) return buys[Math.floor(rand() * buys.length)];
  return acts[Math.floor(rand() * acts.length)];
}

function checkInvariants(g: GameState, init: { bank: Record<TokenType, number>; nobles: number }, tag: string) {
  // 1. Token conservation per colour (bank + all players).
  for (const t of [...GEM_TYPES, 'gold'] as TokenType[]) {
    let sum = g.bank[t];
    for (const p of g.players) sum += p.tokens[t];
    if (sum !== init.bank[t]) bug(`token conservation broken for ${t} [${tag}]`, { sum, expected: init.bank[t] });
    if (g.bank[t] < 0) bug(`negative bank ${t} [${tag}]`);
  }
  // 2. No negative player tokens; reserved cap.
  for (const p of g.players) {
    for (const t of [...GEM_TYPES, 'gold'] as TokenType[]) if (p.tokens[t] < 0) bug(`negative player token ${t} [${tag}]`);
    if (p.reserved.length > 3) bug(`reserved > 3 [${tag}]`);
    // 3. Points and bonuses derive correctly.
    const cardPts = p.purchased.reduce((s, c) => s + c.points, 0);
    if (p.points !== cardPts + p.nobles.length * 3) bug(`points mismatch [${tag}]`, { points: p.points, cardPts, nobles: p.nobles.length });
    for (const gm of GEM_TYPES) {
      const cnt = p.purchased.filter((c) => c.bonus === gm).length;
      if (p.bonuses[gm] !== cnt) bug(`bonus count mismatch ${gm} [${tag}]`);
    }
    // Over-cap only allowed transiently while a discard is pending for the current player.
    const total = ([...GEM_TYPES, 'gold'] as TokenType[]).reduce((s, t) => s + p.tokens[t], 0);
    const isCurrentMidDiscard = g.players[g.current].id === p.id && g.pendingDiscard > 0;
    if (total > 10 && !isCurrentMidDiscard) bug(`player over 10 tokens (${total}) without pending discard [${tag}]`);
  }
  // 4. Card conservation: 90 unique cards across all zones, board slots = 4 each.
  const ids = new Set<string>();
  let count = 0;
  for (const tier of [1, 2, 3] as const) {
    if (g.board[tier].length !== 4) bug(`board tier ${tier} not 4 slots [${tag}]`);
    for (const c of g.board[tier]) if (c) { count++; if (ids.has(c.id)) bug(`dup card ${c.id} [${tag}]`); ids.add(c.id); }
    for (const c of g.decks[tier]) { count++; if (ids.has(c.id)) bug(`dup card ${c.id} [${tag}]`); ids.add(c.id); }
  }
  for (const p of g.players) for (const c of [...p.reserved, ...p.purchased]) { count++; if (ids.has(c.id)) bug(`dup card ${c.id} [${tag}]`); ids.add(c.id); }
  if (count !== 90) bug(`card count != 90 (${count}) [${tag}]`);
  // 5. Noble conservation.
  let nob = g.nobles.length;
  for (const p of g.players) nob += p.nobles.length;
  if (nob !== init.nobles) bug(`noble conservation broken (${nob}/${init.nobles}) [${tag}]`);
}

let totalTurns = 0, finished = 0, deadlocks = 0, deadlockEnds = 0;
const winnerPts: number[] = [];

for (let gi = 0; gi < GAMES; gi++) {
  const nPlayers = 2 + (gi % 3); // cycle 2,3,4
  const players: Player[] = Array.from({ length: nPlayers }, (_, i) => newPlayer('p' + i, 'P' + i));
  const g = createGame('FUZZ' + gi, players, 'p0');
  const init = {
    bank: Object.fromEntries(([...GEM_TYPES, 'gold'] as TokenType[]).map((t) => {
      let s = g.bank[t]; for (const p of g.players) s += p.tokens[t]; return [t, s];
    })) as Record<TokenType, number>,
    nobles: g.nobles.length,
  };
  const rand = rng(gi * 2654435761 + 12345);

  let turns = 0;
  while (g.status === 'playing' && turns < MAX_TURNS) {
    const acts = legalActions(g);
    if (acts.length === 0) {
      deadlocks++;
      bug(`deadlock: current player has no legal action [game ${gi}]`, {
        bank: g.bank, reserved: g.players[g.current].reserved.length,
      });
      break;
    }
    const action = pickAction(g, acts, rand);
    const pid = g.players[g.current].id;
    let res;
    try { res = applyAction(g, pid, action); }
    catch (e) { bug(`applyAction threw [game ${gi}]: ${(e as Error).message}`, action); break; }
    if (!res.ok) { bug(`legal action rejected [game ${gi}]: ${res.error}`, action); break; }
    checkInvariants(g, init, `game ${gi} turn ${turns}`);
    turns++;
  }
  totalTurns += turns;
  if (g.status === 'finished') {
    finished++;
    const w = g.players.find((p) => p.id === g.winnerId);
    if (!w) bug(`finished without winner [game ${gi}]`);
    else {
      winnerPts.push(w.points);
      const byDeadlock = g.consecutivePasses >= nPlayers;
      if (byDeadlock) deadlockEnds++;
      // A winner below 15 is only valid when the game ended via global deadlock.
      if (w.points < 15 && !byDeadlock) bug(`winner has < 15 points (${w.points}) without deadlock [game ${gi}]`);
      // Winner must be a max-points player.
      const max = Math.max(...g.players.map((p) => p.points));
      if (w.points !== max) bug(`winner not top scorer [game ${gi}]`, { winner: w.points, max });
    }
  } else if (turns >= MAX_TURNS) {
    bug(`game did not terminate within ${MAX_TURNS} turns [game ${gi}]`);
  }
}

const avgWin = winnerPts.length ? (winnerPts.reduce((a, b) => a + b, 0) / winnerPts.length).toFixed(1) : 'n/a';
console.log(`\nPlayed ${GAMES} games · finished ${finished} · avg turns/game ${(totalTurns / GAMES).toFixed(0)} · avg winning score ${avgWin} · runtime-deadlocks ${deadlocks} · games ended by global-pass ${deadlockEnds}`);
console.log(bugCount ? `\n✗ ${bugCount} invariant violation(s) found (${seenErrors.size} distinct).` : `\n✓ No bugs found across ${GAMES} games.`);
process.exit(bugCount ? 1 : 0);
