import express from 'express';
import { Doc } from '../shared/crdt.ts';
import type { Role } from '../shared/protocol.ts';
import { docAccess, type AppCtx } from './context.ts';
import { DOC_KINDS, ROLES, cleanTags, cleanTitle, toMeta, type DocKind, type ListView } from './docs.ts';
import { HttpError, currentUser, requireUser, str } from './http.ts';

const VIEWS: ListView[] = ['all', 'starred', 'shared', 'trash', 'recent'];
const MAX_DOCS_PER_USER = 300;

const isRole = (r: unknown): r is Role => typeof r === 'string' && (ROLES as string[]).includes(r);

export function docRoutes(ctx: AppCtx) {
  const r = express.Router();
  const { docs, rooms, notifier } = ctx;

  // -------------------------------------------------------------- listing

  r.get('/docs', async (req, res) => {
    const user = requireUser(res);
    const view = VIEWS.includes(req.query.view as ListView) ? (req.query.view as ListView) : 'all';
    const documents = await docs.list(user.id, view, {
      folderId: str(req.query.folder, 40) || undefined,
      tag: str(req.query.tag, 24) || undefined,
      q: str(req.query.q, 100) || undefined,
    });
    res.json({ documents });
  });

  r.get('/library', async (_req, res) => {
    const user = requireUser(res);
    const [folders, tags, counts] = await Promise.all([
      docs.folders(user.id),
      docs.tags(user.id),
      ctx.db.query<{ all: number; starred: number; trash: number; shared: number }>(
        `select
           (select count(*)::int from documents where owner_id = $1 and deleted_at is null) as "all",
           (select count(*)::int from documents where owner_id = $1 and deleted_at is null and starred) as starred,
           (select count(*)::int from documents where owner_id = $1 and deleted_at is not null) as trash,
           (select count(*)::int from doc_members m join documents d on d.id = m.doc_id
              where m.user_id = $1 and d.owner_id <> $1 and d.deleted_at is null) as shared`,
        [user.id],
      ),
    ]);
    res.json({ folders, tags, counts: counts[0] });
  });

  r.post('/docs', async (req, res) => {
    const user = requireUser(res);
    const [{ n }] = await ctx.db.query<{ n: number }>('select count(*)::int as n from documents where owner_id = $1', [user.id]);
    if (n >= MAX_DOCS_PER_USER) throw new HttpError(400, `You can keep up to ${MAX_DOCS_PER_USER} documents.`);
    const folderId = str(req.body?.folderId, 40) || null;
    if (folderId && (await docs.folderOwner(folderId)) !== user.id) throw new HttpError(400, 'Unknown folder.');
    const kind = DOC_KINDS.includes(req.body?.kind) ? (req.body.kind as DocKind) : 'doc';
    const workspaceId = str(req.body?.workspaceId, 40) || null;
    if (workspaceId && !(await ctx.db.query('select 1 from workspace_members where workspace_id = $1 and user_id = $2', [workspaceId, user.id])).length) {
      throw new HttpError(403, 'You are not a member of that workspace.');
    }
    const doc = await docs.create(user.id, {
      title: req.body?.title,
      encrypted: req.body?.encrypted === true,
      folderId,
      tags: cleanTags(req.body?.tags),
      kind,
      workspaceId,
    });
    res.status(201).json({ document: toMeta(doc) });
  });

  // ------------------------------------------------------- one document

  r.get('/docs/:id', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer');
    if (!a.doc) {
      res.json({ document: null, role: a.role });
      return;
    }
    const owner = await ctx.auth.get(a.doc.owner_id);
    const parent = a.doc.parent_id ? await docs.get(a.doc.parent_id) : null;
    res.json({
      document: {
        ...toMeta(a.doc),
        ownerName: owner?.name ?? 'Unknown',
        ownerUsername: owner?.username ?? null,
        parentTitle: parent && !parent.deleted_at ? parent.title : null,
      },
      role: a.role,
    });
  });

  r.patch('/docs/:id', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'owner', { registered: true });
    const b = req.body ?? {};
    const patch: Parameters<typeof docs.update>[1] = {};
    if (b.title !== undefined) patch.title = cleanTitle(b.title);
    if (b.tags !== undefined) patch.tags = cleanTags(b.tags);
    if (b.starred !== undefined) patch.starred = b.starred === true;
    if (b.wordGoal !== undefined) {
      const g = Number(b.wordGoal);
      patch.word_goal = Number.isInteger(g) && g > 0 && g <= 1_000_000 ? g : null;
    }
    if (b.folderId !== undefined) {
      const folderId = b.folderId === null ? null : str(b.folderId, 40);
      if (folderId && (await docs.folderOwner(folderId)) !== a.user!.id) throw new HttpError(400, 'Unknown folder.');
      patch.folder_id = folderId;
    }
    if (b.published !== undefined) {
      if (b.published === true && a.doc!.encrypted) throw new HttpError(400, 'Encrypted documents cannot be published, because the server cannot read them.');
      patch.published = b.published === true;
    }
    if (b.workspaceId !== undefined) {
      const wid = b.workspaceId === null ? null : str(b.workspaceId, 40);
      if (wid) {
        const [m] = await ctx.db.query<{ role: string }>('select role from workspace_members where workspace_id = $1 and user_id = $2', [wid, a.user!.id]);
        if (!m || m.role === 'viewer') throw new HttpError(400, 'You cannot add documents to that workspace.');
      }
      patch.workspace_id = wid;
    }
    if (b.isTemplate !== undefined) patch.is_template = b.isTemplate === true;
    const doc = await docs.update(a.docId, patch);
    if (patch.title !== undefined) rooms.loaded(a.docId)?.notify('meta');
    res.json({ document: toMeta(doc) });
  });

  r.post('/docs/:id/trash', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'owner', { registered: true });
    await docs.trash(a.docId);
    rooms.remove(a.docId);
    res.json({ ok: true });
  });

  r.post('/docs/:id/restore', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'owner', { registered: true });
    await docs.restore(a.docId);
    res.json({ ok: true });
  });

  r.delete('/docs/:id', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'owner', { registered: true });
    rooms.remove(a.docId);
    await docs.purge([a.docId]);
    res.json({ ok: true });
  });

  r.post('/trash/empty', async (_req, res) => {
    const user = requireUser(res);
    const rows = await ctx.db.query<{ id: string }>('select id from documents where owner_id = $1 and deleted_at is not null', [user.id]);
    await docs.purge(rows.map((d) => d.id));
    res.json({ ok: true, deleted: rows.length });
  });

  // --------------------------------------------------- members & sharing

  r.get('/docs/:id/sharing', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const members = await docs.members(a.docId);
    const owner = await ctx.auth.get(a.doc!.owner_id);
    res.json({
      owner: owner && { userId: owner.id, name: owner.name, username: owner.username, avatar: owner.avatar },
      members: members.map((m) => ({ userId: m.user_id, name: m.name, username: m.username, avatar: m.avatar, role: m.role, lastSeen: m.last_seen })),
      links: a.role === 'owner' ? (await docs.links(a.docId)).map((l) => ({ token: l.token, role: l.role, createdAt: l.created_at, expiresAt: l.expires_at })) : [],
      published: a.doc!.published,
    });
  });

  r.post('/docs/:id/links', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'owner', { registered: true });
    if (!isRole(req.body?.role)) throw new HttpError(400, 'Choose viewer, commenter or editor.');
    const days = req.body?.expiresInDays === null ? null : Number(req.body?.expiresInDays);
    if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 365)) throw new HttpError(400, 'Expiry must be 1–365 days.');
    const l = await docs.createLink(a.docId, req.body.role, days);
    res.status(201).json({ link: { token: l.token, role: l.role, createdAt: l.created_at, expiresAt: l.expires_at } });
  });

  r.delete('/docs/:id/links/:token', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'owner', { registered: true });
    await docs.revokeLink(a.docId, String(req.params.token));
    res.json({ ok: true });
  });

  r.patch('/docs/:id/members/:userId', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'owner', { registered: true });
    const role = req.body?.role === null ? null : req.body?.role;
    if (role !== null && !isRole(role)) throw new HttpError(400, 'Invalid role.');
    const userId = String(req.params.userId);
    await docs.setMemberRole(a.docId, userId, role);
    // Reconnect them so the new role applies immediately.
    rooms.loaded(a.docId)?.kick(userId);
    rooms.loaded(a.docId)?.notify('members');
    res.json({ ok: true });
  });

  /** Leave a document someone shared with you. */
  r.delete('/docs/:id/membership', async (req, res) => {
    const user = requireUser(res);
    await docs.setMemberRole(String(req.params.id), user.id, null);
    res.json({ ok: true });
  });

  // ------------------------------------------------------- branch & merge

  r.post('/docs/:id/fork', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer');
    const user = requireUser(res);
    const room = await rooms.open(a.docId);
    if (!room) throw new HttpError(503, 'Server busy, try again.');
    const title = a.doc ? `${a.doc.title} (fork)` : 'Forked document';
    const fork = await docs.create(user.id, { title, encrypted: room.encrypted, parentId: a.docId, tags: a.doc?.owner_id === user.id ? a.doc.tags : [], kind: a.doc?.kind ?? 'doc' });
    // The fork starts as an exact replica: same characters, same ids. That is
    // what lets the CRDT merge it back later without any conflict handling.
    await ctx.db.query('insert into rooms (id, snapshot, updated_at) values ($1, $2::jsonb, $3)', [fork.id, JSON.stringify(room.doc.snapshot()), Date.now()]);
    await ctx.db.query('update documents set content_text = $2 where id = $1', [fork.id, room.encrypted ? '' : room.doc.text()]);
    res.status(201).json({ document: toMeta(fork) });
  });

  async function forkPair(req: express.Request, res: express.Response) {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const parentId = a.doc!.parent_id;
    if (!parentId) throw new HttpError(400, 'This document is not a fork.');
    const parent = await docs.get(parentId);
    if (!parent || parent.deleted_at) throw new HttpError(404, 'The original document no longer exists.');
    const [fork, original] = await Promise.all([rooms.open(a.docId), rooms.open(parentId)]);
    if (!fork || !original) throw new HttpError(503, 'Server busy, try again.');
    return { a, parent, fork, original };
  }

  const summary = (ops: { k: string }[]) => ({ inserts: ops.filter((o) => o.k === 'i').length, deletes: ops.filter((o) => o.k === 'd').length });

  r.get('/docs/:id/merge-preview', async (req, res) => {
    const { parent, fork, original } = await forkPair(req, res);
    res.json({
      parentId: parent.id,
      parentTitle: parent.title,
      toParent: summary(fork.doc.missingFor(original.doc.vector)),
      fromParent: summary(original.doc.missingFor(fork.doc.vector)),
    });
  });

  /** Merge this fork's changes into the original. */
  r.post('/docs/:id/merge', async (req, res) => {
    const { a, parent, fork, original } = await forkPair(req, res);
    const user = requireUser(res);
    const { role } = await docs.roleFor(parent.id, user, null);
    if (role !== 'owner' && role !== 'editor') throw new HttpError(403, 'You need edit access to the original document to merge into it.');
    const applied = original.applyServerOps(fork.doc.missingFor(original.doc.vector), null);
    if (applied.length && parent.owner_id !== user.id) {
      await notifier.add(parent.owner_id, 'merge', parent.id, user.name, `merged “${a.doc!.title}” into “${parent.title}”`);
    }
    res.json({ applied: summary(applied) });
  });

  /** Bring the original's newer changes into this fork. */
  r.post('/docs/:id/pull', async (req, res) => {
    const { a, fork, original } = await forkPair(req, res);
    if (a.role !== 'owner' && a.role !== 'editor') throw new HttpError(403, 'You need edit access to this fork.');
    const applied = fork.applyServerOps(original.doc.missingFor(fork.doc.vector), null);
    res.json({ applied: summary(applied) });
  });

  /** Side-by-side comparison of a fork and its original (they share character ids). */
  r.get('/docs/:id/fork-compare', async (req, res) => {
    const { parent, fork, original } = await forkPair(req, res);
    if (fork.encrypted) throw new HttpError(400, 'Encrypted forks are compared in the browser only.');
    // The original may have changed since the fork: only show it to people who can open it.
    const { role: parentRole } = await docs.roleFor(parent.id, currentUser(res), null);
    if (!parentRole) throw new HttpError(403, 'You do not have access to the original document.');
    const merged = Doc.fromSnapshot('cmp', original.doc.snapshot());
    merged.apply(fork.doc.missingFor(original.doc.vector));
    const inParent = new Set(original.doc.tokens().map((t) => `${t.id[0]}:${t.id[1]}`));
    const inFork = new Set(fork.doc.tokens().map((t) => `${t.id[0]}:${t.id[1]}`));
    const items = merged
      .rawItems()
      .map((it) => ({ key: `${it.id[0]}:${it.id[1]}`, it }))
      .filter(({ key }) => inParent.has(key) || inFork.has(key))
      .map(({ key, it }) => ({ ch: it.ch, attrs: merged.attrsOf(it.id) ?? {}, p: inParent.has(key), f: inFork.has(key) }));
    res.json({ parentTitle: parent.title, items });
  });

  /** The whole family tree of forks this document belongs to. */
  r.get('/docs/:id/tree', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const user = currentUser(res);
    // Walk up to the root, then collect every descendant.
    let root = a.doc!;
    for (let i = 0; i < 20 && root.parent_id; i++) {
      const p = await docs.get(root.parent_id);
      if (!p) break;
      root = p;
    }
    const rows = await ctx.db.query<{ id: string; title: string; parent_id: string | null; owner_id: string; name: string; updated_at: number; deleted_at: number | null; published: boolean }>(
      `with recursive fam as (select id from documents where id = $1 union select d.id from documents d join fam on d.parent_id = fam.id)
       select d.id, d.title, d.parent_id, d.owner_id, u.name, d.updated_at, d.deleted_at, d.published from documents d join fam on fam.id = d.id join users u on u.id = d.owner_id limit 300`,
      [root.id],
    );
    const visible = new Set<string>();
    if (user) {
      const mine = await ctx.db.query<{ doc_id: string }>('select doc_id from doc_members where user_id = $1 and doc_id = any($2)', [user.id, rows.map((r) => r.id)]);
      for (const m of mine) visible.add(m.doc_id);
    }
    res.json({
      current: a.docId,
      nodes: rows
        .filter((r) => !r.deleted_at)
        .map((r) => {
          const canSee = r.id === a.docId || r.published || (user && (r.owner_id === user.id || visible.has(r.id)));
          return { id: r.id, parentId: r.parent_id, title: canSee ? r.title : 'Private fork', ownerName: r.name, updatedAt: r.updated_at, canOpen: !!canSee };
        }),
    });
  });

  r.get('/docs/:id/forks', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const rows = await ctx.db.query<{ id: string; title: string; name: string; updated_at: number }>(
      `select d.id, d.title, u.name, d.updated_at from documents d join users u on u.id = d.owner_id
       where d.parent_id = $1 and d.deleted_at is null order by d.updated_at desc limit 50`,
      [a.docId],
    );
    res.json({ forks: rows.map((f) => ({ id: f.id, title: f.title, ownerName: f.name, updatedAt: f.updated_at })) });
  });

  // ----------------------------------------------------------- folders

  r.post('/folders', async (req, res) => {
    const user = requireUser(res);
    const name = str(req.body?.name, 60).trim();
    if (!name) throw new HttpError(400, 'Folder name is required.');
    res.status(201).json({ folder: await docs.createFolder(user.id, name) });
  });

  r.patch('/folders/:fid', async (req, res) => {
    const user = requireUser(res);
    const fid = String(req.params.fid);
    if ((await docs.folderOwner(fid)) !== user.id) throw new HttpError(404, 'Folder not found.');
    const name = str(req.body?.name, 60).trim();
    if (!name) throw new HttpError(400, 'Folder name is required.');
    await docs.renameFolder(fid, name);
    res.json({ ok: true });
  });

  r.delete('/folders/:fid', async (req, res) => {
    const user = requireUser(res);
    const fid = String(req.params.fid);
    if ((await docs.folderOwner(fid)) !== user.id) throw new HttpError(404, 'Folder not found.');
    await docs.deleteFolder(fid);
    res.json({ ok: true });
  });

  return r;
}
