import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During `npm run dev`, the client runs on 5173 and the game server on 3001.
// We proxy Socket.IO traffic to the server so the browser only talks to 5173.
//
// Served at the root in dev; under a sub-path in production when BASE_PATH is set
// (e.g. BASE_PATH=/splendor → base '/splendor/') so asset URLs, sprites, and the
// Socket.IO endpoint all resolve correctly behind a reverse-proxy sub-path.
const base = process.env.BASE_PATH ? `/${process.env.BASE_PATH.replace(/^\/+|\/+$/g, '')}/` : '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
