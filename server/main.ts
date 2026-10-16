import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './app.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Without DATABASE_URL the server runs its own embedded Postgres (PGlite). That needs about 400 MB of
// memory on its own, more than a free Render instance has, and its data is lost on every redeploy.
if (!process.env.DATABASE_URL && process.env.RENDER)
  console.warn('DATABASE_URL is not set: starting the embedded database, which needs about 400 MB of memory and does not survive redeploys. Set DATABASE_URL (for example a free Neon Postgres) in Render → Environment.');

const server = await startServer({
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL || null,
  dataDir: process.env.DATA_DIR ?? path.join(root, 'data'),
  staticDir: path.join(root, 'dist'),
});
console.log(`CoWrite listening on http://localhost:${server.port} (database: ${server.ctx.db.kind})`);

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await server.close();
    process.exit(0);
  });
}
