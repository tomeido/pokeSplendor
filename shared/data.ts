import type { Card, GemType, Noble } from './types.ts';
import { emptyCost } from './types.ts';

// ── Theming: each Splendor gem colour maps to a Pokémon energy type ──
export const GEM_THEME: Record<GemType, { label: string; icon: string; color: string }> = {
  white: { label: 'Fairy', icon: '✨', color: '#e8a0bf' },
  blue: { label: 'Water', icon: '💧', color: '#3d9be0' },
  green: { label: 'Grass', icon: '🍃', color: '#4caf50' },
  red: { label: 'Fire', icon: '🔥', color: '#e8553a' },
  black: { label: 'Dark', icon: '🌙', color: '#3a3a4a' },
};
export const GOLD_THEME = { label: 'Electric', icon: '⚡', color: '#f4c430' };

// Pokémon name pools per gem-type and tier, used to skin the development cards.
const POKEMON: Record<GemType, [string[], string[], string[]]> = {
  white: [
    ['Igglybuff', 'Cleffa', 'Snubbull', 'Ralts', 'Spritzee', 'Flabébé', 'Swirlix', 'Cutiefly'],
    ['Jigglypuff', 'Clefairy', 'Granbull', 'Kirlia', 'Aromatisse'],
    ['Wigglytuff', 'Clefable', 'Gardevoir', 'Sylveon'],
  ],
  blue: [
    ['Squirtle', 'Magikarp', 'Psyduck', 'Poliwag', 'Horsea', 'Staryu', 'Tentacool', 'Krabby'],
    ['Wartortle', 'Gyarados', 'Golduck', 'Poliwhirl', 'Seadra'],
    ['Blastoise', 'Vaporeon', 'Lapras', 'Kingdra'],
  ],
  green: [
    ['Bulbasaur', 'Oddish', 'Bellsprout', 'Chikorita', 'Treecko', 'Hoppip', 'Sunkern', 'Seedot'],
    ['Ivysaur', 'Gloom', 'Weepinbell', 'Bayleef', 'Grovyle'],
    ['Venusaur', 'Vileplume', 'Victreebel', 'Sceptile'],
  ],
  red: [
    ['Charmander', 'Vulpix', 'Growlithe', 'Ponyta', 'Cyndaquil', 'Slugma', 'Torchic', 'Litwick'],
    ['Charmeleon', 'Ninetales', 'Arcanine', 'Rapidash', 'Quilava'],
    ['Charizard', 'Flareon', 'Typhlosion', 'Magmortar'],
  ],
  black: [
    ['Poochyena', 'Houndour', 'Sneasel', 'Murkrow', 'Zorua', 'Purrloin', 'Nickit', 'Impidimp'],
    ['Mightyena', 'Houndoom', 'Weavile', 'Honchkrow', 'Zoroark'],
    ['Tyranitar', 'Umbreon', 'Absol', 'Hydreigon'],
  ],
};

// National Pokédex numbers for every Pokémon used above, so the client can load
// the matching sprite from /sprites/<id>.png (bundled locally, see fetch-sprites).
export const NAME_TO_DEX: Record<string, number> = {
  // Fairy (white)
  Igglybuff: 174, Cleffa: 173, Snubbull: 209, Ralts: 280, Spritzee: 682, Flabébé: 669, Swirlix: 684, Cutiefly: 742,
  Jigglypuff: 39, Clefairy: 35, Granbull: 210, Kirlia: 281, Aromatisse: 683,
  Wigglytuff: 40, Clefable: 36, Gardevoir: 282, Sylveon: 700,
  // Water (blue)
  Squirtle: 7, Magikarp: 129, Psyduck: 54, Poliwag: 60, Horsea: 116, Staryu: 120, Tentacool: 72, Krabby: 98,
  Wartortle: 8, Gyarados: 130, Golduck: 55, Poliwhirl: 61, Seadra: 117,
  Blastoise: 9, Vaporeon: 134, Lapras: 131, Kingdra: 230,
  // Grass (green)
  Bulbasaur: 1, Oddish: 43, Bellsprout: 69, Chikorita: 152, Treecko: 252, Hoppip: 187, Sunkern: 191, Seedot: 273,
  Ivysaur: 2, Gloom: 44, Weepinbell: 70, Bayleef: 153, Grovyle: 253,
  Venusaur: 3, Vileplume: 45, Victreebel: 71, Sceptile: 254,
  // Fire (red)
  Charmander: 4, Vulpix: 37, Growlithe: 58, Ponyta: 77, Cyndaquil: 155, Slugma: 218, Torchic: 255, Litwick: 607,
  Charmeleon: 5, Ninetales: 38, Arcanine: 59, Rapidash: 78, Quilava: 156,
  Charizard: 6, Flareon: 136, Typhlosion: 157, Magmortar: 467,
  // Dark (black)
  Poochyena: 261, Houndour: 228, Sneasel: 215, Murkrow: 198, Zorua: 570, Purrloin: 509, Nickit: 827, Impidimp: 859,
  Mightyena: 262, Houndoom: 229, Weavile: 461, Honchkrow: 430, Zoroark: 571,
  Tyranitar: 248, Umbreon: 197, Absol: 359, Hydreigon: 635,
};

