import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), '.'),
    },
  },
  server: {
    // This app uses socket.io heavily and Vite's HMR websocket can trigger
    // full-page reloads when alert updates arrive. Keep HMR off here.
    hmr: false,
  },
}));

