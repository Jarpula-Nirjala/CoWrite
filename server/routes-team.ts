import crypto from 'node:crypto';
import express from 'express';
import type { Id, Token } from '../shared/crdt.ts';
import { tasksOf } from '../shared/rich.ts';
import { actorName, docAccess, type AppCtx } from './context.ts';
import { HttpError, rateLimit, requireUser, str } from './http.ts';

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const isId = (x: unknown): x is Id => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && Number.isInteger(x[1]);
const EMOJI = ['👍', '❤️', '🎉', '😂', '🤔', '👀', '🔥', '✅'];

export interface LockRow {
  id: string;
  anchor_start: Id;
  anchor_end: Id;
  quote: string;
  created_by: string | null;
  created_name: string;
  created_at: number;
}

/** Workflow, locks, reactions, tasks, reminders, drafts, workspaces, checkpoints and public comments. */
export function teamRoutes(ctx: AppCtx) {
  const r = express.Router();
  const { db, rooms, docs, notifier } = ctx;

  // ------------------------------------------------------------ checkpoints

  r.get('/docs/:id/checkpoints', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const rows = await db.query<{ at: number; vector: Record<string, number> }>('select at, vector from checkpoints where doc_id = $1 order by at', [a.docId]);
    // Keep at most ~400 points, always including the newest.
    const step = Math.max(1, Math.ceil(rows.length / 400));
    const thin = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
    res.json({ checkpoints: thin });
  });

  // ------------------------------------------------------------------ locks

  r.get('/docs/:id/locks', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    res.json({ locks: (await listLocks(ctx, a.docId)).map(lockOut) });
  });

  r.post('/docs/:id/locks', rateLimit(60, 60_000), async (req, res) => {
    const a = await docAccess(ctx, req, res, 'editor', { registered: true });
    const user = requireUser(res);
    const { start, end } = req.body ?? {};
    if (!isId(start) || !isId(end)) throw new HttpError(400, 'Select the paragraphs to lock.');
    const id = newId();
    await db.query('insert into locks (id, doc_id, anchor_start, anchor_end, quote, created_by, created_name, created_at) values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8)', [
      id,
      a.docId,
      JSON.stringify(start),
      JSON.stringify(end),
      str(req.body?.quote, 200),
      user.id,
      user.name,
      Date.now(),
    ]);
    await refreshLocks(ctx, a.docId);
    res.status(201).json({ id });
  });

  r.delete('/docs/:id/locks/:lid', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'editor', { registered: true });
    const user = requireUser(res);
    const [l] = await db.query<{ created_by: string | null }>('select created_by from locks where id = $1 and doc_id = $2', [String(req.params.lid), a.docId]);
    if (!l) throw new HttpError(404, 'Lock not found.');
    if (l.created_by !== user.id && a.role !== 'owner') throw new HttpError(403, 'Only the person who locked it or the owner can unlock it.');
    await db.query('delete from locks where id = $1', [String(req.params.lid)]);
    await refreshLocks(ctx, a.docId);
    res.json({ ok: true });
  });

  // -------------------------------------------------------------- reactions

  r.get('/docs/:id/reactions', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const rows = await db.query<{ target: string; emoji: string; who: string; name: string }>('select target, emoji, who, name from reactions where doc_id = $1 order by created_at', [a.docId]);
    const me = a.user?.id ?? str(req.query.guest, 64);
    const map = new Map<string, { target: string; emoji: string; count: number; mine: boolean; names: string[] }>();
    for (const row of rows) {
      const k = `${row.target}|${row.emoji}`;
      const e = map.get(k) ?? { target: row.target, emoji: row.emoji, count: 0, mine: false, names: [] };
      e.count++;
      e.mine ||= row.who === me;
      e.names.push(row.name);
      map.set(k, e);
    }
    res.json({ reactions: [...map.values()] });
  });

  r.post('/docs/:id/reactions', rateLimit(120, 60_000), async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const target = str(req.body?.target, 80);
    const emoji = str(req.body?.emoji, 8);
    if (!target || !EMOJI.includes(emoji)) throw new HttpError(400, 'Pick a reaction.');
    const who = a.user?.id ?? `guest:${str(req.body?.guest, 40) || 'anon'}`;
    const removed = await db.query('delete from reactions where doc_id = $1 and target = $2 and emoji = $3 and who = $4 returning who', [a.docId, target, emoji, who]);
    if (!removed.length) {
      await db.query('insert into reactions (doc_id, target, emoji, who, name, created_at) values ($1, $2, $3, $4, $5, $6)', [a.docId, target, emoji, who, actorName(a, req.body?.name), Date.now()]);
    }
    rooms.loaded(a.docId)?.notify('reactions');
    res.json({ on: !removed.length });
  });

  // -------------------------------------------------------------- workflow

  r.get('/docs/:id/workflow', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const approvals = await db.query<{ user_id: string; name: string; decision: string; note: string; at: number }>(
      'select a.user_id, u.name, a.decision, a.note, a.at from approvals a join users u on u.id = a.user_id where a.doc_id = $1 order by a.at desc',
      [a.docId],
    );
    res.json({ status: a.doc!.status ?? 'draft', approvals: approvals.map((x) => ({ userId: x.user_id, name: x.name, decision: x.decision, note: x.note, at: x.at })) });
  });

  r.post('/docs/:id/workflow', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'editor', { registered: true });
    const user = requireUser(res);
    const status = str(req.body?.status, 20);
    if (status !== 'draft' && status !== 'review') throw new HttpError(400, 'Invalid status.');
    if (status === 'review') await db.query('delete from approvals where doc_id = $1', [a.docId]);
    await docs.update(a.docId, { status });
    if (status === 'review') {
      const reviewers = (await docs.members(a.docId)).filter((m) => m.user_id !== user.id && m.role !== 'viewer');
      const owner = a.doc!.owner_id !== user.id ? [a.doc!.owner_id] : [];
      for (const id of [...new Set([...owner, ...reviewers.map((m) => m.user_id)])]) await notifier.add(id, 'review', a.docId, user.name, `asked you to review “${a.doc!.title}”`);
    }
    rooms.loaded(a.docId)?.notify('workflow');
    rooms.loaded(a.docId)?.notify('meta');
    res.json({ status });
  });

  r.post('/docs/:id/approve', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'commenter', { registered: true });
    const user = requireUser(res);
    const decision = str(req.body?.decision, 20);
    if (decision !== 'approved' && decision !== 'changes') throw new HttpError(400, 'Approve or request changes.');
    if ((a.doc!.status ?? 'draft') === 'draft') throw new HttpError(400, 'This document has not been sent for review.');
    await db.query(
      `insert into approvals (doc_id, user_id, decision, note, at) values ($1, $2, $3, $4, $5)
       on conflict (doc_id, user_id) do update set decision = excluded.decision, note = excluded.note, at = excluded.at`,
      [a.docId, user.id, decision, str(req.body?.note, 500), Date.now()],
    );
    const all = await db.query<{ decision: string }>('select decision from approvals where doc_id = $1', [a.docId]);
    const status = all.some((x) => x.decision === 'changes') ? 'changes' : 'approved';
    await docs.update(a.docId, { status });
    if (a.doc!.owner_id !== user.id) await notifier.add(a.doc!.owner_id, 'review', a.docId, user.name, decision === 'approved' ? `approved “${a.doc!.title}”` : `requested changes on “${a.doc!.title}”`);
    rooms.loaded(a.docId)?.notify('workflow');
    rooms.loaded(a.docId)?.notify('meta');
    res.json({ status });
  });

  // ------------------------------------------------------------------ tasks

  r.get('/tasks', async (_req, res) => {
    const user = requireUser(res);
    const rows = await db.query<{ doc_id: string; title: string; block_key: string; text: string; done: boolean; due: string | null; assignee_id: string | null }>(
      `select t.doc_id, d.title, t.block_key, t.text, t.done, t.due, t.assignee_id from tasks t join documents d on d.id = t.doc_id
       where d.deleted_at is null and (t.assignee_id = $1 or (t.assignee_id is null and t.due is not null and (d.owner_id = $1 or exists (select 1 from doc_members m where m.doc_id = d.id and m.user_id = $1))))
       order by t.done, t.due nulls last limit 500`,
      [user.id],
    );
    res.json({ tasks: rows.map((t) => ({ docId: t.doc_id, docTitle: t.title, key: t.block_key, text: t.text, done: t.done, due: t.due, mine: t.assignee_id === user.id })) });
  });

  // -------------------------------------------------------------- reminders

  r.get('/reminders', async (_req, res) => {
    const user = requireUser(res);
    const rows = await db.query<{ id: string; doc_id: string | null; note: string; at: number; sent: boolean; title: string | null }>(
      'select r.id, r.doc_id, r.note, r.at, r.sent, d.title from reminders r left join documents d on d.id = r.doc_id where r.user_id = $1 order by r.at',
      [user.id],
    );
    res.json({ reminders: rows.map((x) => ({ id: x.id, docId: x.doc_id, docTitle: x.title, note: x.note, at: x.at, sent: x.sent })) });
  });

  r.post('/reminders', rateLimit(60, 60_000), async (req, res) => {
    const user = requireUser(res);
    const note = str(req.body?.note, 300).trim();
    const at = Number(req.body?.at);
    if (!note) throw new HttpError(400, 'What should we remind you about?');
    if (!Number.isFinite(at) || at < Date.now() - 60_000) throw new HttpError(400, 'Pick a time in the future.');
    const docId = req.body?.docId ? str(req.body.docId, 64) : null;
    if (docId) {
      const { role } = await docs.roleFor(docId, user, null);
      if (!role) throw new HttpError(403, 'You do not have access to that document.');
    }
    const id = newId();
    await db.query('insert into reminders (id, user_id, doc_id, note, at) values ($1, $2, $3, $4, $5)', [id, user.id, docId, note, at]);
    res.status(201).json({ id });
  });

  r.delete('/reminders/:rid', async (req, res) => {
    const user = requireUser(res);
    await db.query('delete from reminders where id = $1 and user_id = $2', [String(req.params.rid), user.id]);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- drafts

  r.get('/docs/:id/draft', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'editor', { registered: true });
    const user = requireUser(res);
    const [d] = await db.query<{ content: { md?: string }; updated_at: number }>('select content, updated_at from drafts where doc_id = $1 and user_id = $2', [a.docId, user.id]);
    res.json({ md: d?.content?.md ?? '', updatedAt: d?.updated_at ?? null });
  });

  r.put('/docs/:id/draft', rateLimit(240, 60_000), async (req, res) => {
    const a = await docAccess(ctx, req, res, 'editor', { registered: true });
    const user = requireUser(res);
    if (a.doc!.encrypted) throw new HttpError(400, 'Drafts of encrypted documents stay on your device.');
    const md = str(req.body?.md, 100_000);
    if (!md.trim()) await db.query('delete from drafts where doc_id = $1 and user_id = $2', [a.docId, user.id]);
    else
      await db.query(
        `insert into drafts (doc_id, user_id, content, updated_at) values ($1, $2, $3::jsonb, $4)
         on conflict (doc_id, user_id) do update set content = excluded.content, updated_at = excluded.updated_at`,
        [a.docId, user.id, JSON.stringify({ md }), Date.now()],
      );
    res.json({ ok: true });
  });

  // ------------------------------------------------------------- workspaces

  r.get('/workspaces', async (_req, res) => {
    const user = requireUser(res);
    const rows = await db.query<{ id: string; name: string; owner_id: string; role: string; members: number; docs: number }>(
      `select w.id, w.name, w.owner_id, m.role,
         (select count(*)::int from workspace_members x where x.workspace_id = w.id) as members,
         (select count(*)::int from documents d where d.workspace_id = w.id and d.deleted_at is null) as docs
       from workspaces w join workspace_members m on m.workspace_id = w.id and m.user_id = $1 order by w.name`,
      [user.id],
    );
    res.json({ workspaces: rows.map((w) => ({ id: w.id, name: w.name, role: w.role, owner: w.owner_id === user.id, members: w.members, docs: w.docs })) });
  });

  r.post('/workspaces', rateLimit(20, 60_000), async (req, res) => {
    const user = requireUser(res);
    const name = str(req.body?.name, 60).trim();
    if (!name) throw new HttpError(400, 'Give the workspace a name.');
    const id = newId();
    await db.query('insert into workspaces (id, name, owner_id, created_at) values ($1, $2, $3, $4)', [id, name, user.id, Date.now()]);
    await db.query('insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)', [id, user.id, 'owner']);
    res.status(201).json({ workspace: { id, name, role: 'owner', owner: true, members: 1, docs: 0 } });
  });

  const wsRole = async (wid: string, userId: string) => (await db.query<{ role: string }>('select role from workspace_members where workspace_id = $1 and user_id = $2', [wid, userId]))[0]?.role ?? null;

  r.get('/workspaces/:wid', async (req, res) => {
    const user = requireUser(res);
    const wid = String(req.params.wid);
    const role = await wsRole(wid, user.id);
    if (!role) throw new HttpError(404, 'Workspace not found.');
    const [w] = await db.query<{ name: string }>('select name from workspaces where id = $1', [wid]);
    const members = await db.query<{ user_id: string; name: string; username: string; email: string; role: string }>(
      'select m.user_id, u.name, u.username, u.email, m.role from workspace_members m join users u on u.id = m.user_id where m.workspace_id = $1 order by u.name',
      [wid],
    );
    const list = await db.query<{ id: string; title: string; kind: string; updated_at: number; is_template: boolean; name: string }>(
      `select d.id, d.title, d.kind, d.updated_at, d.is_template, u.name from documents d join users u on u.id = d.owner_id
       where d.workspace_id = $1 and d.deleted_at is null order by d.updated_at desc limit 200`,
      [wid],
    );
    res.json({
      workspace: { id: wid, name: w.name, role },
      members: members.map((m) => ({ userId: m.user_id, name: m.name, username: m.username, email: role === 'owner' ? m.email : undefined, role: m.role })),
      documents: list.map((d) => ({ id: d.id, title: d.title, kind: d.kind, updatedAt: d.updated_at, isTemplate: d.is_template, ownerName: d.name })),
    });
  });

  r.post('/workspaces/:wid/members', rateLimit(30, 60_000), async (req, res) => {
    const user = requireUser(res);
    const wid = String(req.params.wid);
    if ((await wsRole(wid, user.id)) !== 'owner') throw new HttpError(403, 'Only the workspace owner can add people.');
    const email = str(req.body?.email, 200).trim().toLowerCase();
    const role = req.body?.role === 'viewer' ? 'viewer' : 'editor';
    const [u] = await db.query<{ id: string }>('select id from users where lower(email) = $1', [email]);
    if (!u) throw new HttpError(404, 'No CoWrite account uses that email yet. Ask them to sign up first.');
    await db.query(
      `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, $3)
       on conflict (workspace_id, user_id) do update set role = excluded.role`,
      [wid, u.id, role],
    );
    const [w] = await db.query<{ name: string }>('select name from workspaces where id = $1', [wid]);
    if (u.id !== user.id) await notifier.add(u.id, 'shared', null, user.name, `added you to the “${w.name}” workspace`);
    res.json({ ok: true });
  });

  r.delete('/workspaces/:wid/members/:uid', async (req, res) => {
    const user = requireUser(res);
    const wid = String(req.params.wid);
    const target = String(req.params.uid);
    const role = await wsRole(wid, user.id);
    if (role !== 'owner' && target !== user.id) throw new HttpError(403, 'Only the owner can remove people.');
    const [w] = await db.query<{ owner_id: string }>('select owner_id from workspaces where id = $1', [wid]);
    if (w?.owner_id === target) throw new HttpError(400, 'The owner cannot leave their own workspace.');
    await db.query('delete from workspace_members where workspace_id = $1 and user_id = $2', [wid, target]);
    res.json({ ok: true });
  });

  /** Team templates: documents marked as templates in your workspaces. */
  r.get('/templates/team', async (_req, res) => {
    const user = requireUser(res);
    const rows = await db.query<{ id: string; title: string; kind: string; workspace: string }>(
      `select d.id, d.title, d.kind, w.name as workspace from documents d join workspaces w on w.id = d.workspace_id
       join workspace_members m on m.workspace_id = w.id and m.user_id = $1
       where d.is_template and d.deleted_at is null order by d.title limit 100`,
      [user.id],
    );
    res.json({ templates: rows });
  });

  // ------------------------------------------------------- public comments

  r.get('/public/:id/comments', async (req, res) => {
    const rows = await db.query<{ id: string; body: string; created_at: number; name: string; username: string }>(
      `select c.id, c.body, c.created_at, u.name, u.username from public_comments c join users u on u.id = c.user_id
       join documents d on d.id = c.doc_id where c.doc_id = $1 and d.published order by c.created_at`,
      [String(req.params.id)],
    );
    res.json({ comments: rows.map((c) => ({ id: c.id, body: c.body, createdAt: c.created_at, name: c.name, username: c.username })) });
  });

  r.post('/public/:id/comments', rateLimit(20, 60_000), async (req, res) => {
    const user = requireUser(res);
    const id = String(req.params.id);
    const [d] = await db.query<{ owner_id: string; title: string }>('select owner_id, title from documents where id = $1 and published and deleted_at is null', [id]);
    if (!d) throw new HttpError(404, 'This page is not published.');
    const body = str(req.body?.body, 2000).trim();
    if (!body) throw new HttpError(400, 'Write a comment first.');
    const cid = newId();
    await db.query('insert into public_comments (id, doc_id, user_id, body, created_at) values ($1, $2, $3, $4, $5)', [cid, id, user.id, body, Date.now()]);
    if (d.owner_id !== user.id) await notifier.add(d.owner_id, 'comment', id, user.name, `commented on your published page “${d.title}”`);
    res.status(201).json({ id: cid });
  });

  r.delete('/public/:id/comments/:cid', async (req, res) => {
    const user = requireUser(res);
    const [c] = await db.query<{ user_id: string; owner_id: string }>('select c.user_id, d.owner_id from public_comments c join documents d on d.id = c.doc_id where c.id = $1 and c.doc_id = $2', [
      String(req.params.cid),
      String(req.params.id),
    ]);
    if (!c) throw new HttpError(404, 'Comment not found.');
    if (c.user_id !== user.id && c.owner_id !== user.id) throw new HttpError(403, 'You cannot delete this comment.');
    await db.query('delete from public_comments where id = $1', [String(req.params.cid)]);
    res.json({ ok: true });
  });

  return r;
}

