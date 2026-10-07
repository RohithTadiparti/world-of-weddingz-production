import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev proxy so the SPA can call the API without CORS friction.
      '/api': { target: process.env.VITE_BACKEND_URL || 'http://localhost:3000', changeOrigin: true },
      // Chat, calling and admin counts open same-origin sockets, as they do
      // behind nginx in production.
      '/socket.io': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
