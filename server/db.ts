import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

/**
 * Minimal database handle. In production it is a pooled connection to a
 * real Postgres server (DATABASE_URL, e.g. Neon); locally and in tests it is
 * PGlite, the same Postgres compiled to WebAssembly, so the SQL is identical.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
  readonly kind: 'postgres' | 'pglite';
}

export async function openDb(opts: { url?: string | null; dir?: string | null }): Promise<Db> {
  let db: Db;
  if (opts.url) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(opts.url);
    const pool = new pg.Pool({ connectionString: opts.url, max: 5, ssl: local ? undefined : { rejectUnauthorized: false } });
    db = {
      kind: 'postgres',
      async query<T>(text: string, params?: unknown[]) {
        return (await pool.query(text, params as unknown[])).rows as T[];
      },
      close: () => pool.end(),
    };
  } else {
    if (opts.dir) fs.mkdirSync(opts.dir, { recursive: true });
    const lite = new PGlite(opts.dir ?? undefined);
    await lite.waitReady;
    // PGlite runs one statement at a time; serialise callers explicitly.
    let queue: Promise<unknown> = Promise.resolve();
    db = {
      kind: 'pglite',
      query<T>(text: string, params?: unknown[]) {
        const run = queue.then(async () => (await lite.query<T>(text, params)).rows);
        queue = run.catch(() => {});
        return run;
      },
      close: () => lite.close(),
    };
  }
  await migrate(db);
  return db;
}

// Timestamps are stored as epoch milliseconds (double precision) so both
// drivers hand back plain numbers.
const MIGRATIONS: string[] = [
  `create table users (
     id text primary key,
     email text not null unique,
     username text not null unique,
     name text not null,
     password text,
     bio text not null default '',
     avatar text,
     google_id text unique,
     github_id text unique,
     created_at double precision not null
   );
   create table sessions (
     token_hash text primary key,
     user_id text not null references users(id) on delete cascade,
     expires_at double precision not null
   );
   create table password_resets (
     token_hash text primary key,
     user_id text not null references users(id) on delete cascade,
     expires_at double precision not null,
     used boolean not null default false
   );
   create table folders (
     id text primary key,
     owner_id text not null references users(id) on delete cascade,
     name text not null,
     created_at double precision not null
   );
   create table documents (
     id text primary key,
     title text not null,
     owner_id text not null references users(id) on delete cascade,
     folder_id text references folders(id) on delete set null,
     tags text[] not null default '{}',
     starred boolean not null default false,
     encrypted boolean not null default false,
     published boolean not null default false,
     parent_id text,
     word_goal integer,
     content_text text not null default '',
     deleted_at double precision,
     created_at double precision not null,
     updated_at double precision not null
   );
   create index documents_owner on documents(owner_id);
   create table rooms (
     id text primary key,
     snapshot jsonb not null,
     updated_at double precision not null
   );
   create table doc_members (
     doc_id text not null references documents(id) on delete cascade,
     user_id text not null references users(id) on delete cascade,
     role text not null,
     last_seen double precision not null,
     primary key (doc_id, user_id)
   );
   create table share_links (
     token text primary key,
     doc_id text not null references documents(id) on delete cascade,
     role text not null,
     created_at double precision not null,
     expires_at double precision,
     revoked boolean not null default false
   );
   create table sites (
     doc_id text not null,
     site text not null,
     user_id text,
     name text not null,
     color text not null,
     first_seen double precision not null,
     primary key (doc_id, site)
   );
   create table comments (
     id text primary key,
     doc_id text not null,
     parent_id text,
     anchor_start jsonb,
     anchor_end jsonb,
     quote text not null default '',
     body text not null,
     author_id text,
     author_name text not null,
     color text not null,
     resolved boolean not null default false,
     created_at double precision not null
   );
   create index comments_doc on comments(doc_id);
   create table suggestions (
     id text primary key,
     doc_id text not null,
     kind text not null,
     item_keys text[] not null,
     author_id text,
     author_name text not null,
     color text not null,
     status text not null default 'open',
     created_at double precision not null
   );
   create index suggestions_doc on suggestions(doc_id);
   create table messages (
     id text primary key,
     doc_id text not null,
     author_id text,
     author_name text not null,
     color text not null,
     body text not null,
     created_at double precision not null
   );
   create index messages_doc on messages(doc_id, created_at);
   create table notifications (
     id text primary key,
     user_id text not null references users(id) on delete cascade,
     kind text not null,
     doc_id text,
     actor_name text not null,
     body text not null,
     read boolean not null default false,
     created_at double precision not null
   );
   create index notifications_user on notifications(user_id, created_at);
   create table versions (
     id text primary key,
     doc_id text not null,
     name text not null,
     snapshot jsonb not null,
     size integer not null,
     author_name text not null,
     created_at double precision not null
   );
   create index versions_doc on versions(doc_id, created_at);
   create table activity (
     doc_id text not null,
     site text not null,
     day text not null,
     user_id text,
     name text not null,
     inserts integer not null default 0,
     deletes integer not null default 0,
     primary key (doc_id, site, day)
   );`,
];

async function migrate(db: Db): Promise<void> {
  await db.query('create table if not exists schema_version (version integer not null)');
  const [row] = await db.query<{ version: number }>('select version from schema_version');
  let version = row?.version ?? 0;
  if (!row) await db.query('insert into schema_version (version) values (0)');
  for (; version < MIGRATIONS.length; version++) {
    for (const stmt of MIGRATIONS[version].split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
      await db.query(stmt);
    }
    await db.query('update schema_version set version = $1', [version + 1]);
  }
}
