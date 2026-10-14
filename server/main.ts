import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './app.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
