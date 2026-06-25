// Downloads the cute Pokémon HOME render for every Pokémon used in the deck into
// public/sprites/<id>.png so the game serves them locally (no runtime CDN needed).
// Run: npx tsx server/fetch-sprites.ts
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME_TO_DEX } from '../shared/data.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'public', 'sprites');
const BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home';
// Pixel-sprite fallback for anything missing a HOME render.
const FALLBACK = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

async function exists(p: string) { try { await access(p); return true; } catch { return false; } }

async function fetchOne(id: number): Promise<'ok' | 'fallback' | 'skip' | 'fail'> {
  const dest = path.join(OUT, `${id}.png`);
  if (await exists(dest)) return 'skip';
  for (const [url, kind] of [[`${BASE}/${id}.png`, 'ok'], [`${FALLBACK}/${id}.png`, 'fallback']] as const) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      return kind;
    } catch { /* try next */ }
  }
  return 'fail';
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const ids = [...new Set(Object.values(NAME_TO_DEX))];
  let ok = 0, fb = 0, skip = 0; const failed: number[] = [];
  // Small concurrency to be polite to the CDN.
  const queue = ids.slice();
  async function worker() {
    while (queue.length) {
      const id = queue.shift()!;
      const r = await fetchOne(id);
      if (r === 'ok') ok++; else if (r === 'fallback') fb++; else if (r === 'skip') skip++; else failed.push(id);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`sprites: ${ok} home, ${fb} pixel-fallback, ${skip} already present, ${failed.length} failed${failed.length ? ' -> ' + failed.join(',') : ''}`);
  console.log(`total unique Pokémon: ${ids.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
