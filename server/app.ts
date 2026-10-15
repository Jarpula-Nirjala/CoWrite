import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Snapshot } from '../shared/crdt.ts';
import { ROOM_RE, parseClientMsg, type ChatMessage, type PeerInfo } from '../shared/protocol.ts';
import { DELETED_CODE, FORBIDDEN_CODE } from '../shared/sync-client.ts';
import { AiHub } from './ai.ts';
import { Vault } from './secrets.ts';
import { Auth, AuthError, type User } from './auth.ts';
import type { AppCtx } from './context.ts';
import { openDb } from './db.ts';
import { Docs, newId } from './docs.ts';
import { HttpError, SESSION_COOKIE, readCookie } from './http.ts';
import { Notifier } from './notify.ts';
import { DEFAULT_LIMITS, RoomManager, type RoomHooks, type RoomLimits } from './rooms.ts';
import { authRoutes } from './routes-auth.ts';
import { collabRoutes } from './routes-collab.ts';
import { docRoutes } from './routes-docs.ts';
import { meRoutes } from './routes-me.ts';
import { mediaRoutes } from './routes-media.ts';
import { aiRoutes, syncTranslation } from './routes-ai.ts';
import { indexTasks, listLocks, runReminders, teamRoutes } from './routes-team.ts';
import { extraRoutes, runDigests } from './routes-extra.ts';
import { lifeRoutes, runEventReminders } from './routes-life.ts';
import { toolRoutes } from './routes-tools.ts';
import { integrationRoutes } from './routes-integrations.ts';
import { loadOAuthClients } from './oauth.ts';

export interface ServerOptions {
  port: number;
  /** Postgres connection string; when absent PGlite is used. */
  databaseUrl?: string | null;
  /** PGlite data directory; null keeps the database in memory (tests). */
  dataDir: string | null;
  /** Built client (Vite output). Skipped if it does not exist. */
  staticDir?: string;
  limits?: RoomLimits;
}

export interface RunningServer {
  port: number;
  ctx: AppCtx;
  close(): Promise<void>;
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const db = await openDb({ url: opts.databaseUrl, dir: opts.dataDir && path.join(opts.dataDir, 'pglite') });
  const auth = new Auth(db);
  const docs = new Docs(db);
  const notifier = new Notifier(db);

  // Edits are counted in memory and written in small batches.
  const activity = new Map<string, { doc: string; site: string; day: string; userId: string | null; name: string; inserts: number; deletes: number }>();
  const lastTouch = new Map<string, number>();
  const lastCheckpoint = new Map<string, number>();
  const encryptedRooms = new Set<string>();

