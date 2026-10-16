// `npm run build`: the production client build, kept within the 512 MB Render's free plan gives a build.
// The bundler runs on one thread and the JavaScript heap is capped; this peaks near 440 MB instead of 900.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const r = spawnSync(process.execPath, ['--max-old-space-size=320', vite, 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS ?? '1' },
});
process.exit(r.status ?? 1);
