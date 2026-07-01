// Self-contained Web Audio engine: synthesized sound effects + a looping chiptune.
// Nothing is loaded from disk — every sound is generated at runtime, so it works
// offline and behind a reverse-proxy sub-path without shipping any binary assets.
//
// Browsers block audio until a user gesture, so the AudioContext starts suspended
// and is resumed on the first interaction (see `unlockAudio`). Preferences persist
// to localStorage and can be toggled at any time.

const SFX_KEY = 'poke-splendor-sfx';
const MUSIC_KEY = 'poke-splendor-music';

function load(key: string, dflt: boolean): boolean {
  try { const v = localStorage.getItem(key); return v == null ? dflt : v === '1'; } catch { return dflt; }
}
function save(key: string, on: boolean) { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* ignore */ } }

let sfxOn = load(SFX_KEY, true);
let musicOn = load(MUSIC_KEY, true);

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;

/** Lazily create (and resume) the audio graph. Returns null if Web Audio is unavailable. */
function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = musicOn ? MUSIC_VOL : 0; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.5; sfxGain.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ });
  return ctx;
}

// ── Sound effects ────────────────────────────────────────────────────────────

/** One short synthesized note routed through the SFX bus. */
function blip(freq: number, dur: number, type: OscillatorType, when: number, gain: number) {
  if (!ctx || !sfxGain) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  o.connect(g); g.connect(sfxGain);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.03);
}

export type Sfx = 'click' | 'take' | 'reserve' | 'buy' | 'noble' | 'turn' | 'win' | 'lose' | 'error';

export function playSfx(name: Sfx): void {
  if (!sfxOn) return;
  if (!ensure()) return;
  switch (name) {
    case 'click': blip(420, 0.08, 'square', 0, 0.22); break;
    case 'take': blip(560, 0.09, 'triangle', 0, 0.28); blip(720, 0.08, 'triangle', 0.05, 0.22); break;
    case 'reserve': blip(400, 0.1, 'sawtooth', 0, 0.22); blip(520, 0.1, 'sawtooth', 0.06, 0.18); break;
    case 'buy': [523, 659, 784].forEach((f, i) => blip(f, 0.12, 'square', i * 0.06, 0.28)); break;
    case 'noble': [659, 784, 988, 1319].forEach((f, i) => blip(f, 0.16, 'triangle', i * 0.08, 0.26)); break;
    case 'turn': blip(880, 0.12, 'sine', 0, 0.3); blip(1175, 0.13, 'sine', 0.09, 0.24); break;
    case 'win': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => blip(f, 0.18, 'square', i * 0.11, 0.3)); break;
    case 'lose': [440, 392, 330, 262].forEach((f, i) => blip(f, 0.2, 'triangle', i * 0.12, 0.26)); break;
    case 'error': blip(196, 0.16, 'sawtooth', 0, 0.26); blip(147, 0.18, 'sawtooth', 0.09, 0.22); break;
  }
}

// ── Background music (looping chiptune) ───────────────────────────────────────

const MUSIC_VOL = 0.14;
const TEMPO = 108;
const BEAT = 60 / TEMPO;      // seconds per quarter note
const STEP = BEAT / 2;        // eighth-note resolution
const LOOP_STEPS = 32;        // 4 bars
const BASE = 261.63;          // C4
// A gentle I–V–vi–IV progression (semitone offsets from C, one chord per bar).
const PROG = [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]];

function semi(s: number): number { return BASE * Math.pow(2, s / 12); }

/** One note routed through the music bus (kept separate so it can be muted independently). */
function musicNote(freq: number, t: number, dur: number, type: OscillatorType, gain: number) {
  if (!ctx || !musicGain) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  o.connect(g); g.connect(musicGain);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.03);
}

function scheduleStep(stepIndex: number, t: number) {
  const chord = PROG[Math.floor(stepIndex / 8) % PROG.length];
  // Bass note on each downbeat.
  if (stepIndex % 4 === 0) musicNote(semi(chord[0] - 12), t, BEAT * 0.9, 'triangle', 0.5);
  // Arpeggio walking up the chord on every eighth note.
  const arp = chord[stepIndex % chord.length] + 12;
  musicNote(semi(arp), t, BEAT * 0.42, 'square', 0.22);
}

let musicTimer: ReturnType<typeof setInterval> | null = null;
let nextNoteTime = 0;
let step = 0;

// Look-ahead scheduler: queue any notes due in the next 200ms (setInterval jitter-proof).
function tick() {
  if (!ctx) return;
  while (nextNoteTime < ctx.currentTime + 0.2) {
    scheduleStep(step, nextNoteTime);
    step = (step + 1) % LOOP_STEPS;
    nextNoteTime += STEP;
  }
}

function startMusic() {
  const c = ensure();
  if (!c || musicTimer) return;
  nextNoteTime = c.currentTime + 0.1;
  step = 0;
  musicTimer = setInterval(tick, 60);
  tick();
}

function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}

// ── Public controls ───────────────────────────────────────────────────────────

/** Call from the first user gesture so audio can start (browsers require this). */
export function unlockAudio(): void {
  const c = ensure();
  if (!c) return;
  if (musicOn) startMusic();
}

export function setSfx(on: boolean): void {
  sfxOn = on;
  save(SFX_KEY, on);
  if (on) ensure();
}

export function setMusic(on: boolean): void {
  musicOn = on;
  save(MUSIC_KEY, on);
  const c = ensure();
  if (c && musicGain) musicGain.gain.setTargetAtTime(on ? MUSIC_VOL : 0, c.currentTime, 0.05);
  if (on) startMusic(); else stopMusic();
}

export function getAudioPrefs(): { sfx: boolean; music: boolean } {
  return { sfx: sfxOn, music: musicOn };
}