  const hooks: RoomHooks = {
    async load(roomId) {
      const [row] = await db.query<{ snapshot: Snapshot }>('select snapshot from rooms where id = $1', [roomId]);
      const doc = await docs.get(roomId);
      if (doc?.encrypted) encryptedRooms.add(roomId);
      const locks = doc ? (await listLocks(ctx, roomId)).map((l) => ({ start: l.anchor_start, end: l.anchor_end, owner: l.created_by })) : [];
      return { snapshot: row?.snapshot ?? null, encrypted: doc?.encrypted ?? false, locks };
    },
    async save(roomId, snapshot, text) {
      await db.query(
        `insert into rooms (id, snapshot, updated_at) values ($1, $2::jsonb, $3)
         on conflict (id) do update set snapshot = excluded.snapshot, updated_at = excluded.updated_at`,
        [roomId, JSON.stringify(snapshot), Date.now()],
      );
      if (text !== null) {
        await db.query('update documents set content_text = $2 where id = $1', [roomId, text.replace(/￼/g, '')]);
        const room = rooms.loaded(roomId);
        if (room && !room.encrypted) await indexTasks(ctx, roomId, room.doc.tokens()).catch((err) => console.error('task index failed:', err));
      }
    },
    joined(roomId, peer) {
      void db
        .query(
          `insert into sites (doc_id, site, user_id, name, color, first_seen) values ($1, $2, $3, $4, $5, $6)
           on conflict (doc_id, site) do update set name = excluded.name, color = excluded.color`,
          [roomId, peer.site, peer.userId, peer.name, peer.color, Date.now()],
        )
        .catch((err) => console.error(err));
      if (peer.userId) void docs.seen(roomId, peer.userId).catch(() => {});
    },
    left(roomId, peer) {
      if (peer.userId) void docs.seen(roomId, peer.userId).catch(() => {});
    },
    edited(roomId, peer, inserts, deletes) {
      const now = Date.now();
      scheduleTranslations(roomId);
      // A checkpoint (time -> state vector) at most once a minute powers "compare any two moments".
      if (now - (lastCheckpoint.get(roomId) ?? 0) > 60_000) {
        lastCheckpoint.set(roomId, now);
        setTimeout(() => {
          const room = rooms.loaded(roomId);
          if (room) void db.query('insert into checkpoints (doc_id, at, vector) values ($1, $2, $3::jsonb) on conflict do nothing', [roomId, Date.now(), JSON.stringify(room.doc.vector)]).catch(() => {});
        }, 5_000);
      }
      const site = peer?.site ?? 'merge';
      const key = `${roomId}|${site}|${dayKey(now)}`;
      const a = activity.get(key) ?? { doc: roomId, site, day: dayKey(now), userId: peer?.userId ?? null, name: peer?.name ?? 'Merge', inserts: 0, deletes: 0 };
      a.inserts += inserts;
      a.deletes += deletes;
      activity.set(key, a);
      if (now - (lastTouch.get(roomId) ?? 0) > 10_000) {
        lastTouch.set(roomId, now);
        void docs.touch(roomId).catch(() => {});
      }
    },
    async chat(roomId, peer: PeerInfo, body): Promise<ChatMessage> {
      const msg: ChatMessage = { id: newId(), authorId: peer.userId, authorName: peer.name, color: peer.color, body, createdAt: Date.now() };
      await db.query('insert into messages (id, doc_id, author_id, author_name, color, body, created_at) values ($1, $2, $3, $4, $5, $6, $7)', [
        msg.id,
        roomId,
        msg.authorId,
        msg.authorName,
        msg.color,
        msg.body,
        msg.createdAt,
      ]);
      if (!encryptedRooms.has(roomId)) {
        const usernames = Notifier.mentions(body);
        const doc = usernames.length ? await docs.get(roomId) : null;
        if (doc) {
          const people = await db.query<{ id: string }>(
            `select u.id from users u where u.username = any($1) and (u.id = $2 or exists
               (select 1 from doc_members m where m.doc_id = $3 and m.user_id = u.id))`,
            [usernames, doc.owner_id, roomId],
          );
          for (const p of people) if (p.id !== peer.userId) await notifier.add(p.id, 'mention', roomId, peer.name, `mentioned you in the chat on “${doc.title}”`);
        }
      }
      return msg;
    },
  };

  async function flushActivity() {
    const batch = [...activity.values()];
    activity.clear();
    for (const a of batch) {
      await db
        .query(
          `insert into activity (doc_id, site, day, user_id, name, inserts, deletes) values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (doc_id, site, day) do update set inserts = activity.inserts + excluded.inserts, deletes = activity.deletes + excluded.deletes, name = excluded.name`,
          [a.doc, a.site, a.day, a.userId, a.name, a.inserts, a.deletes],
        )
        .catch((err) => console.error('activity flush failed:', err));
    }
  }

  const rooms = new RoomManager(hooks, opts.limits ?? DEFAULT_LIMITS);
  const vault = new Vault(db);
  await loadOAuthClients(db, vault).catch((err) => console.error('Could not load saved sign-in settings:', err));
  const ctx: AppCtx = { db, auth, docs, rooms, notifier, ai: new AiHub(db, vault), vault };

  // Linked translations follow their source a little after edits stop.
  const translationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function scheduleTranslations(sourceId: string) {
    clearTimeout(translationTimers.get(sourceId));
    translationTimers.set(
      sourceId,
      setTimeout(async () => {
        translationTimers.delete(sourceId);
        const targets = await db.query<{ id: string }>('select id from documents where translated_from = $1 and deleted_at is null', [sourceId]).catch(() => []);
        for (const t of targets) await syncTranslation(ctx, t.id).catch((err) => console.error('translation sync failed:', err));
      }, 20_000),
    );
  }

