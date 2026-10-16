import crypto from 'node:crypto';
import express from 'express';
import type { AppCtx } from './context.ts';
import type { Db } from './db.ts';
import { HttpError, rateLimit, requireUser, str } from './http.ts';

/** Room for one person's assistant attachments (separate from document uploads). */
const QUOTA = 300 * 1024 * 1024;
const MAX_FILE = 15 * 1024 * 1024;
const MAX_CHATS = 200;
const ID = /^[\w-]{6,64}$/;

/** Files referenced by a chat's messages. */
function fileIdsOf(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((m) => (Array.isArray((m as { files?: unknown }).files) ? ((m as { files: { id?: unknown }[] }).files.map((f) => f.id).filter((id) => typeof id === 'string') as string[]) : []));
}

/** Reads attachments by id for the AI, only the person's own. */
export async function loadAssistantFiles(db: Db, userId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; mime: string; text: string | null; data: Buffer | null }>();
  const rows = await db.query<{ id: string; name: string; mime: string; text: string | null; data: Buffer | Uint8Array | null }>('select id, name, mime, text, data from assistant_files where user_id = $1 and id = any($2)', [userId, ids]);
  return new Map(rows.map((r) => [r.id, { name: r.name, mime: r.mime, text: r.text, data: r.data ? Buffer.from(r.data) : null }]));
}

/** Keeps message fields to what the assistant shows: role, text and file references with a small preview. */
function cleanMessages(raw: unknown) {
  if (!Array.isArray(raw)) throw new HttpError(400, 'Messages are missing.');
  return raw.slice(-400).map((m) => {
    const x = m as { role?: unknown; text?: unknown; files?: unknown };
    const files = Array.isArray(x.files)
      ? (x.files as Record<string, unknown>[]).slice(0, 10).map((f) => ({
          id: ID.test(String(f.id)) ? String(f.id) : undefined,
          name: str(f.name, 200) || 'file',
          mime: str(f.mime, 100),
          size: Number(f.size) || 0,
          ...(typeof f.thumb === 'string' && f.thumb.startsWith('data:image/') && f.thumb.length < 120_000 ? { thumb: f.thumb } : {}),
        }))
      : undefined;
    return { role: x.role === 'assistant' ? 'assistant' : 'user', text: str(x.text, 200_000), ...(files?.length ? { files } : {}) };
  });
}

