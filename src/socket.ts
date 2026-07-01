import { io, type Socket } from 'socket.io-client';

// In dev, Vite proxies /socket.io to the game server (port 3001).
// In production the client is served by the same server, so a default
// same-origin connection works without any URL. The path is scoped to the
// app's base URL so it works behind a reverse-proxy sub-path (e.g. /splendor/).
export const socket: Socket = io({ autoConnect: false, path: `${import.meta.env.BASE_URL}socket.io` });

const PID_KEY = 'poke-splendor-pid';
const NAME_KEY = 'poke-splendor-name';
const VISIT_KEY = 'poke-splendor-visited';

/** True the first time this browser ever loads the app; false on every later visit.
 *  Lets the server count unique visitors without storing any per-user identifier. */
export function takeFirstVisit(): boolean {
  try {
    if (localStorage.getItem(VISIT_KEY)) return false;
    localStorage.setItem(VISIT_KEY, '1');
  } catch { return false; }
  return true;
}

export function getPlayerId(): string {
  let id = localStorage.getItem(PID_KEY);
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem(PID_KEY, id);
  }
  return id;
}

export function getSavedName(): string {
  return localStorage.getItem(NAME_KEY) || '';
}

export function saveName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}