const lockOut = (l: LockRow) => ({ id: l.id, start: l.anchor_start, end: l.anchor_end, quote: l.quote, createdBy: l.created_by, createdName: l.created_name, createdAt: l.created_at });

export const listLocks = (ctx: AppCtx, docId: string) =>
  ctx.db.query<LockRow>('select id, anchor_start, anchor_end, quote, created_by, created_name, created_at from locks where doc_id = $1 order by created_at', [docId]);

/** Reloads a room's locks after a change and tells everyone. */
export async function refreshLocks(ctx: AppCtx, docId: string) {
  const room = ctx.rooms.loaded(docId);
  if (room) {
    room.locks = (await listLocks(ctx, docId)).map((l) => ({ start: l.anchor_start, end: l.anchor_end, owner: l.created_by }));
    room.notify('locks');
  }
}

/** Keeps the tasks table in step with the task blocks of a document. */
export async function indexTasks(ctx: AppCtx, docId: string, tokens: Token[]) {
  const tasks = tasksOf(tokens);
  const keyOf = (id: Id) => `${id[0]}:${id[1]}`;
  const existing = await ctx.db.query<{ block_key: string; reminded: boolean; due: string | null; assignee_id: string | null; done: boolean; text: string }>(
    'select block_key, reminded, due, assignee_id, done, text from tasks where doc_id = $1',
    [docId],
  );
  const old = new Map(existing.map((e) => [e.block_key, e]));
  const seen = new Set<string>();
  const doc = await ctx.docs.get(docId);
  for (const t of tasks) {
    const key = keyOf(t.blockId);
    seen.add(key);
    const prev = old.get(key);
    if (prev && prev.text === t.text && prev.done === t.done && prev.due === t.due && prev.assignee_id === t.assignee) continue;
    const reminded = prev && prev.due === t.due && prev.assignee_id === t.assignee ? prev.reminded : false;
    await ctx.db.query(
      `insert into tasks (doc_id, block_key, text, done, assignee_id, due, reminded) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (doc_id, block_key) do update set text = excluded.text, done = excluded.done, assignee_id = excluded.assignee_id, due = excluded.due, reminded = excluded.reminded`,
      [docId, key, t.text, t.done, t.assignee, t.due, reminded],
    );
    // Tell people when a task is newly assigned to them.
    if (doc && t.assignee && t.assignee !== prev?.assignee_id && !t.done) {
      await ctx.notifier.add(t.assignee, 'task', docId, 'CoWrite', `assigned you a task in “${doc.title}”: ${t.text.slice(0, 120)}`).catch(() => {});
    }
  }
  const gone = [...old.keys()].filter((k) => !seen.has(k));
  if (gone.length) await ctx.db.query('delete from tasks where doc_id = $1 and block_key = any($2)', [docId, gone]);
}

