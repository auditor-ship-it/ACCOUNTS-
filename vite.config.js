import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Different port from frontend (5173) and lease-management (5180) so all
    // three can run at the same time as genuinely separate dev servers.
    port: 5185,
    proxy: {
      '/api': {
        // Now Accounts & Collection's OWN independent backend (Phase 2 —
        // see splendid-rolling-candy.md), not the shared backend/ on 4000.
        target: process.env.VITE_API_URL || 'http://localhost:4002',
        changeOrigin: true
      }
    }
  }
});
