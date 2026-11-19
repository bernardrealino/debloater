import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The UI lives in web/. `npm run build:web` writes web/dist, which the server serves
// (and which the exe build embeds). `npm run dev:web` runs the UI with hot reload and
// forwards API calls to `npm start`.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8710' },
  },
});