/** Sends due reminders and due-today task nudges as notifications. */
export async function runReminders(ctx: AppCtx) {
  const now = Date.now();
  const due = await ctx.db.query<{ id: string; user_id: string; doc_id: string | null; note: string }>('select id, user_id, doc_id, note from reminders where not sent and at <= $1 limit 200', [now]);
  for (const r of due) {
    await ctx.notifier.add(r.user_id, 'reminder', r.doc_id, 'Reminder', r.note);
    await ctx.db.query('update reminders set sent = true where id = $1', [r.id]);
  }
  const today = new Date(now).toISOString().slice(0, 10);
  const tasks = await ctx.db.query<{ doc_id: string; block_key: string; text: string; assignee_id: string; title: string }>(
    `select t.doc_id, t.block_key, t.text, t.assignee_id, d.title from tasks t join documents d on d.id = t.doc_id
     where not t.done and not t.reminded and t.assignee_id is not null and t.due is not null and t.due <= $1 and d.deleted_at is null limit 200`,
    [today],
  );
  for (const t of tasks) {
    await ctx.notifier.add(t.assignee_id, 'task', t.doc_id, 'Due today', `“${t.text.slice(0, 120)}” in “${t.title}”`);
    await ctx.db.query('update tasks set reminded = true where doc_id = $1 and block_key = $2', [t.doc_id, t.block_key]);
  }
}
