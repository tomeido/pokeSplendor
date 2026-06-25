// Verifies the AI always produces a legal move and AI-only games terminate.
// Run: npx tsx server/ai.test.ts
import { aiChooseAction, applyAction, createGame, newPlayer } from '../shared/engine.ts';

let bugs = 0;
const fail = (m: string) => { console.error('  ✗', m); bugs++; };

const GAMES = 300;
let finished = 0, totalTurns = 0;

for (let gi = 0; gi < GAMES; gi++) {
  const n = 2 + (gi % 3); // 2,3,4 players, all AI
  const players = Array.from({ length: n }, (_, i) => newPlayer('p' + i, 'CPU' + i, true));
  const g = createGame('AI' + gi, players, 'p0');

  let turns = 0;
  while (g.status === 'playing' && turns < 5000) {
    const pid = g.players[g.current].id;
    const action = aiChooseAction(g);
    let res;
    try { res = applyAction(g, pid, action); }
    catch (e) { fail(`game ${gi}: AI action threw: ${(e as Error).message} (${JSON.stringify(action)})`); break; }
    if (!res.ok) { fail(`game ${gi}: AI produced an illegal move: ${res.error} (${JSON.stringify(action)})`); break; }
    turns++;
  }
  totalTurns += turns;
  if (g.status === 'finished') {
    finished++;
    if (!g.winnerId) fail(`game ${gi}: finished without a winner`);
  } else if (turns >= 5000) {
    fail(`game ${gi}: AI-only game did not terminate`);
  }
}

console.log(`AI self-play: ${finished}/${GAMES} finished, avg ${(totalTurns / GAMES).toFixed(0)} turns/game`);
console.log(bugs ? `\n✗ ${bugs} problem(s) found.` : `\n✓ AI always legal and all games terminated.`);
process.exit(bugs ? 1 : 0);
