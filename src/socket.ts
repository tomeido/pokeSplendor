import { io, type Socket } from 'socket.io-client';

// In dev, Vite proxies /socket.io to the game server (port 3001).
// In production the client is served by the same server, so a default
// same-origin connection works without any URL.
export const socket: Socket = io({ autoConnect: false });

const PID_KEY = 'poke-splendor-pid';
const NAME_KEY = 'poke-splendor-name';

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
