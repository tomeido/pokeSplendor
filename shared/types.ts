// ── Core types shared between the authoritative server and the React client ──

export type GemType = 'white' | 'blue' | 'green' | 'red' | 'black';
export type TokenType = GemType | 'gold';

export const GEM_TYPES: GemType[] = ['white', 'blue', 'green', 'red', 'black'];
export const TOKEN_TYPES: TokenType[] = ['white', 'blue', 'green', 'red', 'black', 'gold'];

/** A cost / requirement expressed per gem colour. */
export type Cost = Record<GemType, number>;

/** Token counts held by a player or the bank (includes gold). */
export type TokenPool = Record<TokenType, number>;

export interface Card {
  id: string;
  tier: 1 | 2 | 3;
  bonus: GemType; // permanent discount colour this card provides
  points: number;
  cost: Cost;
  name: string; // Pokémon name
}

export interface Noble {
  id: string;
  points: number; // always 3
  requirement: Cost; // card-bonuses required to attract
  name: string; // Gym Leader / Champion name
}

export interface Player {
  id: string;
  name: string;
  connected: boolean;
  isAI: boolean;
  tokens: TokenPool;
  bonuses: Record<GemType, number>;
  reserved: Card[];
  purchased: Card[];
  nobles: Noble[];
  points: number;
}

// Structured, language-agnostic log events. The client formats them per language.
export type LogEntry =
  | { k: 'start'; names: string[]; first: string }
  | { k: 'take3'; name: string; gems: GemType[] }
  | { k: 'take2'; name: string; gem: GemType }
  | { k: 'reserve'; name: string; tier: number }
  | { k: 'buy'; name: string; card: string; bonus: GemType; points: number }
  | { k: 'overcap'; name: string; n: number }
  | { k: 'returned'; name: string; n: number }
  | { k: 'noble'; name: string; noble: string }
  | { k: 'pass'; name: string }
  | { k: 'win'; name: string; points: number; reason: 'score' | 'deadlock' };

export interface GameState {
  roomId: string;
  players: Player[];
  current: number; // index into players whose turn it is
  // Remaining face-down cards per tier (lengths only are sent to clients).
  decks: { 1: Card[]; 2: Card[]; 3: Card[] };
  // Face-up cards, 4 slots per tier (null when deck exhausted).
  board: { 1: (Card | null)[]; 2: (Card | null)[]; 3: (Card | null)[] };
  bank: TokenPool;
  nobles: Noble[];
  log: LogEntry[];
  status: 'lobby' | 'playing' | 'finished';
  winnerId: string | null;
  turnCount: number;
  // When > 0, the current player must DISCARD this many tokens before the turn ends.
  pendingDiscard: number;
  // When non-empty, the current player must CHOOSE_NOBLE among these.
  pendingNobles: Noble[];
  // Consecutive PASSes; if it reaches the player count the game is a global deadlock.
  consecutivePasses: number;
  hostId: string;
}

// ── Actions a client may request ──
export type Action =
  | { type: 'TAKE_THREE'; gems: GemType[] } // 1-3 distinct gem colours
  | { type: 'TAKE_TWO'; gem: GemType } // 2 of one colour (bank must hold >= 4)
  | { type: 'RESERVE'; cardId?: string; deckTier?: 1 | 2 | 3 } // reserve a face-up card or blind deck top
  | { type: 'BUY'; cardId: string } // buy a face-up or reserved card
  | { type: 'DISCARD'; tokens: Partial<TokenPool> } // return tokens when over the 10-token cap
  | { type: 'CHOOSE_NOBLE'; nobleId: string }
  | { type: 'PASS' }; // only legal when the player has no other move (avoids a hang)

export const WINNING_SCORE = 15;
export const MAX_TOKENS = 10;
export const MAX_RESERVED = 3;

export function emptyPool(): TokenPool {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 };
}

export function emptyCost(): Cost {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0 };
}
