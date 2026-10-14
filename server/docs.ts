import crypto from 'node:crypto';
import type { Role } from '../shared/protocol.ts';
import type { User } from './auth.ts';
import type { Db } from './db.ts';

export interface DocRow {
  id: string;
  title: string;
  owner_id: string;
  folder_id: string | null;
  tags: string[];
  starred: boolean;
  encrypted: boolean;
  published: boolean;
  parent_id: string | null;
  word_goal: number | null;
  content_text: string;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
  kind: DocKind;
  status: string;
  workspace_id: string | null;
  translated_from: string | null;
  lang: string | null;
  is_template: boolean;
}

export type DocKind = 'doc' | 'slides' | 'board' | 'kanban' | 'sheet';
export const DOC_KINDS: DocKind[] = ['doc', 'slides', 'board', 'kanban', 'sheet'];

export interface DocMeta {
  id: string;
  title: string;
  ownerId: string;
  folderId: string | null;
  tags: string[];
  starred: boolean;
  encrypted: boolean;
  published: boolean;
  parentId: string | null;
  wordGoal: number | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  snippet?: string;
  role?: Role;
  ownerName?: string;
  kind: DocKind;
  status: string;
  workspaceId: string | null;
  translatedFrom: string | null;
  lang: string | null;
  isTemplate: boolean;
}

export const toMeta = (d: DocRow): DocMeta => ({
  id: d.id,
  title: d.title,
  ownerId: d.owner_id,
  folderId: d.folder_id,
  tags: d.tags ?? [],
  starred: d.starred,
  encrypted: d.encrypted,
  published: d.published,
  parentId: d.parent_id,
  wordGoal: d.word_goal,
  deletedAt: d.deleted_at,
  createdAt: d.created_at,
  updatedAt: d.updated_at,
  kind: d.kind ?? 'doc',
  status: d.status ?? 'draft',
  workspaceId: d.workspace_id ?? null,
  translatedFrom: d.translated_from ?? null,
  lang: d.lang ?? null,
  isTemplate: !!d.is_template,
});

const ROLE_RANK: Record<Role, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
export const ROLES: Role[] = ['viewer', 'commenter', 'editor'];
export const higher = (a: Role, b: Role): Role => (ROLE_RANK[a] >= ROLE_RANK[b] ? a : b);

export const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function cleanTitle(title: unknown): string {
  const t = typeof title === 'string' ? title.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
  return t || 'Untitled document';
}

export function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out = new Set<string>();
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const clean = t.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 24);
    if (clean) out.add(clean);
    if (out.size >= 10) break;
  }
  return [...out];
}

/** A short excerpt of `text` around the first match of `q`. */
function snippet(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 140);
  const start = Math.max(0, i - 60);
  return `${start > 0 ? '…' : ''}${text.slice(start, i + q.length + 80)}${i + q.length + 80 < text.length ? '…' : ''}`;
}

export type ListView = 'all' | 'starred' | 'shared' | 'trash' | 'recent';

export class Docs {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async get(id: string): Promise<DocRow | null> {
    const [d] = await this.db.query<DocRow>('select * from documents where id = $1', [id]);
    return d ?? null;
  }

  async create(
    ownerId: string,
    opts: {
      title?: unknown;
      encrypted?: boolean;
      folderId?: string | null;
      tags?: string[];
      parentId?: string | null;
      kind?: DocKind;
      workspaceId?: string | null;
      translatedFrom?: string | null;
      lang?: string | null;
    },
  ): Promise<DocRow> {
    const now = Date.now();
    const [d] = await this.db.query<DocRow>(
      `insert into documents (id, title, owner_id, folder_id, tags, encrypted, parent_id, created_at, updated_at, kind, workspace_id, translated_from, lang)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, $12) returning *`,
      [
        newId(),
        cleanTitle(opts.title),
        ownerId,
        opts.folderId ?? null,
        opts.tags ?? [],
        !!opts.encrypted,
        opts.parentId ?? null,
        now,
        opts.kind ?? 'doc',
        opts.workspaceId ?? null,
        opts.translatedFrom ?? null,
        opts.lang ?? null,
      ],
    );
    return d;
  }

