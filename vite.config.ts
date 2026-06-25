import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During `npm run dev`, the client runs on 5173 and the game server on 3001.
// We proxy Socket.IO traffic to the server so the browser only talks to 5173.
export default defineConfig({
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
