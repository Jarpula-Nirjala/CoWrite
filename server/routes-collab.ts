import express from 'express';
import type { Id } from '../shared/crdt.ts';
import { isId } from '../shared/protocol.ts';
import { actorName, docAccess, type Access, type AppCtx } from './context.ts';
import { newId } from './docs.ts';
import { HttpError, str } from './http.ts';
import { Notifier } from './notify.ts';

const KEY_RE = /^[A-Za-z0-9_-]{1,32}:\d{1,15}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_BODY = 4000;

interface CommentRow {
  id: string;
  parent_id: string | null;
  anchor_start: Id | null;
  anchor_end: Id | null;
  quote: string;
  body: string;
  author_id: string | null;
  author_name: string;
  color: string;
  resolved: boolean;
  created_at: number;
}

interface SuggestionRow {
  id: string;
  kind: 'insert' | 'delete';
  item_keys: string[];
  author_id: string | null;
  author_name: string;
  color: string;
  status: string;
  created_at: number;
}

const commentJson = (c: CommentRow) => ({
  id: c.id,
  parentId: c.parent_id,
  anchorStart: c.anchor_start,
  anchorEnd: c.anchor_end,
  quote: c.quote,
  body: c.body,
  authorId: c.author_id,
  authorName: c.author_name,
  color: c.color,
  resolved: c.resolved,
  createdAt: c.created_at,
});

const suggestionJson = (s: SuggestionRow) => ({
  id: s.id,
  kind: s.kind,
  keys: s.item_keys,
  authorId: s.author_id,
  authorName: s.author_name,
  color: s.color,
  status: s.status,
  createdAt: s.created_at,
});

const cleanKeys = (keys: unknown, max = 5000): string[] => {
  if (!Array.isArray(keys) || keys.length > max || !keys.every((k) => typeof k === 'string' && KEY_RE.test(k))) {
    throw new HttpError(400, 'Invalid character ids.');
  }
  return keys as string[];
};

