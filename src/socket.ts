import { io, type Socket } from 'socket.io-client';

// In dev, Vite proxies /socket.io to the game server (port 3001).
// In production the client is served by the same server, so a default
// same-origin connection works without any URL. The path is scoped to the
// app's base URL so it works behind a reverse-proxy sub-path (e.g. /splendor/).
export const socket: Socket = io({ autoConnect: false, path: `${import.meta.env.BASE_URL}socket.io` });

const PID_KEY = 'poke-splendor-pid';
const NAME_KEY = 'poke-splendor-name';
const VISIT_KEY = 'poke-splendor-visited';
const ROOM_KEY = 'poke-splendor-room';

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

export function savePlayerId(playerId: string): void {
  localStorage.setItem(PID_KEY, playerId);
}

export function getResumeKey(roomId: string): string | undefined {
  return localStorage.getItem(`poke-splendor-resume:${roomId}`) || undefined;
}

export function saveResumeKey(roomId: string, key: string): void {
  localStorage.setItem(`poke-splendor-resume:${roomId}`, key);
}

export function getSavedRoom(): string {
  return localStorage.getItem(ROOM_KEY) || '';
}

export function saveRoom(roomId: string): void {
  localStorage.setItem(ROOM_KEY, roomId);
}

export function clearSavedRoom(): void {
  localStorage.removeItem(ROOM_KEY);
}
