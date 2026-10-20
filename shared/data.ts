import type { Card, GemType, Noble } from './types.ts';
import { emptyCost, GEM_TYPES } from './types.ts';

// ── Theming: each Splendor gem colour maps to a Pokémon energy type ──
export const GEM_THEME: Record<GemType, { label: string; icon: string; color: string }> = {
  white: { label: 'Fairy', icon: '✨', color: '#e8a0bf' },
  blue: { label: 'Water', icon: '💧', color: '#3d9be0' },
  green: { label: 'Grass', icon: '🍃', color: '#4caf50' },
  red: { label: 'Fire', icon: '🔥', color: '#e8553a' },
  black: { label: 'Dark', icon: '🌙', color: '#3a3a4a' },
};
export const GOLD_THEME = { label: 'Electric', icon: '⚡', color: '#f4c430' };

// All 251 Kanto / Johto species, plus later favourites, grouped by related types.
// Each species belongs to one pool so a game can draw 90 different Pokémon.
export const POKEMON: Record<GemType, [string[], string[], string[]]> = {
  white: [
    [
      'Pidgey', 'Rattata', 'Spearow', 'Meowth', 'Abra', 'Doduo', 'Drowzee', 'Eevee',
      'Porygon', 'Sentret', 'Hoothoot', 'Cleffa', 'Igglybuff', 'Togepi', 'Natu', 'Marill',
      'Aipom', 'Unown', 'Dunsparce', 'Snubbull', 'Teddiursa', 'Ralts', 'Flabébé', 'Spritzee',
      'Swirlix', 'Cutiefly',
    ],
    [
      'Pidgeotto', 'Raticate', 'Fearow', 'Clefairy', 'Jigglypuff', 'Persian', 'Kadabra', 'Farfetch’d',
      'Dodrio', 'Hypno', 'Lickitung', 'Chansey', 'Mr. Mime', 'Ditto', 'Furret', 'Noctowl',
      'Togetic', 'Xatu', 'Azumarill', 'Wobbuffet', 'Girafarig', 'Granbull', 'Ursaring', 'Porygon2',
      'Stantler', 'Smeargle', 'Miltank', 'Kirlia', 'Floette', 'Aromatisse', 'Slurpuff', 'Ribombee',
    ],
    [
      'Pidgeot', 'Clefable', 'Wigglytuff', 'Alakazam', 'Kangaskhan', 'Tauros', 'Snorlax', 'Mewtwo',
      'Mew', 'Espeon', 'Blissey', 'Lugia', 'Gardevoir', 'Togekiss', 'Florges', 'Sylveon',
    ],
  ],
  blue: [
    [
      'Squirtle', 'Psyduck', 'Poliwag', 'Tentacool', 'Slowpoke', 'Seel', 'Shellder', 'Krabby',
      'Horsea', 'Goldeen', 'Staryu', 'Magikarp', 'Omanyte', 'Kabuto', 'Totodile', 'Chinchou',
      'Wooper', 'Swinub', 'Remoraid', 'Smoochum',
    ],
    [
      'Wartortle', 'Golduck', 'Poliwhirl', 'Dewgong', 'Cloyster', 'Seadra', 'Seaking', 'Jynx',
      'Omastar', 'Kabutops', 'Croconaw', 'Lanturn', 'Quagsire', 'Qwilfish', 'Piloswine', 'Corsola',
      'Octillery', 'Delibird', 'Mantine',
    ],
    [
      'Blastoise', 'Poliwrath', 'Tentacruel', 'Slowbro', 'Kingler', 'Starmie', 'Gyarados', 'Lapras',
      'Vaporeon', 'Articuno', 'Feraligatr', 'Politoed', 'Slowking', 'Kingdra', 'Suicune',
    ],
  ],
  green: [
    [
      'Bulbasaur', 'Caterpie', 'Weedle', 'Ekans', 'Nidoran♀', 'Nidoran♂', 'Zubat', 'Oddish',
      'Paras', 'Venonat', 'Bellsprout', 'Grimer', 'Exeggcute', 'Koffing', 'Chikorita', 'Ledyba',
      'Spinarak', 'Hoppip', 'Sunkern', 'Pineco',
    ],
    [
      'Ivysaur', 'Metapod', 'Kakuna', 'Arbok', 'Nidorina', 'Nidorino', 'Golbat', 'Gloom',
      'Parasect', 'Venomoth', 'Weepinbell', 'Muk', 'Weezing', 'Tangela', 'Scyther', 'Pinsir',
      'Bayleef', 'Ledian', 'Ariados', 'Skiploom', 'Sunflora', 'Yanma', 'Shuckle',
    ],
    [
      'Venusaur', 'Butterfree', 'Beedrill', 'Nidoqueen', 'Nidoking', 'Vileplume', 'Victreebel', 'Exeggutor',
      'Meganium', 'Crobat', 'Bellossom', 'Jumpluff', 'Forretress', 'Scizor', 'Heracross', 'Celebi',
    ],
  ],
  red: [
    [
      'Charmander', 'Vulpix', 'Mankey', 'Growlithe', 'Machop', 'Ponyta', 'Magnemite', 'Voltorb',
      'Cyndaquil', 'Pichu', 'Mareep', 'Slugma', 'Tyrogue', 'Elekid', 'Magby', 'Torchic',
      'Litwick',
    ],
    [
      'Charmeleon', 'Pikachu', 'Ninetales', 'Primeape', 'Arcanine', 'Machoke', 'Rapidash', 'Magneton',
      'Electrode', 'Hitmonlee', 'Hitmonchan', 'Electabuzz', 'Magmar', 'Quilava', 'Flaaffy', 'Magcargo',
      'Hitmontop',
    ],
    [
      'Charizard', 'Raichu', 'Machamp', 'Jolteon', 'Flareon', 'Zapdos', 'Moltres', 'Typhlosion',
      'Ampharos', 'Raikou', 'Entei', 'Ho-Oh',
    ],
  ],
  black: [
    [
      'Sandshrew', 'Diglett', 'Geodude', 'Gastly', 'Cubone', 'Rhyhorn', 'Dratini', 'Murkrow',
      'Misdreavus', 'Gligar', 'Sneasel', 'Houndour', 'Phanpy', 'Larvitar', 'Poochyena', 'Purrloin',
      'Sandile', 'Scraggy', 'Zorua', 'Pawniard', 'Deino', 'Inkay', 'Nickit', 'Impidimp',
    ],
    [
      'Sandslash', 'Dugtrio', 'Graveler', 'Haunter', 'Onix', 'Marowak', 'Rhydon', 'Dragonair',
      'Sudowoodo', 'Houndoom', 'Donphan', 'Pupitar', 'Mightyena', 'Honchkrow', 'Weavile', 'Liepard',
      'Krookodile', 'Scrafty', 'Zoroark', 'Bisharp', 'Malamar',
    ],
    [
      'Golem', 'Gengar', 'Aerodactyl', 'Dragonite', 'Umbreon', 'Steelix', 'Skarmory', 'Tyranitar',
      'Absol', 'Darkrai', 'Hydreigon', 'Yveltal',
    ],
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
  // Additional Kanto / Johto Pokémon.
  Togepi: 175, Marill: 183, Togetic: 176, Azumarill: 184, 'Mr. Mime': 122,
  Totodile: 158, Wooper: 194, Chinchou: 170, Goldeen: 118, Slowpoke: 79, Seel: 86, Shellder: 90, Remoraid: 223,
  Croconaw: 159, Quagsire: 195, Seaking: 119, Dewgong: 87, Cloyster: 91, Octillery: 224, Lanturn: 171,
  Feraligatr: 160, Poliwrath: 62, Politoed: 186, Starmie: 121, Tentacruel: 73, Kingler: 99, Slowbro: 80, Slowking: 199, Suicune: 245,
  Exeggcute: 102, Paras: 46, Skiploom: 188, Sunflora: 192, Parasect: 47, Tangela: 114,
  Meganium: 154, Bellossom: 182, Jumpluff: 189, Exeggutor: 103, Celebi: 251,
  Magby: 240, Magmar: 126, Magcargo: 219, Moltres: 146, Entei: 244, 'Ho-Oh': 250,
  // Later-generation Fairy and Dark favourites.
  Floette: 670, Slurpuff: 685, Ribombee: 743, Togekiss: 468, Florges: 671,
  Deino: 633, Pawniard: 624, Sandile: 551, Scraggy: 559, Inkay: 686,
  Liepard: 510, Bisharp: 625, Krookodile: 553, Scrafty: 560, Malamar: 687, Darkrai: 491, Yveltal: 717,
  // Normal, Psychic and Flying (white) — remaining Kanto / Johto species.
  Pidgey: 16, Pidgeotto: 17, Pidgeot: 18, Rattata: 19, Raticate: 20,
  Spearow: 21, Fearow: 22, Meowth: 52, Persian: 53, Abra: 63,
  Kadabra: 64, Alakazam: 65, 'Farfetch’d': 83, Doduo: 84, Dodrio: 85,
  Drowzee: 96, Hypno: 97, Lickitung: 108, Chansey: 113, Kangaskhan: 115,
  Tauros: 128, Ditto: 132, Eevee: 133, Porygon: 137, Snorlax: 143,
  Mewtwo: 150, Mew: 151, Sentret: 161, Furret: 162, Hoothoot: 163,
  Noctowl: 164, Natu: 177, Xatu: 178, Aipom: 190, Espeon: 196,
  Unown: 201, Wobbuffet: 202, Girafarig: 203, Dunsparce: 206, Teddiursa: 216,
  Ursaring: 217, Porygon2: 233, Stantler: 234, Smeargle: 235, Miltank: 241,
  Blissey: 242, Lugia: 249,
  // Water and Ice (blue) — remaining Kanto / Johto species.
  Jynx: 124, Omanyte: 138, Omastar: 139, Kabuto: 140, Kabutops: 141,
  Articuno: 144, Qwilfish: 211, Swinub: 220, Piloswine: 221, Corsola: 222,
  Delibird: 225, Mantine: 226, Smoochum: 238,
  // Bug and Poison (green) — remaining Kanto / Johto species.
  Caterpie: 10, Metapod: 11, Butterfree: 12, Weedle: 13, Kakuna: 14,
  Beedrill: 15, Ekans: 23, Arbok: 24, 'Nidoran♀': 29, Nidorina: 30,
  Nidoqueen: 31, 'Nidoran♂': 32, Nidorino: 33, Nidoking: 34, Zubat: 41,
  Golbat: 42, Venonat: 48, Venomoth: 49, Grimer: 88, Muk: 89,
  Koffing: 109, Weezing: 110, Scyther: 123, Pinsir: 127, Ledyba: 165,
  Ledian: 166, Spinarak: 167, Ariados: 168, Crobat: 169, Yanma: 193,
  Pineco: 204, Forretress: 205, Scizor: 212, Shuckle: 213, Heracross: 214,
  // Electric and Fighting (red) — remaining Kanto / Johto species.
  Pikachu: 25, Raichu: 26, Mankey: 56, Primeape: 57, Machop: 66,
  Machoke: 67, Machamp: 68, Magnemite: 81, Magneton: 82, Voltorb: 100,
  Electrode: 101, Hitmonlee: 106, Hitmonchan: 107, Electabuzz: 125, Jolteon: 135,
  Zapdos: 145, Pichu: 172, Mareep: 179, Flaaffy: 180, Ampharos: 181,
  Tyrogue: 236, Hitmontop: 237, Elekid: 239, Raikou: 243,
  // Rock, Ground, Ghost, Steel and Dragon (black) — remaining Kanto / Johto species.
  Sandshrew: 27, Sandslash: 28, Diglett: 50, Dugtrio: 51, Geodude: 74,
  Graveler: 75, Golem: 76, Gastly: 92, Haunter: 93, Gengar: 94,
  Onix: 95, Cubone: 104, Marowak: 105, Rhyhorn: 111, Rhydon: 112,
  Aerodactyl: 142, Dratini: 147, Dragonair: 148, Dragonite: 149, Sudowoodo: 185,
  Misdreavus: 200, Gligar: 207, Steelix: 208, Skarmory: 227, Phanpy: 231,
  Donphan: 232, Larvitar: 246, Pupitar: 247,
};

export function spriteUrl(name: string): string | null {
  const id = NAME_TO_DEX[name];
  // Resolve under the client's base URL so sprites load when the app is served
  // from a reverse-proxy sub-path (e.g. /splendor/). BASE_URL is '/' at the root.
  // (Client-only: the server never calls this, so import.meta.env stays untouched.)
  return id ? `${import.meta.env.BASE_URL}sprites/${id}.png` : null;
}

function shuffle<T>(values: T[], random: () => number): T[] {
  const result = values.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pickNames(pool: string[], count: number, random: () => number): string[] {
  const early = shuffle(pool.filter((name) => NAME_TO_DEX[name] <= 251), random);
  // Reserve roughly 80% of slots for Kanto / Johto. Leave at least one open
  // per pool so later generations can still appear as the early roster grows.
  const preferred = early.slice(0, Math.round(count * 0.8));
  const remaining = shuffle(pool.filter((name) => !preferred.includes(name)), random);
  return shuffle([...preferred, ...remaining.slice(0, count - preferred.length)], random);
}

// Compact card spec: [bonus, points, white, blue, green, red, black]
type Spec = [GemType, number, number, number, number, number, number];

function buildTier(tier: 1 | 2 | 3, specs: Spec[], random: () => number): Card[] {
  const names = new Map(GEM_TYPES.map((bonus) => [
    bonus, pickNames(POKEMON[bonus][tier - 1], specs.filter((s) => s[0] === bonus).length, random),
  ]));
  return specs.map((s, idx) => {
    const [bonus, points, w, u, g, r, k] = s;
    const cost = emptyCost();
    cost.white = w; cost.blue = u; cost.green = g; cost.red = r; cost.black = k;
    return { id: `t${tier}-${idx}`, tier, bonus, points, cost, name: names.get(bonus)!.pop()! };
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

export function buildAllCards(random: () => number = Math.random): { 1: Card[]; 2: Card[]; 3: Card[] } {
  return { 1: buildTier(1, TIER1, random), 2: buildTier(2, TIER2, random), 3: buildTier(3, TIER3, random) };
}
