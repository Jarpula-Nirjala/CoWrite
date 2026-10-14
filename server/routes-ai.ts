import crypto from 'node:crypto';
import express from 'express';
import { isSelection } from '../shared/protocol.ts';
import { blocksOf, markdownToTokens, plainText } from '../shared/rich.ts';
import { AI_ACTIONS, AI_COLOR, AI_NAME, TONES, promptText, type AiAction } from './ai.ts';
import { docAccess, type AppCtx } from './context.ts';
import { HttpError, rateLimit, requireUser, str } from './http.ts';
import { safeFetchBinary } from './routes-media.ts';

const LANGS = ['Hindi', 'Telugu', 'Tamil', 'Marathi', 'Bengali', 'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Urdu', 'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Japanese', 'Korean', 'Chinese (Simplified)', 'Arabic', 'Russian'];

export function aiRoutes(ctx: AppCtx) {
  const r = express.Router();
  const { db, rooms, ai } = ctx;
  const limiter = rateLimit(40, 10 * 60_000);

  async function roomText(docId: string) {
    const room = await rooms.open(docId);
    if (!room) throw new HttpError(503, 'Server busy, try again.');
    if (room.encrypted) throw new HttpError(400, 'AI features are unavailable in end-to-end encrypted documents.');
    return { room, tokens: room.doc.tokens() };
  }

  // ----------------------------------------------------- live co-writer

  r.post('/docs/:id/ai', limiter, async (req, res) => {
    const a = await docAccess(ctx, req, res, 'editor');
    const action = req.body?.action as AiAction;
    if (!AI_ACTIONS.includes(action)) throw new HttpError(400, 'Unknown AI action.');
    const sel = req.body?.selection ?? null;
    if (!isSelection(sel)) throw new HttpError(400, 'Invalid selection.');
    const custom = str(req.body?.instruction, 500).trim();
    if (action === 'custom' && !custom) throw new HttpError(400, 'Tell Claude what to do.');
    if (action === 'tone' && !(TONES as readonly string[]).includes(custom)) throw new HttpError(400, 'Unknown tone.');
    const room = await rooms.open(a.docId);
    if (!room) throw new HttpError(503, 'Server busy, try again.');
    const result = await ai.run(room, action, sel, custom, (site) => {
      void db.query('insert into sites (doc_id, site, user_id, name, color, first_seen) values ($1, $2, null, $3, $4, $5) on conflict do nothing', [
        a.docId,
        site,
        AI_NAME,
        AI_COLOR,
        Date.now(),
      ]);
    });
    res.json(result);
  });

  // ------------------------------------------------------- tool requests

  r.post('/docs/:id/ai/tool', limiter, async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer');
    const tool = str(req.body?.tool, 40);
    const input = (req.body?.input ?? {}) as Record<string, unknown>;
    switch (tool) {
      case 'summarize': {
        const { tokens } = await roomText(a.docId);
        const text = plainText(tokens);
        if (text.trim().length < 40) throw new HttpError(400, 'Write a little more before asking for a summary.');
        res.json({
          text: await ai.text(
            'You summarise documents. Reply with the summary only: no heading, no preamble.',
            `<document>\n${text}\n</document>\n\nSummarise this document in two to four plain sentences.`,
            2000,
          ),
        });
        return;
      }
      case 'describe-image': {
        const src = str(input.src, 2000);
        let data: Buffer;
        let mime = 'image/png';
        const m = /^\/api\/files\/([\w-]+)$/.exec(src.split('?')[0]);
        if (m) {
          const [f] = await db.query<{ data: Buffer | Uint8Array; mime: string }>('select data, mime from files where id = $1', [m[1]]);
          if (!f) throw new HttpError(404, 'Image not found.');
          data = Buffer.from(f.data);
          mime = f.mime;
        } else {
          const got = await safeFetchBinary(src, 5_000_000);
          data = got.data;
          mime = got.type;
        }
        res.json({ text: await ai.describeImage(data, mime, 'Write one or two sentences of alt text describing this image for someone who cannot see it. Reply with the description only.') });
        return;
      }
      case 'whiteboard-to-text': {
        const src = str(input.src, 2000);
        const m = /^\/api\/files\/([\w-]+)$/.exec(src.split('?')[0]);
        if (!m) throw new HttpError(400, 'Upload the photo first.');
        const [f] = await db.query<{ data: Buffer | Uint8Array; mime: string }>('select data, mime from files where id = $1', [m[1]]);
        if (!f) throw new HttpError(404, 'Image not found.');
        res.json({
          text: await ai.describeImage(
            Buffer.from(f.data),
            f.mime,
            'This is a photo of a whiteboard, notebook page or handwritten notes. Transcribe it into clean Markdown: keep headings, bullet points, numbered steps and arrows as lists. Reply with the Markdown only.',
          ),
        });
        return;
      }
      case 'board-summary': {
        const notes = str(input.text, 20_000);
        if (notes.trim().length < 10) throw new HttpError(400, 'Add some sticky notes or text first.');
        res.json({
          text: await ai.text(
            'You turn the sticky notes of a collaborative whiteboard into a short written summary. Reply with plain text only: no Markdown symbols, no preamble.',
            `<board>\n${notes}\n</board>\n\nGroup related notes into themes and write a summary of 3 to 6 short lines, ending with the clearest next steps.`,
            1500,
          ),
        });
        return;
      }
      default:
        throw new HttpError(400, 'Unknown AI tool.');
    }
  });

  /** AI reviewer: comments anchored to quotes in the document. */
  r.post('/docs/:id/ai/review', limiter, async (req, res) => {
    const a = await docAccess(ctx, req, res, 'commenter');
    const { tokens } = await roomText(a.docId);
    const text = plainText(tokens);
    if (text.trim().length < 80) throw new HttpError(400, 'The document is too short to review.');
    const focus = str(req.body?.focus, 200) || 'clarity, tone, structure, grammar and persuasiveness';
    const out = await ai.json<{ comments: { quote: string; comment: string; kind: string }[] }>(
      'You are a careful human editor reviewing a document. You leave specific, actionable comments, like an editor in Google Docs.',
      `<document>\n${text}\n</document>\n\nReview this document with a focus on ${focus}. Leave 3 to 8 comments. Each comment must quote a short exact passage (5 to 80 characters, copied exactly from the document) and explain the issue and a concrete improvement.`,
      {
        type: 'object',
        properties: {
          comments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string', description: 'Exact text copied from the document' },
                comment: { type: 'string' },
                kind: { type: 'string', enum: ['clarity', 'grammar', 'tone', 'structure', 'fact', 'style'] },
              },
              required: ['quote', 'comment', 'kind'],
              additionalProperties: false,
            },
          },
        },
        required: ['comments'],
        additionalProperties: false,
      },
    );
    // Anchor each comment to the quoted characters.
    const flat = tokens.map((t) => (t.ch === '\n' ? '\n' : t.ch === '￼' ? '\u0000' : t.ch)).join('');
    let added = 0;
    for (const c of out.comments) {
      const at = flat.indexOf(c.quote);
      if (at < 0 || !c.quote) continue;
      const start = tokens[at].id;
      const end = tokens[at + c.quote.length - 1].id;
      await db.query(
        `insert into comments (id, doc_id, parent_id, anchor_start, anchor_end, quote, body, author_id, author_name, color, created_at)
         values ($1, $2, null, $3::jsonb, $4::jsonb, $5, $6, null, $7, $8, $9)`,
        [crypto.randomUUID().slice(0, 12), a.docId, JSON.stringify(start), JSON.stringify(end), c.quote, `[${c.kind}] ${c.comment}`, `${AI_NAME} (AI reviewer)`, AI_COLOR, Date.now() + added],
      );
      added++;
    }
    rooms.loaded(a.docId)?.notify('comments');
    res.json({ added });
  });

  /** Turns a document into a slide deck (creates a new slides document). */
  r.post('/docs/:id/ai/slides', limiter, async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer');
    const user = requireUser(res);
    const { tokens } = await roomText(a.docId);
    const text = promptText(tokens);
    if (plainText(tokens).trim().length < 60) throw new HttpError(400, 'Write some content first: the deck is built from the document.');
    const deck = await ai.json<{ title: string; subtitle: string; slides: { layout: string; title: string; bullets: string[]; notes: string }[] }>(
      'You turn documents into clear, well-structured presentation decks.',
      `<document>\n${text}\n</document>\n\nCreate a presentation of 6 to 12 slides from this document. Use short bullet points (at most 6 per slide, under 14 words each). Speaker notes should be 1-3 sentences.`,
      {
        type: 'object',
        properties: {
          title: { type: 'string' },
          subtitle: { type: 'string' },
          slides: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                layout: { type: 'string', enum: ['title-content', 'two-column', 'quote', 'section'] },
                title: { type: 'string' },
                bullets: { type: 'array', items: { type: 'string' } },
                notes: { type: 'string' },
              },
              required: ['layout', 'title', 'bullets', 'notes'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'subtitle', 'slides'],
        additionalProperties: false,
      },
    );
    const doc = await ctx.docs.create(user.id, { title: `${deck.title} (slides)`, kind: 'slides' });
    res.status(201).json({ document: { id: doc.id }, deck });
  });

  /** Live translation: a linked copy that follows the source document. */
  r.post('/docs/:id/ai/translate', limiter, async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const user = requireUser(res);
    const lang = str(req.body?.lang, 40);
    if (!LANGS.includes(lang)) throw new HttpError(400, 'Choose a supported language.');
    await roomText(a.docId);
    const doc = await ctx.docs.create(user.id, { title: `${a.doc!.title} (${lang})`, kind: 'doc', translatedFrom: a.docId, lang });
    await syncTranslation(ctx, doc.id);
    res.status(201).json({ document: { id: doc.id } });
  });

  r.post('/docs/:id/ai/translate/sync', limiter, async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    if (!a.doc!.translated_from) throw new HttpError(400, 'This is not a translation.');
    res.json(await syncTranslation(ctx, a.docId));
  });

  /** Meeting mode: transcript in, structured notes out. */
  r.post('/docs/:id/ai/meeting', limiter, async (req, res) => {
    await docAccess(ctx, req, res, 'editor');
    const transcript = str(req.body?.transcript, 60_000).trim();
    if (transcript.length < 40) throw new HttpError(400, 'The transcript is too short.');
    const md = await ai.text(
      'You write clear meeting notes from transcripts. Reply in Markdown only.',
      `<transcript>\n${transcript}\n</transcript>\n\nWrite meeting notes with these sections: "## Summary" (2-4 sentences), "## Key points" (bullets), "## Decisions" (bullets), "## Action items" (as "- [ ] Owner – task – due date if mentioned"). Omit a section if there is nothing for it.`,
      6000,
    );
    res.json({ markdown: md });
  });

  /** Ask questions across all your documents. */
  r.post('/ai/ask', limiter, async (req, res) => {
    const user = requireUser(res);
    const question = str(req.body?.question, 1000).trim();
    if (!question) throw new HttpError(400, 'Ask a question first.');
    const words = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])].slice(0, 8);
    const rows = await db.query<{ id: string; title: string; content_text: string; updated_at: number }>(
      `select d.id, d.title, d.content_text, d.updated_at from documents d
       where d.deleted_at is null and not d.encrypted and (d.owner_id = $1 or exists (select 1 from doc_members m where m.doc_id = d.id and m.user_id = $1))
       order by d.updated_at desc limit 200`,
      [user.id],
    );
    // Rank documents by how many question words they contain, then by recency.
    const scored = rows
      .map((d) => {
        const hay = `${d.title}\n${d.content_text}`.toLowerCase();
        return { d, score: words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0) };
      })
      .sort((x, y) => y.score - x.score || y.d.updated_at - x.d.updated_at)
      .slice(0, 12);
    if (!scored.length) throw new HttpError(400, 'You have no documents to search yet.');
    let budget = 150_000;
    const context = scored
      .map(({ d }) => {
        const body = d.content_text.slice(0, Math.max(0, Math.min(30_000, budget)));
        budget -= body.length;
        return `<doc id="${d.id}" title="${d.title.replace(/"/g, "'")}">\n${body}\n</doc>`;
      })
      .join('\n');
    const answer = await ai.text(
      'You answer questions using only the user\'s documents provided. Cite the documents you used as [Title](/d/ID). If the documents do not contain the answer, say so plainly.',
      `${context}\n\nQuestion: ${question}`,
      4000,
    );
    res.json({ answer, sources: scored.filter((s) => s.score > 0).map((s) => ({ id: s.d.id, title: s.d.title })) });
  });

  return r;
}