export function assistantRoutes(ctx: AppCtx) {
  const r = express.Router();
  const { db } = ctx;

  /** The person's chats, newest first, without their messages. */
  r.get('/assistant/chats', async (_req, res) => {
    const user = requireUser(res);
    const rows = await db.query<{ id: string; title: string; updated_at: number }>('select id, title, updated_at from assistant_chats where user_id = $1 order by updated_at desc limit $2', [user.id, MAX_CHATS]);
    res.json({ chats: rows.map((c) => ({ id: c.id, title: c.title, at: c.updated_at })) });
  });

  r.get('/assistant/chats/:id', async (req, res) => {
    const user = requireUser(res);
    const [c] = await db.query<{ id: string; title: string; messages: unknown; updated_at: number }>('select id, title, messages, updated_at from assistant_chats where user_id = $1 and id = $2', [user.id, String(req.params.id)]);
    if (!c) throw new HttpError(404, 'Chat not found.');
    res.json({ chat: { id: c.id, title: c.title, at: c.updated_at, messages: c.messages } });
  });

  /** Saves a whole chat (created on first save). */
  r.put('/assistant/chats/:id', rateLimit(600, 10 * 60_000), express.json({ limit: '8mb' }), async (req, res) => {
    const user = requireUser(res);
    const id = String(req.params.id);
    if (!ID.test(id)) throw new HttpError(400, 'Bad chat id.');
    const title = str(req.body?.title, 120).trim() || 'New chat';
    const messages = cleanMessages(req.body?.messages);
    const at = Number(req.body?.at) > 0 ? Math.min(Number(req.body.at), Date.now()) : Date.now();
    await db.query(
      `insert into assistant_chats (id, user_id, title, messages, updated_at) values ($1, $2, $3, $4, $5)
       on conflict (user_id, id) do update set title = excluded.title, messages = excluded.messages, updated_at = excluded.updated_at`,
      [id, user.id, title, JSON.stringify(messages), at],
    );
    // Keep the newest chats only.
    await db.query(`delete from assistant_chats where user_id = $1 and id not in (select id from assistant_chats where user_id = $1 order by updated_at desc limit $2)`, [user.id, MAX_CHATS]);
    res.json({ ok: true });
  });

  /** Deletes a chat and the files only it used; also clears attachments that were never sent. */
  r.delete('/assistant/chats/:id', async (req, res) => {
    const user = requireUser(res);
    const [gone] = await db.query<{ messages: unknown }>('delete from assistant_chats where user_id = $1 and id = $2 returning messages', [user.id, String(req.params.id)]);
    const chats = await db.query<{ messages: unknown }>('select messages from assistant_chats where user_id = $1', [user.id]);
    const used = new Set(chats.flatMap((c) => fileIdsOf(c.messages)));
    const mine = new Set(fileIdsOf(gone?.messages));
    const files = await db.query<{ id: string; created_at: number }>('select id, created_at from assistant_files where user_id = $1', [user.id]);
    // The deleted chat's files go, and so do files in no chat that are over an hour old (attached, never sent).
    const remove = files.filter((f) => !used.has(f.id) && (mine.has(f.id) || Date.now() - f.created_at > 60 * 60_000)).map((f) => f.id);
    if (remove.length) await db.query('delete from assistant_files where user_id = $1 and id = any($2)', [user.id, remove]);
    res.json({ ok: true, removedFiles: remove.length });
  });

  /**
   * Stores one attachment: images and PDFs as bytes, everything else as text (the client extracts text from
   * Word and other files). Body is the raw file; `x-file-kind: text` marks a UTF-8 text body.
   */
  r.post('/assistant/files', rateLimit(300, 10 * 60_000), express.raw({ type: () => true, limit: MAX_FILE }), async (req, res) => {
    const user = requireUser(res);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Empty upload.');
    const name = decodeURIComponent(str(req.get('x-file-name'), 400)).slice(0, 200) || 'file';
    const mime = str(req.get('content-type'), 100).split(';')[0].trim() || 'application/octet-stream';
    const isText = req.get('x-file-kind') === 'text';
    if (!isText && mime !== 'application/pdf' && !/^image\/(png|jpeg|webp|gif)$/.test(mime)) throw new HttpError(400, 'Attach PDFs, images, Word, text or code files.');
    const [{ used }] = await db.query<{ used: number }>('select coalesce(sum(size), 0)::bigint as used from assistant_files where user_id = $1', [user.id]);
    if (Number(used) + body.length > QUOTA) throw new HttpError(400, 'Your assistant file storage is full (300 MB). Delete some old chats to free space.');
    const id = crypto.randomBytes(12).toString('base64url');
    await db.query('insert into assistant_files (id, user_id, name, mime, size, text, data, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)', [
      id,
      user.id,
      name,
      isText ? str(req.get('x-original-type'), 100) || 'text/plain' : mime,
      body.length,
      isText ? body.toString('utf8') : null,
      isText ? null : body,
      Date.now(),
    ]);
    res.status(201).json({ id, name, size: body.length });
  });

  /** Opens an attachment (only for its owner). */
  r.get('/assistant/files/:id', async (req, res) => {
    const user = requireUser(res);
    const [f] = await db.query<{ name: string; mime: string; text: string | null; data: Buffer | Uint8Array | null }>('select name, mime, text, data from assistant_files where user_id = $1 and id = $2', [user.id, String(req.params.id)]);
    if (!f) throw new HttpError(404, 'File not found.');
    const inline = /^image\/(png|jpeg|webp|gif)$|^application\/pdf$/.test(f.mime);
    res.setHeader('Content-Type', f.text !== null ? 'text/plain; charset=utf-8' : inline ? f.mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline || f.text !== null ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.send(f.text !== null ? f.text : Buffer.from(f.data ?? Buffer.alloc(0)));
  });

  return r;
}
