import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { ROOM_RE, parseClientMsg } from '../shared/protocol.ts';
import { DEFAULT_LIMITS, RoomManager, type RoomLimits } from './rooms.ts';

export interface ServerOptions {
  port: number;
  /** Where room snapshots are written; null keeps everything in memory. */
  dataDir: string | null;
  /** Built client (Vite output). Skipped if it does not exist. */
  staticDir?: string;
  limits?: RoomLimits;
}

export interface RunningServer {
  port: number;
  rooms: RoomManager;
  close(): Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const rooms = new RoomManager(opts.dataDir, opts.limits ?? DEFAULT_LIMITS);
  const app = express();
  app.disable('x-powered-by');

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, rooms: rooms.count });
  });

  const staticDir = opts.staticDir;
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    // Client-side routes (/, /d/:id) all serve the single-page app.
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });
  const alive = new WeakSet<WebSocket>();

  wss.on('connection', (ws, req) => {
    const roomId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('room') ?? '';
    if (!ROOM_RE.test(roomId)) return ws.close(1008, 'invalid room id');
    const room = rooms.open(roomId);
    if (!room) return ws.close(1013, 'server busy');

    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    ws.on('message', (data) => {
      const msg = parseClientMsg(data.toString());
      if (msg) room.handle(ws, msg);
      else ws.send(JSON.stringify({ t: 'error', message: 'malformed message' }));
    });
    ws.on('close', () => {
      room.leave(ws);
      rooms.release(room);
    });
  });

  // Ping every client; drop the ones that stopped answering. This also keeps
  // proxies from closing idle connections.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, 25_000);
  heartbeat.unref();

  await new Promise<void>((resolve) => server.listen(opts.port, resolve));

  return {
    port: (server.address() as AddressInfo).port,
    rooms,
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rooms.close();
    },
  };
}
