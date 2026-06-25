// Ad-hoc engine smoke test. Run with: npx tsx server/engine.test.ts
import { applyAction, canAfford, createGame, newPlayer, payment, serializeFor, totalTokens } from '../shared/engine.ts';
import { GEM_TYPES, type GemType } from '../shared/types.ts';

let passed = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { console.error('  ✗ FAIL:', msg); process.exitCode = 1; }
  else { passed++; }
}

function fresh() {
  return createGame('TEST', [newPlayer('a', 'Ash'), newPlayer('b', 'Misty')], 'a');
}

// ── Setup ──
{
  const g = fresh();
  ok(GEM_TYPES.every((c) => g.bank[c] === 4), '2p bank has 4 of each gem');
  ok(g.bank.gold === 5, '2p bank has 5 gold');
  ok(g.board[1].length === 4 && g.board[2].length === 4 && g.board[3].length === 4, '4 cards per tier');
  ok(g.decks[1].length === 36 && g.decks[2].length === 26 && g.decks[3].length === 16, 'decks drawn down by 4');
  ok(g.nobles.length === 3, '2p → 3 nobles');
  ok(g.current === 0, 'player 0 starts');
}

// ── TAKE_THREE then TAKE_TWO, turn alternation ──
{
  const g = fresh();
  let r = applyAction(g, 'a', { type: 'TAKE_THREE', gems: ['white', 'blue', 'green'] });
  ok(r.ok, 'take three valid');
  ok(g.players[0].tokens.white === 1 && g.bank.white === 3, 'token moved from bank');
  ok(g.current === 1, 'turn passed to player 1');
  r = applyAction(g, 'a', { type: 'TAKE_TWO', gem: 'red' });
  ok(!r.ok, "player 0 cannot act on player 1's turn");
  r = applyAction(g, 'b', { type: 'TAKE_TWO', gem: 'red' });
  ok(r.ok && g.players[1].tokens.red === 2 && g.bank.red === 2, 'take two of red works');
  ok(g.current === 0, 'turn back to player 0');

  const r2 = applyAction(g, 'a', { type: 'TAKE_THREE', gems: ['white', 'white', 'green'] });
  ok(!r2.ok, 'cannot take duplicate colours in take-three');
}

// ── TAKE_TWO requires 4 in bank ──
{
  const g = fresh();
  g.bank.green = 3;
  const r = applyAction(g, 'a', { type: 'TAKE_TWO', gem: 'green' });
  ok(!r.ok, 'take two blocked when bank < 4');
}

// ── RESERVE grants gold and refills board ──
{
  const g = fresh();
  const target = g.board[1][0]!;
  const deckBefore = g.decks[1].length;
  const r = applyAction(g, 'a', { type: 'RESERVE', cardId: target.id });
  ok(r.ok, 'reserve valid');
  ok(g.players[0].reserved.length === 1 && g.players[0].reserved[0].id === target.id, 'card reserved');
  ok(g.players[0].tokens.gold === 1 && g.bank.gold === 4, 'reserve grants 1 gold');
  ok(g.board[1][0]!.id !== target.id && g.decks[1].length === deckBefore - 1, 'board refilled from deck');
}

// ── BUY with bonuses and gold ──
{
  const g = fresh();
  const p = g.players[0];
  const card = g.board[1].find((c) => c!.points === 0)!;
  // Give exactly enough tokens (and rely on gold for any shortfall).
  for (const c of GEM_TYPES) p.tokens[c] = card.cost[c];
  ok(canAfford(p, card), 'affordable when tokens equal cost');
  const pay = payment(p, card);
  const r = applyAction(g, 'a', { type: 'BUY', cardId: card.id });
  ok(r.ok, 'buy valid');
  ok(p.purchased.length === 1 && p.bonuses[card.bonus] === 1, 'card purchased, bonus gained');
  ok(GEM_TYPES.every((c) => p.tokens[c] === card.cost[c] - pay.spend[c]), 'tokens spent back to bank');
  ok(g.current === 1, 'turn passed after buy');
}

// ── Bonuses discount future purchases ──
{
  const g = fresh();
  const p = g.players[0];
  const card = g.board[1].find((c) => c!.cost.white > 0)!;
  p.bonuses.white = 99; // massive white discount
  for (const c of GEM_TYPES) if (c !== 'white') p.tokens[c] = card.cost[c];
  ok(canAfford(p, card), 'bonus covers the white cost entirely');
}

// ── Over-cap forces discard, which must match exactly ──
{
  const g = fresh();
  const p = g.players[0];
  // Pre-load 9 tokens, then take 3 → 12, must discard 2.
  p.tokens.white = 3; p.tokens.blue = 3; p.tokens.red = 3;
  const r = applyAction(g, 'a', { type: 'TAKE_THREE', gems: ['white', 'blue', 'green'] });
  ok(r.ok && g.pendingDiscard === 2, 'taking over 10 sets pendingDiscard = 2');
  ok(g.current === 0, 'turn does not pass until discard resolved');
  const bad = applyAction(g, 'a', { type: 'DISCARD', tokens: { white: 1 } });
  ok(!bad.ok, 'discard must return the exact count');
  const good = applyAction(g, 'a', { type: 'DISCARD', tokens: { white: 1, blue: 1 } });
  ok(good.ok && g.pendingDiscard === 0 && totalTokens(p) === 10, 'discard returns to 10');
  ok(g.current === 1, 'turn passes after discard');
}

// ── Noble auto-awarded when a single one qualifies ──
{
  const g = fresh();
  const p = g.players[0];
  const noble = g.nobles[0];
  for (const c of GEM_TYPES) p.bonuses[c] = noble.requirement[c]; // exactly meet it
  // Make a cheap legal move (take two) to trigger end-of-turn noble check.
  const r = applyAction(g, 'a', { type: 'TAKE_TWO', gem: 'red' });
  ok(r.ok, 'move with qualifying noble valid');
  ok(p.nobles.length === 1 && p.points >= 3, 'noble auto-awarded (+3)');
  ok(g.nobles.length === 2, 'noble removed from board');
}

// ── Win triggers only at the end of a full round ──
{
  const g = fresh();
  g.players[0].points = 15;
  // Player 0 moves; round not complete yet (player 1 hasn't gone).
  applyAction(g, 'a', { type: 'TAKE_TWO', gem: 'red' });
  ok(g.status === 'playing', 'game continues until round completes');
  // Player 1 moves → round completes → winner declared.
  applyAction(g, 'b', { type: 'TAKE_TWO', gem: 'green' });
  ok(g.status === 'finished' && g.winnerId === 'a', 'player 0 wins after equal turns');
}

// ── Serialization hides decks and opponents' reserved cards ──
{
  const g = fresh();
  applyAction(g, 'a', { type: 'RESERVE', cardId: g.board[2][0]!.id });
  const viewB = serializeFor(g, 'b');
  ok(!('decks' in (viewB as any)), 'client view has no raw decks');
  ok(viewB.deckCounts[1] === 36, 'deck counts exposed');
  const aFromB = viewB.players.find((p) => p.id === 'a')!;
  ok(aFromB.reserved.every((c: any) => c.hidden === true), "opponent's reserved cards are hidden");
  const aFromA = serializeFor(g, 'a').players.find((p) => p.id === 'a')!;
  ok(aFromA.reserved.every((c: any) => !('hidden' in c)), 'own reserved cards are visible');
}

console.log(process.exitCode ? `\nSome checks failed.` : `\n✓ All ${passed} engine checks passed.`);