  async list(userId: string, view: ListView, filter: { folderId?: string; tag?: string; q?: string }): Promise<DocMeta[]> {
    const params: unknown[] = [userId];
    let sql: string;
    if (view === 'shared') {
      sql = `select d.*, m.role, u.name as owner_name from doc_members m
             join documents d on d.id = m.doc_id join users u on u.id = d.owner_id
             where m.user_id = $1 and d.owner_id <> $1 and d.deleted_at is null`;
    } else {
      sql = `select d.*, 'owner' as role from documents d where d.owner_id = $1 and d.deleted_at is ${view === 'trash' ? 'not null' : 'null'}`;
      if (view === 'starred') sql += ' and d.starred';
      if (filter.folderId) {
        params.push(filter.folderId);
        sql += ` and d.folder_id = $${params.length}`;
      }
      if (filter.tag) {
        params.push(filter.tag);
        sql += ` and $${params.length} = any(d.tags)`;
      }
    }
    const q = filter.q?.trim().slice(0, 100);
    if (q) {
      params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      sql += ` and (d.title ilike $${params.length} or d.content_text ilike $${params.length})`;
    }
    sql += view === 'recent' ? ' order by d.updated_at desc limit 8' : ' order by d.updated_at desc limit 300';
    const rows = await this.db.query<DocRow & { role: Role; owner_name?: string }>(sql, params);
    return rows.map((r) => ({
      ...toMeta(r),
      role: r.role,
      ownerName: r.owner_name,
      snippet: q ? snippet(r.content_text, q) : undefined,
    }));
  }

