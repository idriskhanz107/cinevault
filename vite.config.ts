import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    sourcemap: false,
    target: 'es2022',
    // The lazy-loaded Watch chunk bundles hls.js (~500 kB), which is only fetched on the player page.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
