/// <reference types="vitest/config" />
// @DecisionRef eng:react-with-vite — the view builds with Vite and its React plugin.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // dev convenience: the thin server owns the files; vite only serves the view
      '/api': 'http://localhost:4181',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