  const timers = [
    setInterval(() => void flushActivity(), 10_000),
    setInterval(() => void runReminders(ctx).catch((err) => console.error('reminders failed:', err)), 60_000),
    setInterval(() => void runEventReminders(ctx).catch((err) => console.error('event reminders failed:', err)), 60_000),
    setInterval(() => void runDigests(ctx, process.env.PUBLIC_URL?.replace(/\/+$/, '') || `http://localhost:${process.env.PORT ?? 3000}`).catch((err) => console.error('digests failed:', err)), 5 * 60_000),
    // Trash older than 30 days is deleted for good.
    setInterval(() => void docs.expiredTrash().then((ids) => docs.purge(ids)).catch(() => {}), 6 * 3600_000),
  ];
  for (const t of timers) t.unref();
  void docs.expiredTrash().then((ids) => docs.purge(ids)).catch(() => {});

  // ---------------------------------------------------------------- HTTP

  const app = express();
  app.disable('x-powered-by');
  // Render (and most hosts) terminate TLS at a proxy; trust it for req.secure / req.ip.
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, rooms: rooms.count, database: db.kind });
  });

  const api = express.Router();
  // Uploads and emails with attachments parse their own (larger) bodies.
  api.use((req, res, next) => ((req.path === '/files' || req.path === '/gmail/send') && req.method === 'POST' ? next() : express.json({ limit: '600kb' })(req, res, next)));
  api.use(async (req, res, next) => {
    try {
      res.locals.user = await auth.userForToken(readCookie(req.headers.cookie, SESSION_COOKIE));
      next();
    } catch (err) {
      next(err);
    }
  });
  api.use('/auth', authRoutes(ctx));
  api.use(docRoutes(ctx));
  api.use(collabRoutes(ctx));
  api.use(meRoutes(ctx));
  api.use(mediaRoutes(ctx));
  api.use(aiRoutes(ctx));
  api.use(teamRoutes(ctx));
  api.use(extraRoutes(ctx));
  api.use(lifeRoutes(ctx));
  api.use(toolRoutes(ctx));
  api.use(integrationRoutes(ctx));
  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError || err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const status = (err as { status?: number }).status;
    if (status && status < 500) {
      res.status(status).json({ error: 'Invalid request.' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  app.use('/api', api);

  const staticDir = opts.staticDir;
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(
      express.static(staticDir, {
        index: false,
        setHeaders(res, file) {
          // Hashed assets are immutable; the service worker must always be revalidated.
          if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    // Client-side routes all serve the single-page app.
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  // ----------------------------------------------------------- WebSocket

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });
  const alive = new WeakSet<WebSocket>();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const roomId = url.searchParams.get('room') ?? '';
    if (!ROOM_RE.test(roomId)) return ws.close(1008, 'invalid room id');
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));

    // Resolve who this is and what they may do before handling messages;
    // messages that arrive meanwhile wait on the same promise, in order.
    const ready = (async () => {
      const user: User | null = await auth.userForToken(readCookie(req.headers.cookie, SESSION_COOKIE));
      const access = await docs.roleFor(roomId, user, url.searchParams.get('s'));
      const doc = access.doc;
      // Live translations are written by the translator only.
      const role = doc?.translated_from && (access.role === 'editor' || access.role === 'owner') ? 'commenter' : access.role;
      if (!role) {
        ws.close(doc?.deleted_at ? DELETED_CODE : FORBIDDEN_CODE, 'no access');
        return null;
      }
      const room = await rooms.open(roomId);
      if (!room) {
        ws.close(1013, 'server busy');
        return null;
      }
      room.attach(ws, { role, userId: user?.id ?? null });
      return room;
    })().catch((err) => {
      console.error('connection setup failed:', err);
      ws.close(1011, 'server error');
      return null;
    });

    ws.on('message', (data) => {
      void ready.then((room) => {
        if (!room) return;
        const msg = parseClientMsg(data.toString());
        if (msg) room.handle(ws, msg);
        else ws.send(JSON.stringify({ t: 'error', message: 'malformed message' }));
      });
    });
    ws.on('close', () => {
      void ready.then((room) => {
        if (!room) return;
        room.leave(ws);
        rooms.release(room);
      });
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
    ctx,
    async close() {
      clearInterval(heartbeat);
      for (const t of timers) clearInterval(t);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rooms.close();
      await flushActivity();
      await db.close();
    },
  };
}
