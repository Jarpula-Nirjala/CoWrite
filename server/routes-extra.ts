import crypto from 'node:crypto';
import express from 'express';
import { plainText } from '../shared/rich.ts';
import { docAccess, type AppCtx } from './context.ts';
import { HttpError, currentUser, rateLimit, requireUser, str } from './http.ts';
import { mailEnabled, sendMail } from './mail.ts';

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda'];

/** Forms, flashcard reviews, narration and change digests. */
export function extraRoutes(ctx: AppCtx) {
  const r = express.Router();
  const { db, rooms } = ctx;

  // ------------------------------------------------------------------ forms

  /** Anyone who can read the document (or its public page) can answer its forms. */
  r.post('/docs/:id/forms/:fid/responses', rateLimit(30, 60_000), async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const fid = str(req.params.fid, 40);
    const answers = req.body?.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new HttpError(400, 'Answer the questions first.');
    const json = JSON.stringify(answers);
    if (json.length > 20_000) throw new HttpError(400, 'Those answers are too long.');
    await db.query('insert into form_responses (id, doc_id, form_id, user_id, name, answers, created_at) values ($1, $2, $3, $4, $5, $6::jsonb, $7)', [
      newId(),
      a.docId,
      fid,
      a.user?.id ?? null,
      a.user?.name ?? str(req.body?.name, 60),
      json,
      Date.now(),
    ]);
    rooms.loaded(a.docId)?.notify('workflow');
    res.status(201).json({ ok: true });
  });

  r.get('/docs/:id/forms/:fid/responses', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'editor', { registered: true });
    const rows = await db.query<{ id: string; name: string; answers: Record<string, unknown>; created_at: number }>(
      'select id, name, answers, created_at from form_responses where doc_id = $1 and form_id = $2 order by created_at desc limit 2000',
      [a.docId, str(req.params.fid, 40)],
    );
    res.json({ responses: rows.map((x) => ({ id: x.id, name: x.name, answers: x.answers, createdAt: x.created_at })) });
  });

  // -------------------------------------------------------- flashcard reviews

  r.get('/docs/:id/flash', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const user = requireUser(res);
    const rows = await db.query<{ card: string; ease: number; interval_days: number; reps: number; due: number }>(
      'select card, ease, interval_days, reps, due from flash_reviews where user_id = $1 and doc_id = $2',
      [user.id, a.docId],
    );
    res.json({ reviews: rows.map((x) => ({ card: x.card, ease: x.ease, interval: x.interval_days, reps: x.reps, due: x.due })) });
  });

  r.put('/docs/:id/flash/:card', rateLimit(600, 60_000), async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const user = requireUser(res);
    const n = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || lo));
    await db.query(
      `insert into flash_reviews (user_id, doc_id, card, ease, interval_days, reps, due) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (user_id, doc_id, card) do update set ease = excluded.ease, interval_days = excluded.interval_days, reps = excluded.reps, due = excluded.due`,
      [user.id, a.docId, str(req.params.card, 40), n(req.body?.ease, 1.3, 3), n(req.body?.interval, 0, 3650), Math.round(n(req.body?.reps, 0, 10000)), n(req.body?.due, 0, 1e14)],
    );
    res.json({ ok: true });
  });

  /** AI-made flashcards from the document. */
  r.post('/docs/:id/ai/flashcards', rateLimit(20, 10 * 60_000), async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const room = await rooms.open(a.docId);
    if (!room || room.encrypted) throw new HttpError(400, 'AI is unavailable for this document.');
    const text = plainText(room.doc.tokens());
    if (text.trim().length < 80) throw new HttpError(400, 'Write some notes first: the cards are made from them.');
    const ai = await ctx.ai.for(currentUser(res)?.id);
    const out = await ai.json<{ cards: { q: string; a: string }[] }>(
      'You write excellent study flashcards: one fact per card, short questions, precise answers.',
      `<notes>\n${text.slice(0, 60_000)}\n</notes>\n\nWrite 8 to 20 flashcards that cover the key facts, definitions and ideas in these notes. Answers under 25 words.`,
      {
        type: 'object',
        properties: { cards: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'], additionalProperties: false } } },
        required: ['cards'],
        additionalProperties: false,
      },
    );
    res.json({ cards: out.cards.filter((c) => c.q && c.a).slice(0, 40) });
  });

  // -------------------------------------------------------------- narration

  /** Reads the document aloud with Gemini's voices; returns 24 kHz 16-bit mono PCM. */
  r.post('/docs/:id/ai/narrate', rateLimit(6, 10 * 60_000), async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const room = await rooms.open(a.docId);
    if (!room || room.encrypted) throw new HttpError(400, 'Narration is unavailable for this document.');
    const ai = await ctx.ai.for(currentUser(res)?.id);
    if (!ai.llm.speech) throw new HttpError(400, 'Narration needs Gemini. Connect your free Gemini key in Account settings.');
    const voice = VOICES.includes(str(req.body?.voice, 20)) ? str(req.body?.voice, 20) : 'Kore';
    const full = plainText(room.doc.tokens()).replace(/\n{2,}/g, '\n').trim();
    if (!full) throw new HttpError(400, 'The document is empty.');
    const text = full.slice(0, 12_000);
    // Split at paragraph boundaries into chunks the voice model handles well.
    const chunks: string[] = [];
    let cur = '';
    for (const para of text.split('\n')) {
      if (cur && cur.length + para.length > 3500) {
        chunks.push(cur);
        cur = '';
      }
      cur += `${para}\n`;
    }
    if (cur.trim()) chunks.push(cur);
    const parts: Buffer[] = [];
    for (const c of chunks) parts.push(await ai.llm.speech(c, voice));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Sample-Rate', '24000');
    res.setHeader('X-Truncated', full.length > text.length ? '1' : '0');
    res.send(Buffer.concat(parts));
  });

  // ---------------------------------------------------------------- digests

  r.get('/docs/:id/updates', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const user = requireUser(res);
    const [sub] = await db.query<{ freq: string }>('select freq from subscriptions where doc_id = $1 and user_id = $2', [a.docId, user.id]);
    const [d] = await db.query<{ slack_webhook: string | null }>('select slack_webhook from documents where id = $1', [a.docId]);
    res.json({ freq: sub?.freq ?? 'off', slack: a.role === 'owner' ? !!d?.slack_webhook : undefined, email: mailEnabled() });
  });

  r.put('/docs/:id/updates', async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const user = requireUser(res);
    const freq = str(req.body?.freq, 10);
    if (!['off', 'daily', 'weekly'].includes(freq)) throw new HttpError(400, 'Choose off, daily or weekly.');
    if (freq === 'off') await db.query('delete from subscriptions where doc_id = $1 and user_id = $2', [a.docId, user.id]);
    else
      await db.query(
        `insert into subscriptions (doc_id, user_id, freq, last_sent) values ($1, $2, $3, $4)
         on conflict (doc_id, user_id) do update set freq = excluded.freq`,
        [a.docId, user.id, freq, Date.now()],
      );
    res.json({ freq });
  });

  r.put('/docs/:id/slack', rateLimit(20, 60_000), async (req, res) => {
    const a = await docAccess(ctx, req, res, 'owner', { registered: true });
    const url = str(req.body?.url, 300).trim();
    if (url && !/^https:\/\/hooks\.slack\.com\/services\/[\w/-]+$/.test(url)) throw new HttpError(400, 'Paste a Slack incoming-webhook URL (it starts with https://hooks.slack.com/services/).');
    await db.query('update documents set slack_webhook = $2, slack_sent = $3 where id = $1', [a.docId, url || null, Date.now()]);
    if (url && req.body?.test) {
      const ok = await postSlack(url, `:wave: CoWrite will post here when “${a.doc!.title}” changes.`);
      if (!ok) throw new HttpError(400, 'Slack did not accept the test message. Check the webhook URL.');
    }
    res.json({ slack: !!url });
  });

  return r;
}

