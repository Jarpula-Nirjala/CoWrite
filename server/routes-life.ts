import crypto from 'node:crypto';
import express from 'express';
import type { AppCtx } from './context.ts';
import { HttpError, rateLimit, requireUser, str } from './http.ts';

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS = ['event', 'important', 'task', 'birthday', 'reminder', 'meeting'];
const COLORS = ['blue', 'red', 'green', 'purple', 'orange', 'teal', 'pink', 'gray', 'white', 'yellow'];

interface EventRow {
  id: string;
  title: string;
  notes: string;
  day: string;
  start_time: string | null;
  end_time: string | null;
  color: string;
  kind: string;
  doc_id: string | null;
  remind: boolean;
}
const eventOut = (e: EventRow) => ({ id: e.id, title: e.title, notes: e.notes, day: e.day, start: e.start_time, end: e.end_time, color: e.color, kind: e.kind, docId: e.doc_id, remind: e.remind });

/** Calendar events, Keep notes and the Drive file list. */
export function lifeRoutes(ctx: AppCtx) {
  const r = express.Router();
  const { db } = ctx;

  // ---------------------------------------------------------------- events

  r.get('/events', async (req, res) => {
    const user = requireUser(res);
    const from = DAY.test(String(req.query.from)) ? String(req.query.from) : '0000-01-01';
    const to = DAY.test(String(req.query.to)) ? String(req.query.to) : '9999-12-31';
    const rows = await db.query<EventRow>('select * from events where user_id = $1 and day >= $2 and day <= $3 order by day, start_time nulls first limit 2000', [user.id, from, to]);
    res.json({ events: rows.map(eventOut) });
  });

  const readEvent = (b: Record<string, unknown>) => {
    const title = str(b.title, 200).trim();
    if (!title) throw new HttpError(400, 'Give the event a title.');
    const day = str(b.day, 10);
    if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new HttpError(400, 'Pick a valid date.');
    const start = b.start ? str(b.start, 5) : null;
    const end = b.end ? str(b.end, 5) : null;
    if ((start && !TIME.test(start)) || (end && !TIME.test(end))) throw new HttpError(400, 'Times look like 09:30.');
    if (start && end && end < start) throw new HttpError(400, 'The event ends before it starts.');
    return {
      title,
      day,
      start,
      end,
      notes: str(b.notes, 2000),
      color: COLORS.includes(String(b.color)) ? String(b.color) : 'blue',
      kind: KINDS.includes(String(b.kind)) ? String(b.kind) : 'event',
      remind: b.remind !== false,
      // The browser sends the reminder moment in its own time zone.
      remindAt: Number.isFinite(Number(b.remindAt)) ? Number(b.remindAt) : null,
    };
  };

  r.post('/events', rateLimit(120, 60_000), async (req, res) => {
    const user = requireUser(res);
    const e = readEvent(req.body ?? {});
    const id = newId();
    await db.query(
      'insert into events (id, user_id, title, notes, day, start_time, end_time, color, kind, remind, remind_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
      [id, user.id, e.title, e.notes, e.day, e.start, e.end, e.color, e.kind, e.remind, e.remindAt, Date.now()],
    );
    res.status(201).json({ event: { id, ...e, docId: null } });
  });

  r.put('/events/:eid', async (req, res) => {
    const user = requireUser(res);
    const e = readEvent(req.body ?? {});
    const done = await db.query(
      'update events set title = $3, notes = $4, day = $5, start_time = $6, end_time = $7, color = $8, kind = $9, remind = $10, remind_at = $11, reminded = false where id = $1 and user_id = $2 returning id',
      [String(req.params.eid), user.id, e.title, e.notes, e.day, e.start, e.end, e.color, e.kind, e.remind, e.remindAt],
    );
    if (!done.length) throw new HttpError(404, 'Event not found.');
    res.json({ event: { id: String(req.params.eid), ...e, docId: null } });
  });

  r.delete('/events/:eid', async (req, res) => {
    const user = requireUser(res);
    await db.query('delete from events where id = $1 and user_id = $2', [String(req.params.eid), user.id]);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ Keep notes

  const noteOut = (n: { id: string; title: string; body: string; items: unknown; color: string; pinned: boolean; archived: boolean; labels: unknown; updated_at: number }) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    items: n.items ?? null,
    color: n.color,
    pinned: n.pinned,
    archived: n.archived,
    labels: n.labels ?? [],
    updatedAt: n.updated_at,
  });

  r.get('/notes', async (_req, res) => {
    const user = requireUser(res);
    const rows = await db.query<Parameters<typeof noteOut>[0]>('select * from notes where user_id = $1 order by pinned desc, updated_at desc limit 1000', [user.id]);
    res.json({ notes: rows.map(noteOut) });
  });

  const readNote = (b: Record<string, unknown>) => {
    const items = Array.isArray(b.items)
      ? (b.items as { text?: unknown; done?: unknown }[]).slice(0, 200).map((x) => ({ text: str(x.text, 500), done: x.done === true }))
      : null;
    const labels = Array.isArray(b.labels) ? (b.labels as unknown[]).map((x) => str(x, 30).trim()).filter(Boolean).slice(0, 10) : [];
    return {
      title: str(b.title, 200),
      body: str(b.body, 20_000),
      items,
      color: COLORS.includes(String(b.color)) ? String(b.color) : 'white',
      pinned: b.pinned === true,
      archived: b.archived === true,
      labels,
    };
  };

  r.post('/notes', rateLimit(120, 60_000), async (req, res) => {
    const user = requireUser(res);
    const n = readNote(req.body ?? {});
    if (!n.title.trim() && !n.body.trim() && !n.items?.length) throw new HttpError(400, 'The note is empty.');
    const id = newId();
    const now = Date.now();
    await db.query('insert into notes (id, user_id, title, body, items, color, pinned, archived, labels, updated_at) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10)', [
      id,
      user.id,
      n.title,
      n.body,
      n.items ? JSON.stringify(n.items) : null,
      n.color,
      n.pinned,
      n.archived,
      JSON.stringify(n.labels),
      now,
    ]);
    res.status(201).json({ note: { id, ...n, updatedAt: now } });
  });

  r.put('/notes/:nid', rateLimit(600, 60_000), async (req, res) => {
    const user = requireUser(res);
    const n = readNote(req.body ?? {});
    const now = Date.now();
    const done = await db.query(
      'update notes set title = $3, body = $4, items = $5::jsonb, color = $6, pinned = $7, archived = $8, labels = $9::jsonb, updated_at = $10 where id = $1 and user_id = $2 returning id',
      [String(req.params.nid), user.id, n.title, n.body, n.items ? JSON.stringify(n.items) : null, n.color, n.pinned, n.archived, JSON.stringify(n.labels), now],
    );
    if (!done.length) throw new HttpError(404, 'Note not found.');
    res.json({ note: { id: String(req.params.nid), ...n, updatedAt: now } });
  });

  r.delete('/notes/:nid', async (req, res) => {
    const user = requireUser(res);
    await db.query('delete from notes where id = $1 and user_id = $2', [String(req.params.nid), user.id]);
    res.json({ ok: true });
  });

  // ----------------------------------------------------------------- Drive

  r.get('/me/files', async (_req, res) => {
    const user = requireUser(res);
    const rows = await db.query<{ id: string; name: string; mime: string; size: number; created_at: number; doc_id: string | null; title: string | null }>(
      `select f.id, f.name, f.mime, f.size, f.created_at, f.doc_id, d.title from files f left join documents d on d.id = f.doc_id
       where f.owner_id = $1 order by f.created_at desc limit 1000`,
      [user.id],
    );
    const [used] = await db.query<{ total: number }>('select coalesce(sum(size), 0)::bigint as total from files where owner_id = $1', [user.id]);
    res.json({
      files: rows.map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, createdAt: f.created_at, docId: f.doc_id, docTitle: f.title, url: `/api/files/${f.id}` })),
      used: Number(used?.total ?? 0),
      quota: 60 * 1024 * 1024,
    });
  });

  r.delete('/me/files/:fid', async (req, res) => {
    const user = requireUser(res);
    await db.query('delete from files where id = $1 and owner_id = $2', [String(req.params.fid), user.id]);
    res.json({ ok: true });
  });

  return r;
}

/** Notifications for calendar events whose reminder moment has come. */
export async function runEventReminders(ctx: AppCtx) {
  const now = Date.now();
  const rows = await ctx.db.query<{ id: string; user_id: string; title: string; start_time: string | null; kind: string }>(
    'select id, user_id, title, start_time, kind from events where remind and not reminded and remind_at is not null and remind_at <= $1 and remind_at > $2 limit 200',
    [now, now - 2 * 86_400_000],
  );
  for (const e of rows) {
    await ctx.notifier.add(e.user_id, 'reminder', null, e.kind === 'important' ? '⭐ Important' : 'Calendar', `${e.title}${e.start_time ? ` at ${e.start_time}` : ' today'}`);
    await ctx.db.query('update events set reminded = true where id = $1', [e.id]);
  }
}
