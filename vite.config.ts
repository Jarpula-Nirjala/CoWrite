import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: 'client',
  plugins: [react()],
  // reportCompressedSize off: gzip-measuring every file costs memory, and Render's free plan gives a build 512 MB.
  build: { outDir: '../dist', emptyOutDir: true, reportCompressedSize: false },
  server: {
    fs: { allow: [root] },
    proxy: { '/ws': { target: 'ws://localhost:3000', ws: true } },
  },
});
