import {
  type Action, type Card, type GameState, type GemType, type LogEntry, type Noble, type Player,
  type TokenPool, GEM_TYPES, MAX_RESERVED, MAX_TOKENS, WINNING_SCORE, emptyPool,
} from './types.ts';
import { buildAllCards, buildNobles } from './data.ts';

// ── Setup ──────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const BANK_BY_PLAYERS: Record<number, number> = { 2: 4, 3: 5, 4: 7 };

export function newPlayer(id: string, name: string, isAI = false): Player {
  return {
    id, name, connected: true, isAI,
    tokens: emptyPool(),
    bonuses: { white: 0, blue: 0, green: 0, red: 0, black: 0 },
    reserved: [], purchased: [], nobles: [], points: 0,
  };
}

export function createGame(roomId: string, players: Player[], hostId: string): GameState {
  const n = players.length;
  const perGem = BANK_BY_PLAYERS[n] ?? 7;
  const bank: TokenPool = { white: perGem, blue: perGem, green: perGem, red: perGem, black: perGem, gold: 5 };

  const all = buildAllCards();
  const decks = { 1: shuffle(all[1]), 2: shuffle(all[2]), 3: shuffle(all[3]) };
  const board = {
    1: [decks[1].pop()!, decks[1].pop()!, decks[1].pop()!, decks[1].pop()!] as (Card | null)[],
    2: [decks[2].pop()!, decks[2].pop()!, decks[2].pop()!, decks[2].pop()!] as (Card | null)[],
    3: [decks[3].pop()!, decks[3].pop()!, decks[3].pop()!, decks[3].pop()!] as (Card | null)[],
  };
  const nobles = shuffle(buildNobles()).slice(0, n + 1);

  return {
    roomId, players, current: 0, decks, board, bank, nobles,
    log: [{ k: 'start', names: players.map((p) => p.name), first: players[0].name }],
    status: 'playing', winnerId: null, turnCount: 0,
    pendingDiscard: 0, pendingNobles: [], consecutivePasses: 0, hostId,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function totalTokens(p: Player): number {
  return GEM_TYPES.reduce((s, g) => s + p.tokens[g], 0) + p.tokens.gold;
}

/** Cost in tokens to buy `card`, accounting for the player's permanent bonuses.
 *  Returns the per-colour token spend and gold needed, or null if unaffordable. */
export function payment(p: Player, card: Card): { spend: TokenPool; affordable: boolean } {
  const spend = emptyPool();
  let goldNeeded = 0;
  for (const g of GEM_TYPES) {
    const need = Math.max(0, card.cost[g] - p.bonuses[g]);
    const fromTokens = Math.min(need, p.tokens[g]);
    spend[g] = fromTokens;
    goldNeeded += need - fromTokens;
  }
  spend.gold = goldNeeded;
  return { spend, affordable: goldNeeded <= p.tokens.gold };
}

export function canAfford(p: Player, card: Card): boolean {
  return payment(p, card).affordable;
}

function findOnBoard(state: GameState, cardId: string): { tier: 1 | 2 | 3; idx: number; card: Card } | null {
  for (const t of [1, 2, 3] as const) {
    const idx = state.board[t].findIndex((c) => c && c.id === cardId);
    if (idx >= 0) return { tier: t, idx, card: state.board[t][idx]! };
  }
  return null;
}

function refill(state: GameState, tier: 1 | 2 | 3, idx: number): void {
  state.board[tier][idx] = state.decks[tier].pop() ?? null;
}

function eligibleNobles(state: GameState, p: Player): Noble[] {
  return state.nobles.filter((n) => GEM_TYPES.every((g) => p.bonuses[g] >= n.requirement[g]));
}

/** Does `p` have any legal main action available? Used to detect a turn with no possible move. */
export function hasLegalMove(state: GameState, p: Player): boolean {
  // Taking gems: legal if any gem pile is non-empty (you may take 1 if that's all there is).
  if (GEM_TYPES.some((g) => state.bank[g] > 0)) return true;
  // Reserving: legal if there's room and any card remains face-up or in a deck.
  if (p.reserved.length < MAX_RESERVED) {
    for (const t of [1, 2, 3] as const) {
      if (state.board[t].some(Boolean) || state.decks[t].length > 0) return true;
    }
  }
  // Buying: any affordable face-up or reserved card.
  for (const t of [1, 2, 3] as const) for (const c of state.board[t]) if (c && canAfford(p, c)) return true;
  for (const c of p.reserved) if (canAfford(p, c)) return true;
  return false;
}

// ── Turn resolution ──────────────────────────────────────────────────────────

function finishByStandings(state: GameState, reason: 'score' | 'deadlock'): void {
  const max = Math.max(...state.players.map((p) => p.points));
  const contenders = state.players.filter((p) => p.points === max);
  contenders.sort((a, b) => a.purchased.length - b.purchased.length);
  const winner = contenders[0];
  state.status = 'finished';
  state.winnerId = winner.id;
  state.log.push({ k: 'win', name: winner.name, points: winner.points, reason });
}

function advanceTurn(state: GameState, wasPass = false): void {
  const n = state.players.length;
  state.consecutivePasses = wasPass ? state.consecutivePasses + 1 : 0;
  // If every player passed in a row, nobody can move — end on current standings.
  if (state.consecutivePasses >= n) {
    finishByStandings(state, 'deadlock');
    return;
  }
  state.turnCount++;
  const next = (state.current + 1) % n;
  if (next === 0) {
    // A full round just completed — check for a winner so everyone gets equal turns.
    const max = Math.max(...state.players.map((p) => p.points));
    if (max >= WINNING_SCORE) {
      finishByStandings(state, 'score');
      return;
    }
  }
  state.current = next;
}

/** Called after a main action (and after any forced discard) to award nobles and pass the turn. */
function checkNoblesThenAdvance(state: GameState): void {
  const p = state.players[state.current];
  const eligible = eligibleNobles(state, p);
  if (eligible.length === 0) {
    advanceTurn(state);
  } else if (eligible.length === 1) {
    awardNoble(state, p, eligible[0]);
    advanceTurn(state);
  } else {
    // Player must choose which noble visits.
    state.pendingNobles = eligible;
  }
}

function awardNoble(state: GameState, p: Player, noble: Noble): void {
  state.nobles = state.nobles.filter((n) => n.id !== noble.id);
  p.nobles.push(noble);
  p.points += noble.points;
  state.log.push({ k: 'noble', name: p.name, noble: noble.name });
}

/** Entry point after a TAKE / RESERVE / BUY that handles the 10-token cap. */
function afterMainAction(state: GameState): void {
  const p = state.players[state.current];
  const total = totalTokens(p);
  if (total > MAX_TOKENS) {
    state.pendingDiscard = total - MAX_TOKENS;
    state.log.push({ k: 'overcap', name: p.name, n: state.pendingDiscard });
    return;
  }
  checkNoblesThenAdvance(state);
}

// ── Action application ────────────────────────────────────────────────────────

export type ApplyResult = { ok: true } | { ok: false; error: string };

export function applyAction(state: GameState, playerId: string, action: Action): ApplyResult {
  if (state.status !== 'playing') return { ok: false, error: 'The game is not in progress.' };
  const p = state.players[state.current];
  if (p.id !== playerId) return { ok: false, error: "It is not your turn." };

  // Forced sub-decisions take priority.
  if (state.pendingDiscard > 0 && action.type !== 'DISCARD')
    return { ok: false, error: `Return ${state.pendingDiscard} token(s) first.` };
  if (state.pendingNobles.length > 0 && action.type !== 'CHOOSE_NOBLE')
    return { ok: false, error: 'Choose a noble first.' };

  switch (action.type) {
    case 'TAKE_THREE': {
      const gems = action.gems;
      if (!Array.isArray(gems) || gems.length < 1 || gems.length > 3)
        return { ok: false, error: 'Pick 1 to 3 different gems.' };
      if (new Set(gems).size !== gems.length) return { ok: false, error: 'Gems must be different colours.' };
      for (const g of gems) {
        if (!GEM_TYPES.includes(g)) return { ok: false, error: 'Invalid gem.' };
        if (state.bank[g] < 1) return { ok: false, error: `No ${g} gems left in the bank.` };
      }
      // You may only take fewer than 3 if fewer distinct colours are available.
      if (gems.length < 3) {
        const available = GEM_TYPES.filter((g) => state.bank[g] > 0 && !gems.includes(g));
        if (available.length > 0 && gems.length < 3)
          return { ok: false, error: 'You must take 3 different gems when available.' };
      }
      for (const g of gems) { state.bank[g]--; p.tokens[g]++; }
      state.log.push({ k: 'take3', name: p.name, gems: [...gems] });
      afterMainAction(state);
      return { ok: true };
    }

    case 'TAKE_TWO': {
      const g = action.gem;
      if (!GEM_TYPES.includes(g)) return { ok: false, error: 'Invalid gem.' };
      if (state.bank[g] < 4) return { ok: false, error: 'Need at least 4 in the bank to take 2.' };
      state.bank[g] -= 2; p.tokens[g] += 2;
      state.log.push({ k: 'take2', name: p.name, gem: g });
      afterMainAction(state);
      return { ok: true };
    }

    case 'RESERVE': {
      if (p.reserved.length >= MAX_RESERVED) return { ok: false, error: 'You already have 3 reserved cards.' };
      let card: Card | null = null;
      if (action.cardId) {
        const found = findOnBoard(state, action.cardId);
        if (!found) return { ok: false, error: 'Card not on the board.' };
        card = found.card;
        refill(state, found.tier, found.idx);
      } else if (action.deckTier) {
        const deck = state.decks[action.deckTier];
        if (deck.length === 0) return { ok: false, error: 'That deck is empty.' };
        card = deck.pop()!;
      } else {
        return { ok: false, error: 'Nothing to reserve.' };
      }
      p.reserved.push(card);
      if (state.bank.gold > 0) { state.bank.gold--; p.tokens.gold++; }
      state.log.push({ k: 'reserve', name: p.name, tier: card.tier });
      afterMainAction(state);
      return { ok: true };
    }

    case 'BUY': {
      let card: Card | null = null;
      let from: 'board' | 'reserved' = 'board';
      const onBoard = findOnBoard(state, action.cardId);
      if (onBoard) { card = onBoard.card; from = 'board'; }
      else {
        const ri = p.reserved.findIndex((c) => c.id === action.cardId);
        if (ri >= 0) { card = p.reserved[ri]; from = 'reserved'; }
      }
      if (!card) return { ok: false, error: 'Card not available to buy.' };

      const pay = payment(p, card);
      if (!pay.affordable) return { ok: false, error: 'You cannot afford that card.' };

      // Spend tokens back to the bank.
      for (const g of GEM_TYPES) { p.tokens[g] -= pay.spend[g]; state.bank[g] += pay.spend[g]; }
      p.tokens.gold -= pay.spend.gold; state.bank.gold += pay.spend.gold;

      p.purchased.push(card);
      p.bonuses[card.bonus]++;
      p.points += card.points;

      if (from === 'board') {
        const found = findOnBoard(state, card.id)!;
        refill(state, found.tier, found.idx);
      } else {
        p.reserved = p.reserved.filter((c) => c.id !== card!.id);
      }
      state.log.push({ k: 'buy', name: p.name, card: card.name, bonus: card.bonus, points: card.points });
      checkNoblesThenAdvance(state); // buying never grants tokens, so no discard step
      return { ok: true };
    }

    case 'DISCARD': {
      if (state.pendingDiscard <= 0) return { ok: false, error: 'No discard required.' };
      const ret = action.tokens ?? {};
      let count = 0;
      for (const t of Object.keys(ret) as (keyof TokenPool)[]) {
        const v = ret[t] ?? 0;
        if (v < 0) return { ok: false, error: 'Invalid discard.' };
        if (v > p.tokens[t]) return { ok: false, error: `You don't have that many ${t}.` };
        count += v;
      }
      if (count !== state.pendingDiscard)
        return { ok: false, error: `Return exactly ${state.pendingDiscard} token(s).` };
      for (const t of Object.keys(ret) as (keyof TokenPool)[]) {
        const v = ret[t] ?? 0; p.tokens[t] -= v; state.bank[t] += v;
      }
      state.pendingDiscard = 0;
      state.log.push({ k: 'returned', name: p.name, n: count });
      checkNoblesThenAdvance(state);
      return { ok: true };
    }

    case 'CHOOSE_NOBLE': {
      const noble = state.pendingNobles.find((n) => n.id === action.nobleId);
      if (!noble) return { ok: false, error: 'Invalid noble choice.' };
      awardNoble(state, p, noble);
      state.pendingNobles = [];
      advanceTurn(state);
      return { ok: true };
    }

    case 'PASS': {
      if (hasLegalMove(state, p)) return { ok: false, error: 'You still have a legal move.' };
      state.log.push({ k: 'pass', name: p.name });
      advanceTurn(state, true);
      return { ok: true };
    }

    default:
      return { ok: false, error: 'Unknown action.' };
  }
}

// ── Computer (AI) player ──────────────────────────────────────────────────────

/** Colours most needed to afford the cards currently on the board, most-wanted first. */
function neededColors(state: GameState, p: Player): GemType[] {
  const deficit: Record<GemType, number> = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  for (const t of [1, 2, 3] as const) for (const c of state.board[t]) if (c) {
    for (const g of GEM_TYPES) deficit[g] += Math.max(0, c.cost[g] - p.bonuses[g] - p.tokens[g]);
  }
  return [...GEM_TYPES].filter((g) => deficit[g] > 0).sort((a, b) => deficit[b] - deficit[a]);
}

/** Pick a reasonable, always-legal move for the current (AI) player. */
export function aiChooseAction(state: GameState): Action {
  const p = state.players[state.current];

  if (state.pendingDiscard > 0) {
    const tokens: Partial<TokenPool> = {};
    let need = state.pendingDiscard;
    // Return the colours we hold most of first; keep gold (wild) until last.
    const order = [...GEM_TYPES].sort((a, b) => p.tokens[b] - p.tokens[a]);
    for (const t of [...order, 'gold'] as (keyof TokenPool)[]) {
      const take = Math.min(p.tokens[t] - (tokens[t] ?? 0), need);
      if (take > 0) { tokens[t] = (tokens[t] ?? 0) + take; need -= take; }
      if (need === 0) break;
    }
    return { type: 'DISCARD', tokens };
  }
  if (state.pendingNobles.length > 0) return { type: 'CHOOSE_NOBLE', nobleId: state.pendingNobles[0].id };

  // 1. Buy the most valuable affordable card (board or reserved).
  const buyable: { id: string; points: number; tier: number }[] = [];
  for (const t of [1, 2, 3] as const) for (const c of state.board[t]) if (c && canAfford(p, c)) buyable.push({ id: c.id, points: c.points, tier: c.tier });
  for (const c of p.reserved) if (canAfford(p, c)) buyable.push({ id: c.id, points: c.points, tier: c.tier });
  if (buyable.length) {
    buyable.sort((a, b) => b.points - a.points || b.tier - a.tier);
    return { type: 'BUY', cardId: buyable[0].id };
  }

  // 2. Gather the energy the board most wants.
  const want = neededColors(state, p);
  const three = want.filter((g) => state.bank[g] > 0).slice(0, 3);
  if (three.length === 3) return { type: 'TAKE_THREE', gems: three };
  const two = want.find((g) => state.bank[g] >= 4) ?? GEM_TYPES.find((g) => state.bank[g] >= 4);
  if (two) return { type: 'TAKE_TWO', gem: two };
  const anyAvail = GEM_TYPES.filter((g) => state.bank[g] > 0).slice(0, 3);
  if (anyAvail.length) return { type: 'TAKE_THREE', gems: anyAvail };

  // 3. Nothing to take — reserve a card (also grabs a wild), or pass if truly stuck.
  if (p.reserved.length < MAX_RESERVED) {
    for (const t of [3, 2, 1] as const) { const c = state.board[t].find(Boolean); if (c) return { type: 'RESERVE', cardId: c.id }; }
    for (const t of [1, 2, 3] as const) if (state.decks[t].length) return { type: 'RESERVE', deckTier: t };
  }
  return { type: 'PASS' };
}

// ── Client serialization (hide deck order and opponents' reserved cards) ──────

export interface ClientCardBack { id: string; tier: 1 | 2 | 3; hidden: true }
export type ClientPlayer = Omit<Player, 'reserved'> & {
  reserved: (Card | ClientCardBack)[];
  reservedCount: number;
  isYou: boolean;
};
export type ClientState = Omit<GameState, 'decks' | 'players'> & {
  deckCounts: { 1: number; 2: number; 3: number };
  players: ClientPlayer[];
  youId: string;
  yourIndex: number;
  // True when the current player has no legal action and must pass.
  currentNoMoves: boolean;
};

export function serializeFor(state: GameState, playerId: string): ClientState {
  const players: ClientPlayer[] = state.players.map((p) => {
    const isYou = p.id === playerId;
    return {
      ...p,
      isYou,
      reservedCount: p.reserved.length,
      reserved: isYou
        ? p.reserved
        : p.reserved.map((c) => ({ id: c.id, tier: c.tier, hidden: true as const })),
    };
  });
  const { decks, players: _omit, ...rest } = state;
  const cur = state.players[state.current];
  const currentNoMoves =
    state.status === 'playing' && state.pendingDiscard === 0 && state.pendingNobles.length === 0 &&
    !hasLegalMove(state, cur);
  return {
    ...rest,
    deckCounts: { 1: decks[1].length, 2: decks[2].length, 3: decks[3].length },
    players,
    youId: playerId,
    yourIndex: state.players.findIndex((p) => p.id === playerId),
    currentNoMoves,
  };
}