export function spriteUrl(name: string): string | null {
  const id = NAME_TO_DEX[name];
  // Resolve under the client's base URL so sprites load when the app is served
  // from a reverse-proxy sub-path (e.g. /splendor/). BASE_URL is '/' at the root.
  // (Client-only: the server never calls this, so import.meta.env stays untouched.)
  return id ? `${import.meta.env.BASE_URL}sprites/${id}.png` : null;
}

// Per-type running counters so each card gets the next name from its pool.
const nameCursor: Record<GemType, [number, number, number]> = {
  white: [0, 0, 0], blue: [0, 0, 0], green: [0, 0, 0], red: [0, 0, 0], black: [0, 0, 0],
};

function nextName(bonus: GemType, tier: 1 | 2 | 3): string {
  const pool = POKEMON[bonus][tier - 1];
  const i = nameCursor[bonus][tier - 1]++;
  return pool[i % pool.length];
}

// Compact card spec: [bonus, points, white, blue, green, red, black]
type Spec = [GemType, number, number, number, number, number, number];

function buildTier(tier: 1 | 2 | 3, specs: Spec[]): Card[] {
  return specs.map((s, idx) => {
    const [bonus, points, w, u, g, r, k] = s;
    const cost = emptyCost();
    cost.white = w; cost.blue = u; cost.green = g; cost.red = r; cost.black = k;
    return { id: `t${tier}-${idx}`, tier, bonus, points, cost, name: nextName(bonus, tier) };
  });
}

// ── The canonical Splendor deck (cost order: white, blue, green, red, black) ──
const TIER1: Spec[] = [
  ['black', 0, 1, 1, 1, 1, 0], ['black', 0, 1, 2, 1, 1, 0], ['black', 0, 2, 2, 0, 1, 0],
  ['black', 0, 0, 0, 1, 3, 1], ['black', 0, 0, 0, 2, 1, 0], ['black', 0, 2, 0, 2, 0, 0],
  ['black', 0, 0, 0, 3, 0, 0], ['black', 1, 0, 4, 0, 0, 0],
  ['blue', 0, 1, 0, 1, 1, 1], ['blue', 0, 1, 0, 1, 2, 1], ['blue', 0, 1, 0, 2, 2, 0],
  ['blue', 0, 0, 1, 3, 1, 0], ['blue', 0, 1, 0, 0, 0, 2], ['blue', 0, 0, 0, 2, 0, 2],
  ['blue', 0, 0, 0, 0, 0, 3], ['blue', 1, 0, 0, 0, 4, 0],
  ['white', 0, 0, 1, 1, 1, 1], ['white', 0, 0, 1, 2, 1, 1], ['white', 0, 0, 2, 2, 0, 1],
  ['white', 0, 3, 1, 0, 0, 1], ['white', 0, 0, 0, 0, 2, 1], ['white', 0, 0, 2, 0, 0, 2],
  ['white', 0, 0, 3, 0, 0, 0], ['white', 1, 0, 0, 4, 0, 0],
  ['green', 0, 1, 1, 0, 1, 1], ['green', 0, 1, 1, 0, 1, 2], ['green', 0, 0, 1, 0, 2, 2],
  ['green', 0, 1, 3, 1, 0, 0], ['green', 0, 2, 1, 0, 0, 0], ['green', 0, 0, 2, 0, 2, 0],
  ['green', 0, 0, 0, 0, 3, 0], ['green', 1, 0, 0, 0, 0, 4],
  ['red', 0, 1, 1, 1, 0, 1], ['red', 0, 2, 1, 1, 0, 1], ['red', 0, 2, 0, 1, 0, 2],
  ['red', 0, 1, 0, 0, 1, 3], ['red', 0, 0, 2, 1, 0, 0], ['red', 0, 2, 0, 0, 2, 0],
  ['red', 0, 3, 0, 0, 0, 0], ['red', 1, 4, 0, 0, 0, 0],
];

