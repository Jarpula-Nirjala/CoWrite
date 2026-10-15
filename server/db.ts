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
  // 2: rich documents, files and the collaboration extras.
  `alter table documents add column kind text not null default 'doc';
   alter table documents add column status text not null default 'draft';
   alter table documents add column workspace_id text;
   alter table documents add column translated_from text;
   alter table documents add column lang text;
   alter table documents add column is_template boolean not null default false;
   alter table users add column brand jsonb;
   alter table users add column prefs jsonb;
   create table files (
     id text primary key,
     owner_id text,
     doc_id text,
     name text not null,
     mime text not null,
     size integer not null,
     data bytea not null,
     created_at double precision not null
   );
   create index files_owner on files(owner_id);
   create table checkpoints (
     doc_id text not null,
     at double precision not null,
     vector jsonb not null,
     primary key (doc_id, at)
   );
   create table locks (
     id text primary key,
     doc_id text not null,
     anchor_start jsonb not null,
     anchor_end jsonb not null,
     quote text not null default '',
     created_by text,
     created_name text not null,
     created_at double precision not null
   );
   create index locks_doc on locks(doc_id);
   create table reactions (
     doc_id text not null,
     target text not null,
     emoji text not null,
     who text not null,
     name text not null,
     created_at double precision not null,
     primary key (doc_id, target, emoji, who)
   );
   create table approvals (
     doc_id text not null,
     user_id text not null,
     decision text not null,
     note text not null default '',
     at double precision not null,
     primary key (doc_id, user_id)
   );
   create table tasks (
     doc_id text not null,
     block_key text not null,
     text text not null,
     done boolean not null,
     assignee_id text,
     due text,
     reminded boolean not null default false,
     primary key (doc_id, block_key)
   );
   create index tasks_assignee on tasks(assignee_id);
   create table reminders (
     id text primary key,
     user_id text not null references users(id) on delete cascade,
     doc_id text,
     note text not null,
     at double precision not null,
     sent boolean not null default false
   );
   create table drafts (
     doc_id text not null,
     user_id text not null references users(id) on delete cascade,
     content jsonb not null,
     updated_at double precision not null,
     primary key (doc_id, user_id)
   );
   create table workspaces (
     id text primary key,
     name text not null,
     owner_id text not null references users(id) on delete cascade,
     created_at double precision not null
   );
   create table workspace_members (
     workspace_id text not null references workspaces(id) on delete cascade,
     user_id text not null references users(id) on delete cascade,
     role text not null,
     primary key (workspace_id, user_id)
   );
   create table public_comments (
     id text primary key,
     doc_id text not null,
     user_id text not null references users(id) on delete cascade,
     body text not null,
     created_at double precision not null
   );
   create table translations (
     target_id text not null,
     src_hash text not null,
     text text not null,
     primary key (target_id, src_hash)
   );`,
  // 3: personal AI keys, forms, flashcards, change digests.
  `create table server_secrets (
     name text primary key,
     value text not null
   );
   alter table users add column ai_key text;
   create table form_responses (
     id text primary key,
     doc_id text not null,
     form_id text not null,
     user_id text,
     name text not null default '',
     answers jsonb not null,
     created_at double precision not null
   );
   create index form_responses_form on form_responses (doc_id, form_id);
   create table flash_reviews (
     user_id text not null references users(id) on delete cascade,
     doc_id text not null,
     card text not null,
     ease real not null,
     interval_days real not null,
     reps integer not null default 0,
     due double precision not null,
     primary key (user_id, doc_id, card)
   );
   create table subscriptions (
     doc_id text not null,
     user_id text not null references users(id) on delete cascade,
     freq text not null,
     last_sent double precision not null default 0,
     primary key (doc_id, user_id)
   );
   alter table documents add column slack_webhook text;
   alter table documents add column slack_sent double precision not null default 0;`,
  // 4: which service a personal AI key is for; calendar events; Keep notes.
  `alter table users add column ai_provider text;
   create table events (
     id text primary key,
     user_id text not null references users(id) on delete cascade,
     title text not null,
     notes text not null default '',
     day text not null,
     start_time text,
     end_time text,
     color text not null default 'blue',
     kind text not null default 'event',
     doc_id text,
     remind boolean not null default true,
     remind_at double precision,
     reminded boolean not null default false,
     created_at double precision not null
   );
   create index events_user_day on events (user_id, day);
   create table notes (
     id text primary key,
     user_id text not null references users(id) on delete cascade,
     title text not null default '',
     body text not null default '',
     items jsonb,
     color text not null default 'white',
     pinned boolean not null default false,
     archived boolean not null default false,
     labels jsonb not null default '[]',
     updated_at double precision not null
   );
   create index notes_user on notes (user_id);`,
  // 5: linked Google and GitHub accounts (tokens are sealed with the vault key).
  `create table integrations (
     user_id text not null references users(id) on delete cascade,
     provider text not null,
     access_token text not null,
     refresh_token text,
     expires_at double precision,
     scope text not null default '',
     account jsonb not null default '{}',
     via text not null default 'oauth',
     created_at double precision not null,
     primary key (user_id, provider)
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