/** Re-translates changed paragraphs of a linked translation (cached by paragraph hash). */
export async function syncTranslation(ctx: AppCtx, targetId: string) {
  const target = await ctx.docs.get(targetId);
  if (!target?.translated_from || !target.lang) return { translated: 0 };
  const source = await ctx.rooms.open(target.translated_from);
  const room = await ctx.rooms.open(targetId);
  if (!source || !room) throw new HttpError(503, 'Server busy, try again.');
  const blocks = blocksOf(source.doc.tokens());
  const md = blocks.map((b) => (b.type === 'text' ? markdownLine(b) : ''));
  const hashes = md.map((m) => crypto.createHash('sha1').update(m).digest('hex'));
  const cached = new Map(
    (await ctx.db.query<{ src_hash: string; text: string }>('select src_hash, text from translations where target_id = $1 and src_hash = any($2)', [targetId, hashes])).map((r) => [
      r.src_hash,
      r.text,
    ]),
  );
  const missing = md.map((m, i) => ({ m, h: hashes[i] })).filter((x) => x.m.trim() && !cached.has(x.h));
  // Translate new paragraphs in batches, keeping their order with markers.
  for (let i = 0; i < missing.length; i += 40) {
    const batch = missing.slice(i, i + 40);
    const out = await ctx.ai.json<{ items: { n: number; text: string }[] }>(
      'You are a professional translator. Translate faithfully, keeping Markdown markers (#, -, **, [ ]) unchanged.',
      `Translate each numbered paragraph into ${target.lang}.\n\n${batch.map((x, k) => `<p n="${k}">${x.m}</p>`).join('\n')}`,
      {
        type: 'object',
        properties: { items: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, text: { type: 'string' } }, required: ['n', 'text'], additionalProperties: false } } },
        required: ['items'],
        additionalProperties: false,
      },
    );
    for (const it of out.items) {
      const x = batch[it.n];
      if (!x) continue;
      cached.set(x.h, it.text);
      await ctx.db.query('insert into translations (target_id, src_hash, text) values ($1, $2, $3) on conflict do nothing', [targetId, x.h, it.text]);
    }
  }
  // Rebuild the translation's content (it is read-only for people).
  const translated = md.map((m, i) => (m.trim() ? (cached.get(hashes[i]) ?? m) : '')).filter(Boolean).join('\n');
  const target_tokens = markdownToTokens(translated);
  const doc = room.doc;
  const ops = [...doc.delete(0, doc.length, 'translator'), ...doc.insertTokens(0, target_tokens, 'translator')];
  room.publish(ops, null);
  return { translated: missing.length };
}

function markdownLine(b: Extract<ReturnType<typeof blocksOf>[number], { type: 'text' }>): string {
  const prefix = b.kind === 'h' ? `${'#'.repeat(Number(b.attrs.level || 1))} ` : b.kind === 'li' ? '- ' : b.kind === 'oli' ? '1. ' : b.kind === 'task' ? `- [${b.attrs.checked ? 'x' : ' '}] ` : b.kind === 'quote' ? '> ' : '';
  return prefix + b.parts.map((p) => (p.marks.b ? `**${p.text}**` : p.marks.i ? `*${p.text}*` : p.text)).join('');
}