async function postSlack(url: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(8000), redirect: 'error' });
    return res.ok;
  } catch {
    return false;
  }
}

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** What changed in a document since a moment: who edited, how much, new comments. */
async function changesSince(ctx: AppCtx, docId: string, since: number) {
  const editors = await ctx.db.query<{ name: string; edits: number }>(
    'select name, sum(inserts + deletes)::int as edits from activity where doc_id = $1 and day >= $2 group by name order by edits desc limit 8',
    [docId, dayKey(since)],
  );
  const [c] = await ctx.db.query<{ n: number }>('select count(*)::int as n from comments where doc_id = $1 and created_at > $2', [docId, since]);
  return { editors: editors.filter((e) => e.edits > 0), comments: c?.n ?? 0 };
}

/** Posts Slack summaries and sends email digests. Runs every few minutes. */
export async function runDigests(ctx: AppCtx, baseUrl: string) {
  const now = Date.now();
  // Slack: once edits have settled for 10 minutes, at most every 30 minutes.
  const slack = await ctx.db.query<{ id: string; title: string; slack_webhook: string; slack_sent: number; updated_at: number }>(
    'select id, title, slack_webhook, slack_sent, updated_at from documents where slack_webhook is not null and deleted_at is null and updated_at > slack_sent and updated_at < $1 and slack_sent < $2 limit 50',
    [now - 10 * 60_000, now - 30 * 60_000],
  );
  for (const d of slack) {
    const ch = await changesSince(ctx, d.id, d.slack_sent);
    const who = ch.editors.map((e) => `${e.name} (${e.edits} edits)`).join(', ') || 'Someone';
    await postSlack(d.slack_webhook, `:memo: *${d.title}* was updated by ${who}${ch.comments ? ` · ${ch.comments} new comment${ch.comments === 1 ? '' : 's'}` : ''}.\n<${baseUrl}/d/${d.id}|Open in CoWrite>`);
    await ctx.db.query('update documents set slack_sent = $2 where id = $1', [d.id, now]);
  }
  // Email digests.
  const subs = await ctx.db.query<{ doc_id: string; user_id: string; freq: string; last_sent: number; email: string; name: string; title: string; updated_at: number }>(
    `select s.doc_id, s.user_id, s.freq, s.last_sent, u.email, u.name, d.title, d.updated_at from subscriptions s
     join users u on u.id = s.user_id join documents d on d.id = s.doc_id
     where d.deleted_at is null and ((s.freq = 'daily' and s.last_sent < $1) or (s.freq = 'weekly' and s.last_sent < $2)) limit 200`,
    [now - 86_400_000, now - 7 * 86_400_000],
  );
  for (const s of subs) {
    await ctx.db.query('update subscriptions set last_sent = $3 where doc_id = $1 and user_id = $2', [s.doc_id, s.user_id, now]);
    if (s.updated_at <= s.last_sent) continue;
    const ch = await changesSince(ctx, s.doc_id, s.last_sent);
    if (!ch.editors.length && !ch.comments) continue;
    const lines = [
      `Hi ${s.name.split(' ')[0]},`,
      '',
      `Here is what changed in “${s.title}” since your last ${s.freq} update:`,
      ...ch.editors.map((e) => `• ${e.name}: ${e.edits} edits`),
      ...(ch.comments ? [`• ${ch.comments} new comment${ch.comments === 1 ? '' : 's'}`] : []),
      '',
      `Open it: ${baseUrl}/d/${s.doc_id}`,
      '',
      'You can change these emails from the document’s Review panel.',
    ];
    if (mailEnabled()) await sendMail(s.email, `${s.freq === 'daily' ? 'Daily' : 'Weekly'} update: ${s.title}`, lines.join('\n')).catch(() => {});
    else await ctx.notifier.add(s.user_id, 'reminder', s.doc_id, 'Digest', `“${s.title}” changed: ${ch.editors.map((e) => e.name).join(', ') || 'new comments'}`);
  }
}
