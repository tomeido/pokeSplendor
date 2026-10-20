// Pokémon roster and deck regression checks. Run: npx tsx server/data.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildAllCards, NAME_TO_DEX, POKEMON } from '../shared/data.ts';
import { GEM_TYPES, type Card } from '../shared/types.ts';
import { localizeCard } from '../src/i18n.tsx';

const TIERS = [1, 2, 3] as const;
const CARD_COUNTS = { 1: 40, 2: 30, 3: 20 };
const PER_GEM = { 1: 8, 2: 6, 3: 4 };
const SEEDED_GAMES = 256;
const roster = Object.values(POKEMON).flat(2);
const early = (name: string) => NAME_TO_DEX[name] >= 1 && NAME_TO_DEX[name] <= 251;

function random(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function mechanics(cards: Card[]): string {
  const specs = cards.map(({ id, tier, bonus, points, cost }) =>
    [id, tier, bonus, points, ...GEM_TYPES.map((gem) => cost[gem])]);
  return createHash('sha256').update(JSON.stringify(specs)).digest('hex');
}

// Captured from the original canonical deck, before randomizing Pokémon names.
const CANONICAL_DECK = '40c5b2d98dd05b17b63ecc29ececdb8eacbe67b6106ba0e86a442435c2b80d11';
const poolsBefore = JSON.stringify(POKEMON);
assert.equal(roster.length, 290, 'all 251 Kanto/Johto species join the existing 39 later species');
assert.equal(new Set(roster).size, roster.length, 'every species belongs to exactly one gem/tier pool');
assert.equal(new Set(roster.map((name) => NAME_TO_DEX[name])).size, roster.length, 'each active species has a unique National Pokédex number');
assert.deepEqual(
  roster.filter(early).map((name) => NAME_TO_DEX[name]).sort((a, b) => a - b),
  Array.from({ length: 251 }, (_, index) => index + 1),
  'every generation 1 and 2 species is available in an active pool',
);

for (const gem of GEM_TYPES) {
  for (const tier of TIERS) {
    const pool = POKEMON[gem][tier - 1];
    assert.ok(pool.length > PER_GEM[tier], `${gem} tier ${tier} can vary between games`);
    assert.ok(pool.filter(early).length >= Math.round(PER_GEM[tier] * 0.8), `${gem} tier ${tier} can meet its Kanto/Johto quota`);
  }
}

for (const name of roster) {
  const dex = NAME_TO_DEX[name];
  assert.ok(Number.isInteger(dex) && dex > 0, `${name} has a National Pokédex number`);
  const png = readFileSync(new URL(`../public/sprites/${dex}.png`, import.meta.url));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `${name} has a PNG sprite`);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR', `${name} has a PNG image header`);
  assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, `${name} has nonempty sprite dimensions`);
  assert.deepEqual(png.subarray(-12), Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]), `${name} has a complete PNG sprite`);
  assert.match(localizeCard('ko', name), /[가-힣]/u, `${name} has a Korean name`);
  assert.equal(localizeCard('en', name), name, `${name} keeps its English name in English`);
}

const first = buildAllCards(random(42));
const firstSnapshot = structuredClone(first);
assert.deepEqual(buildAllCards(random(42)), first, 'an injected seed reproduces the same Pokémon');
assert.notDeepEqual(buildAllCards(random(43)), first, 'different seeds vary the Pokémon');

const seen = new Set<string>();
function checkDeck(deck: ReturnType<typeof buildAllCards>): void {
  const cards = Object.values(deck).flat();
  assert.equal(mechanics(cards), CANONICAL_DECK, 'random names preserve every card ID, tier, bonus, point and cost');
  assert.equal(new Set(cards.map((card) => card.name)).size, 90, 'a game never repeats a species');
  assert.ok(cards.filter((card) => early(card.name)).length >= 80, 'at least 80 of each game\'s 90 cards feature generations 1 and 2');

  for (const tier of TIERS) {
    assert.equal(deck[tier].length, CARD_COUNTS[tier], `tier ${tier} keeps its deck size`);
    for (const gem of GEM_TYPES) {
      assert.equal(deck[tier].filter((card) => card.bonus === gem).length, PER_GEM[tier], `tier ${tier} keeps its ${gem} card count`);
    }
    for (const card of deck[tier]) {
      assert.ok(POKEMON[card.bonus][tier - 1].includes(card.name), `${card.name} belongs to its card's gem/tier pool`);
      seen.add(card.name);
    }
  }
}
for (let seed = 0; seed < SEEDED_GAMES; seed++) {
  checkDeck(buildAllCards(random(seed)));
}
assert.deepEqual([...seen].sort(), [...roster].sort(), `every roster species can appear across ${SEEDED_GAMES} seeded games`);
checkDeck(buildAllCards(() => 0));
checkDeck(buildAllCards(() => 1 - Number.EPSILON));
assert.deepEqual(first, firstSnapshot, 'later builds leave earlier decks untouched');
assert.equal(JSON.stringify(POKEMON), poolsBefore, 'building decks never reorders or consumes the roster');

first[1][0].name = 'Changed';
first[1][0].cost.white = 999;
assert.deepEqual(buildAllCards(random(42)), firstSnapshot, 'returned cards and costs are independent of future builds');

console.log(`✓ Pokémon checks passed: ${roster.length} species, ${seen.size} seen across ${SEEDED_GAMES} seeded games; canonical deck preserved.`);