const TIER2: Spec[] = [
  ['black', 1, 3, 2, 2, 0, 0], ['black', 1, 3, 0, 3, 0, 2], ['black', 2, 0, 1, 4, 2, 0],
  ['black', 2, 0, 0, 5, 3, 0], ['black', 2, 5, 0, 0, 0, 0], ['black', 3, 0, 0, 0, 0, 6],
  ['blue', 1, 0, 2, 2, 3, 0], ['blue', 1, 0, 2, 3, 0, 3], ['blue', 2, 5, 3, 0, 0, 0],
  ['blue', 2, 2, 0, 0, 1, 4], ['blue', 2, 0, 5, 0, 0, 0], ['blue', 3, 0, 6, 0, 0, 0],
  ['white', 1, 0, 0, 3, 2, 2], ['white', 1, 2, 3, 0, 3, 0], ['white', 2, 0, 0, 1, 4, 2],
  ['white', 2, 0, 0, 0, 5, 3], ['white', 2, 0, 0, 0, 5, 0], ['white', 3, 6, 0, 0, 0, 0],
  ['green', 1, 2, 3, 0, 0, 2], ['green', 1, 3, 0, 2, 3, 0], ['green', 2, 4, 2, 0, 0, 1],
  ['green', 2, 0, 5, 3, 0, 0], ['green', 2, 0, 0, 5, 0, 0], ['green', 3, 0, 0, 6, 0, 0],
  ['red', 1, 2, 0, 0, 2, 3], ['red', 1, 0, 3, 0, 2, 3], ['red', 2, 1, 4, 2, 0, 0],
  ['red', 2, 3, 0, 0, 0, 5], ['red', 2, 0, 0, 0, 0, 5], ['red', 3, 0, 0, 0, 6, 0],
];

const TIER3: Spec[] = [
  ['black', 3, 3, 3, 5, 3, 0], ['black', 4, 0, 0, 0, 7, 0], ['black', 4, 0, 0, 3, 6, 3],
  ['black', 5, 0, 0, 0, 7, 3],
  ['blue', 3, 3, 0, 3, 3, 5], ['blue', 4, 7, 0, 0, 0, 0], ['blue', 4, 6, 3, 0, 0, 3],
  ['blue', 5, 7, 3, 0, 0, 0],
  ['white', 3, 0, 3, 3, 5, 3], ['white', 4, 0, 0, 0, 0, 7], ['white', 4, 3, 0, 0, 3, 6],
  ['white', 5, 3, 0, 0, 0, 7],
  ['green', 3, 5, 3, 0, 3, 3], ['green', 4, 0, 7, 0, 0, 0], ['green', 4, 3, 6, 3, 0, 0],
  ['green', 5, 0, 7, 3, 0, 0],
  ['red', 3, 3, 5, 3, 0, 3], ['red', 4, 0, 0, 7, 0, 0], ['red', 4, 0, 3, 6, 3, 0],
  ['red', 5, 0, 0, 7, 3, 0],
];

// ── Nobles → Gym Leaders & Champions (requirement order: white, blue, green, red, black) ──
const NOBLE_SPECS: [string, number, number, number, number, number][] = [
  ['Brock', 0, 0, 4, 4, 0],
  ['Misty', 0, 0, 0, 4, 4],
  ['Lt. Surge', 0, 4, 4, 0, 0],
  ['Erika', 4, 4, 0, 0, 0],
  ['Koga', 4, 0, 0, 0, 4],
  ['Sabrina', 3, 3, 3, 0, 0],
  ['Blaine', 0, 0, 3, 3, 3],
  ['Giovanni', 3, 0, 0, 3, 3],
  ['Lance', 3, 3, 0, 0, 3],
  ['Cynthia', 0, 3, 3, 3, 0],
];

export function buildNobles(): Noble[] {
  return NOBLE_SPECS.map(([name, w, u, g, r, k], idx) => {
    const requirement = emptyCost();
    requirement.white = w; requirement.blue = u; requirement.green = g; requirement.red = r; requirement.black = k;
    return { id: `n-${idx}`, points: 3, requirement, name };
  });
}

export function buildAllCards(): { 1: Card[]; 2: Card[]; 3: Card[] } {
  // Reset name cursors so a fresh deck always names cards deterministically.
  for (const t of ['white', 'blue', 'green', 'red', 'black'] as GemType[]) nameCursor[t] = [0, 0, 0];
  return { 1: buildTier(1, TIER1), 2: buildTier(2, TIER2), 3: buildTier(3, TIER3) };
}