  async update(
    id: string,
    patch: Partial<{
      title: string;
      folder_id: string | null;
      tags: string[];
      starred: boolean;
      word_goal: number | null;
      published: boolean;
      status: string;
      workspace_id: string | null;
      is_template: boolean;
    }>,
  ): Promise<DocRow> {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) return (await this.get(id))!;
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const [d] = await this.db.query<DocRow>(`update documents set ${sets} where id = $1 returning *`, [id, ...keys.map((k) => patch[k])]);
    return d;
  }

  async touch(id: string): Promise<void> {
    await this.db.query('update documents set updated_at = $2 where id = $1', [id, Date.now()]);
  }

  async trash(id: string): Promise<void> {
    await this.db.query('update documents set deleted_at = $2 where id = $1', [id, Date.now()]);
  }

  async restore(id: string): Promise<void> {
    await this.db.query('update documents set deleted_at = null where id = $1', [id]);
  }

  /** Permanently deletes documents and everything attached to them. */
  async purge(ids: string[]): Promise<void> {
    if (!ids.length) return;
    for (const table of ['rooms', 'comments', 'suggestions', 'messages', 'versions', 'sites', 'activity']) {
      const col = table === 'rooms' ? 'id' : 'doc_id';
      await this.db.query(`delete from ${table} where ${col} = any($1)`, [ids]);
    }
    await this.db.query('delete from documents where id = any($1)', [ids]);
  }

  /** Ids of trashed documents older than 30 days. */
  async expiredTrash(): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>('select id from documents where deleted_at < $1', [Date.now() - TRASH_TTL_MS]);
    return rows.map((r) => r.id);
  }

  // ------------------------------------------------------------- access

  /**
   * What `user` may do in document `docId`:
   * - unregistered rooms are quick guest documents: anyone can edit;
   * - the owner can do everything, members get their stored role;
   * - a valid share link grants its role (and records a signed-in user as a member);
   * - published documents are readable by anyone.
   */
  async roleFor(docId: string, user: User | null, shareToken: string | null): Promise<{ role: Role | null; doc: DocRow | null }> {
    const doc = await this.get(docId);
    if (!doc) return { role: 'editor', doc: null };
    if (user && doc.owner_id === user.id) return { role: 'owner', doc };
    if (doc.deleted_at) return { role: null, doc };

    let role: Role | null = null;
    if (user) {
      const [m] = await this.db.query<{ role: Role }>('select role from doc_members where doc_id = $1 and user_id = $2', [docId, user.id]);
      if (m) role = m.role;
    }
    if (shareToken) {
      const [link] = await this.db.query<{ role: Role }>(
        'select role from share_links where token = $1 and doc_id = $2 and not revoked and (expires_at is null or expires_at > $3)',
        [shareToken, docId, Date.now()],
      );
      if (link) {
        role = role ? higher(role, link.role) : link.role;
        if (user) await this.addMember(docId, user.id, role);
      }
    }
    if (!role && doc.published) role = 'viewer';
    return { role, doc };
  }

  async addMember(docId: string, userId: string, role: Role): Promise<boolean> {
    const rows = await this.db.query<{ inserted: boolean }>(
      `insert into doc_members (doc_id, user_id, role, last_seen) values ($1, $2, $3, $4)
       on conflict (doc_id, user_id) do update set role = excluded.role, last_seen = excluded.last_seen
       returning (xmax = 0) as inserted`,
      [docId, userId, role, Date.now()],
    );
    return rows[0]?.inserted ?? false;
  }

  async seen(docId: string, userId: string): Promise<void> {
    await this.db.query('update doc_members set last_seen = $3 where doc_id = $1 and user_id = $2', [docId, userId, Date.now()]);
  }

  async members(docId: string) {
    return this.db.query<{ user_id: string; name: string; username: string; avatar: string | null; role: Role; last_seen: number }>(
      `select m.user_id, u.name, u.username, u.avatar, m.role, m.last_seen
       from doc_members m join users u on u.id = m.user_id where m.doc_id = $1 order by m.last_seen desc`,
      [docId],
    );
  }

  async setMemberRole(docId: string, userId: string, role: Role | null): Promise<void> {
    if (role) await this.db.query('update doc_members set role = $3 where doc_id = $1 and user_id = $2', [docId, userId, role]);
    else await this.db.query('delete from doc_members where doc_id = $1 and user_id = $2', [docId, userId]);
  }

  async createLink(docId: string, role: Role, expiresInDays: number | null) {
    const [l] = await this.db.query<{ token: string; role: Role; created_at: number; expires_at: number | null }>(
      'insert into share_links (token, doc_id, role, created_at, expires_at) values ($1, $2, $3, $4, $5) returning token, role, created_at, expires_at',
      [newId(12), docId, role, Date.now(), expiresInDays ? Date.now() + expiresInDays * 86_400_000 : null],
    );
    return l;
  }

  async links(docId: string) {
    return this.db.query<{ token: string; role: Role; created_at: number; expires_at: number | null }>(
      'select token, role, created_at, expires_at from share_links where doc_id = $1 and not revoked and (expires_at is null or expires_at > $2) order by created_at desc',
      [docId, Date.now()],
    );
  }

  async revokeLink(docId: string, token: string): Promise<void> {
    await this.db.query('update share_links set revoked = true where doc_id = $1 and token = $2', [docId, token]);
  }

  // ------------------------------------------------------------- folders

  async folders(ownerId: string) {
    return this.db.query<{ id: string; name: string; count: number }>(
      `select f.id, f.name, (select count(*)::int from documents d where d.folder_id = f.id and d.deleted_at is null) as count
       from folders f where f.owner_id = $1 order by lower(f.name)`,
      [ownerId],
    );
  }

  async createFolder(ownerId: string, name: string) {
    const [f] = await this.db.query<{ id: string; name: string }>(
      'insert into folders (id, owner_id, name, created_at) values ($1, $2, $3, $4) returning id, name',
      [newId(), ownerId, name, Date.now()],
    );
    return f;
  }

  async folderOwner(id: string): Promise<string | null> {
    const [f] = await this.db.query<{ owner_id: string }>('select owner_id from folders where id = $1', [id]);
    return f?.owner_id ?? null;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await this.db.query('update folders set name = $2 where id = $1', [id, name]);
  }

  async deleteFolder(id: string): Promise<void> {
    await this.db.query('delete from folders where id = $1', [id]);
  }

  async tags(ownerId: string): Promise<{ tag: string; count: number }[]> {
    return this.db.query(
      `select t as tag, count(*)::int as count from documents, unnest(tags) as t
       where owner_id = $1 and deleted_at is null group by t order by t`,
      [ownerId],
    );
  }
}