export function collabRoutes(ctx: AppCtx) {
  const r = express.Router();
  const { db, notifier, rooms } = ctx;
  const notify = (a: Access, topic: 'comments' | 'suggestions' | 'versions') => rooms.loaded(a.docId)?.notify(topic);

  /** Notify @mentioned people who can see the document. */
  async function notifyMentions(a: Access, usernames: string[], what: string) {
    if (!a.doc || !usernames.length) return;
    const people = await db.query<{ id: string; username: string }>(
      `select u.id, u.username from users u where u.username = any($1) and (u.id = $2 or exists
         (select 1 from doc_members m where m.doc_id = $3 and m.user_id = u.id))`,
      [usernames, a.doc.owner_id, a.docId],
    );
    for (const p of people) {
      if (p.id !== a.user?.id) await notifier.add(p.id, 'mention', a.docId, actorName(a), `mentioned you in ${what} on “${a.doc.title}”`);
    }
  }

  const mentionList = (body: string, explicit: unknown): string[] => {
    const fromClient = Array.isArray(explicit) ? explicit.filter((m): m is string => typeof m === 'string').map((m) => m.toLowerCase()).slice(0, 10) : [];
    return [...new Set([...fromClient, ...Notifier.mentions(body)])];
  };

  // ------------------------------------------------------------ comments

  r.get('/docs/:id/comments', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer');
    const rows = await db.query<CommentRow>('select * from comments where doc_id = $1 order by created_at', [a.docId]);
    res.json({ comments: rows.map(commentJson) });
  });

  r.post('/docs/:id/comments', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'commenter');
    const b = req.body ?? {};
    const body = str(b.body, MAX_BODY).trim();
    if (!body) throw new HttpError(400, 'Write a comment first.');
    const parentId = b.parentId ? str(b.parentId, 20) : null;
    let parent: CommentRow | undefined;
    if (parentId) {
      [parent] = await db.query<CommentRow>('select * from comments where id = $1 and doc_id = $2', [parentId, a.docId]);
      if (!parent) throw new HttpError(404, 'That comment no longer exists.');
    } else if (!isId(b.anchorStart) || !isId(b.anchorEnd)) {
      throw new HttpError(400, 'Select the text you want to comment on.');
    }
    const color = typeof b.color === 'string' && COLOR_RE.test(b.color) ? b.color : '#1f3a68';
    const [row] = await db.query<CommentRow>(
      `insert into comments (id, doc_id, parent_id, anchor_start, anchor_end, quote, body, author_id, author_name, color, created_at)
       values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11) returning *`,
      [
        newId(),
        a.docId,
        parentId,
        parentId ? null : JSON.stringify(b.anchorStart),
        parentId ? null : JSON.stringify(b.anchorEnd),
        parentId ? '' : str(b.quote, 2000),
        body,
        a.user?.id ?? null,
        actorName(a, b.name),
        color,
        Date.now(),
      ],
    );
    notify(a, 'comments');
    if (a.doc) {
      const title = a.doc.title;
      if (parent?.author_id && parent.author_id !== a.user?.id) {
        await notifier.add(parent.author_id, 'reply', a.docId, actorName(a, b.name), `replied to your comment on “${title}”`);
      }
      if (a.doc.owner_id !== a.user?.id && a.doc.owner_id !== parent?.author_id) {
        await notifier.add(a.doc.owner_id, 'comment', a.docId, actorName(a, b.name), `commented on “${title}”`);
      }
      await notifyMentions(a, mentionList(a.doc.encrypted ? '' : body, b.mentions), 'a comment');
    }
    res.status(201).json({ comment: commentJson(row) });
  });

  r.patch('/docs/:id/comments/:cid', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'commenter');
    const [c] = await db.query<CommentRow>('select * from comments where id = $1 and doc_id = $2', [String(req.params.cid), a.docId]);
    if (!c) throw new HttpError(404, 'Comment not found.');
    const mine = c.author_id !== null && c.author_id === a.user?.id;
    if (req.body?.resolved !== undefined) {
      await db.query('update comments set resolved = $2 where id = $1', [c.id, req.body.resolved === true]);
    }
    if (req.body?.body !== undefined) {
      if (!mine) throw new HttpError(403, 'You can only edit your own comments.');
      const body = str(req.body.body, MAX_BODY).trim();
      if (!body) throw new HttpError(400, 'Comments cannot be empty.');
      await db.query('update comments set body = $2 where id = $1', [c.id, body]);
    }
    notify(a, 'comments');
    res.json({ ok: true });
  });

  r.delete('/docs/:id/comments/:cid', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'commenter');
    const [c] = await db.query<CommentRow>('select * from comments where id = $1 and doc_id = $2', [String(req.params.cid), a.docId]);
    if (!c) throw new HttpError(404, 'Comment not found.');
    if (!(c.author_id && c.author_id === a.user?.id) && a.role !== 'owner') throw new HttpError(403, 'You can only delete your own comments.');
    await db.query('delete from comments where doc_id = $1 and (id = $2 or parent_id = $2)', [a.docId, c.id]);
    notify(a, 'comments');
    res.json({ ok: true });
  });

  // --------------------------------------------------------- suggestions

  r.get('/docs/:id/suggestions', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer');
    const rows = await db.query<SuggestionRow>("select * from suggestions where doc_id = $1 and status = 'open' order by created_at", [a.docId]);
    res.json({ suggestions: rows.map(suggestionJson) });
  });

  r.post('/docs/:id/suggestions', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'editor');
    const kind = req.body?.kind;
    if (kind !== 'insert' && kind !== 'delete') throw new HttpError(400, 'Invalid suggestion.');
    const keys = cleanKeys(req.body?.keys);
    if (!keys.length) throw new HttpError(400, 'Empty suggestion.');
    const color = typeof req.body?.color === 'string' && COLOR_RE.test(req.body.color) ? req.body.color : '#2e7d5b';
    const [row] = await db.query<SuggestionRow>(
      `insert into suggestions (id, doc_id, kind, item_keys, author_id, author_name, color, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [newId(), a.docId, kind, keys, a.user?.id ?? null, actorName(a, req.body?.name), color, Date.now()],
    );
    notify(a, 'suggestions');
    if (a.doc && a.doc.owner_id !== a.user?.id) {
      await notifier.add(a.doc.owner_id, 'suggestion', a.docId, actorName(a, req.body?.name), `suggested an edit in “${a.doc.title}”`);
    }
    res.status(201).json({ suggestion: suggestionJson(row) });
  });

  r.patch('/docs/:id/suggestions/:sid', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'editor');
    const [s] = await db.query<SuggestionRow>('select * from suggestions where id = $1 and doc_id = $2', [String(req.params.sid), a.docId]);
    if (!s) throw new HttpError(404, 'Suggestion not found.');
    if (req.body?.addKeys !== undefined) {
      if (s.author_id !== (a.user?.id ?? null) && s.author_id !== null) throw new HttpError(403, 'Not your suggestion.');
      const add = cleanKeys(req.body.addKeys);
      if (s.item_keys.length + add.length > 20_000) throw new HttpError(400, 'Suggestion too large.');
      await db.query('update suggestions set item_keys = item_keys || $2::text[] where id = $1', [s.id, add]);
    }
    const status = req.body?.status;
    if (status !== undefined) {
      if (status !== 'accepted' && status !== 'rejected') throw new HttpError(400, 'Invalid status.');
      await db.query('update suggestions set status = $2 where id = $1', [s.id, status]);
    }
    notify(a, 'suggestions');
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- chat

  r.get('/docs/:id/messages', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer');
    const rows = await db.query<{ id: string; author_id: string | null; author_name: string; color: string; body: string; created_at: number }>(
      'select * from (select * from messages where doc_id = $1 order by created_at desc limit 200) m order by created_at',
      [a.docId],
    );
    res.json({
      messages: rows.map((m) => ({ id: m.id, authorId: m.author_id, authorName: m.author_name, color: m.color, body: m.body, createdAt: m.created_at })),
    });
  });

  // ------------------------------------------------------------ versions

  r.get('/docs/:id/versions', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer');
    const rows = await db.query<{ id: string; name: string; size: number; author_name: string; created_at: number }>(
      'select id, name, size, author_name, created_at from versions where doc_id = $1 order by created_at desc',
      [a.docId],
    );
    res.json({ versions: rows.map((v) => ({ id: v.id, name: v.name, size: v.size, authorName: v.author_name, createdAt: v.created_at })) });
  });

  r.post('/docs/:id/versions', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'editor');
    const name = str(req.body?.name, 80).trim() || `Version of ${new Date().toUTCString().slice(5, 22)}`;
    const room = await rooms.open(a.docId);
    if (!room) throw new HttpError(503, 'Server busy, try again.');
    const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from versions where doc_id = $1', [a.docId]);
    if (n >= 100) throw new HttpError(400, 'A document can keep up to 100 named versions. Delete some first.');
    const [v] = await db.query<{ id: string; name: string; size: number; author_name: string; created_at: number }>(
      `insert into versions (id, doc_id, name, snapshot, size, author_name, created_at)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7) returning id, name, size, author_name, created_at`,
      [newId(), a.docId, name, JSON.stringify(room.doc.snapshot()), room.doc.length, actorName(a, req.body?.authorName), Date.now()],
    );
    notify(a, 'versions');
    res.status(201).json({ version: { id: v.id, name: v.name, size: v.size, authorName: v.author_name, createdAt: v.created_at } });
  });

  r.get('/docs/:id/versions/:vid', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer');
    const [v] = await db.query<{ snapshot: unknown; name: string }>('select snapshot, name from versions where id = $1 and doc_id = $2', [
      String(req.params.vid),
      a.docId,
    ]);
    if (!v) throw new HttpError(404, 'Version not found.');
    res.json({ name: v.name, snapshot: v.snapshot });
  });

  r.delete('/docs/:id/versions/:vid', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'editor');
    await db.query('delete from versions where id = $1 and doc_id = $2', [String(req.params.vid), a.docId]);
    notify(a, 'versions');
    res.json({ ok: true });
  });

  // ------------------------------------------------- authors & people

  /** Who typed under each site id: powers authorship colours and replay. */
  r.get('/docs/:id/authors', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer');
    const rows = await db.query<{ site: string; user_id: string | null; name: string; color: string }>(
      'select site, user_id, name, color from sites where doc_id = $1',
      [a.docId],
    );
    res.json({ authors: rows.map((s) => ({ site: s.site, userId: s.user_id, name: s.name, color: s.color })) });
  });

  /** People who can be @mentioned. */
  r.get('/docs/:id/people', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer');
    if (!a.doc) {
      res.json({ people: [] });
      return;
    }
    const rows = await db.query<{ id: string; name: string; username: string; avatar: string | null }>(
      `select u.id, u.name, u.username, u.avatar from users u where u.id = $1
       union select u.id, u.name, u.username, u.avatar from doc_members m join users u on u.id = m.user_id where m.doc_id = $2`,
      [a.doc.owner_id, a.docId],
    );
    res.json({ people: rows });
  });

  return r;
}

