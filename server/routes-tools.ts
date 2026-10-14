import express from 'express';
import type { AppCtx } from './context.ts';
import { HttpError, rateLimit, requireUser, str } from './http.ts';

/** Slide themes the AI may pick from, by style. */
export const DECK_STYLES: Record<string, string[]> = {
  pro: ['growth', 'insight', 'finance', 'culture', 'brochure', 'industry', 'medical', 'onyx'],
  creative: ['innovation', 'marketing', 'techfuture', 'care', 'kinder', 'sunset', 'midnight'],
  classic: ['navy', 'university', 'minimal', 'corporate', 'forest', 'gold'],
};
const DOC_STYLES: Record<string, string[]> = {
  pro: ['executive', 'simple', 'report', 'modern'],
  creative: ['luxe', 'paperback', 'elegant', 'playful'],
  classic: ['classic', 'academic', 'mla', 'minimal'],
};
/** Stock photos in /tpl that generated decks can use. */
export const PHOTOS = [
  'dental', 'doctors', 'stethoscope', 'finance', 'calculator', 'classroom', 'elder', 'factory', 'office', 'teamwork', 'skyline', 'circuit', 'apps',
  'idea', 'marketing', 'architecture', 'forest', 'books', 'notebook', 'mountain', 'graduates', 'lecture', 'laptop', 'meeting', 'team-top', 'executive',
];
const LANGS = ['English', 'Hindi', 'Telugu', 'Tamil', 'Marathi', 'Bengali', 'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Urdu', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Japanese', 'Korean', 'Chinese (Simplified)', 'Arabic', 'Russian'];

const MARKDOWN_GUIDE = `Write GitHub-flavoured Markdown. You may also use these CoWrite extensions where they genuinely help:
- "->centred text<-" on its own line centres a line
- "> [!info] text", "> [!tip] text", "> [!warning] text" for callouts
- "{toc}" for a table of contents and "{pagebreak}" for a new page
- "- [ ] task" for checklists, tables with a header row, and \`\`\`mermaid blocks for simple flowcharts or gantt charts
Do not wrap the whole answer in a code fence.`;

const lang = (v: unknown) => (LANGS.includes(String(v)) ? String(v) : 'English');

/** AI tools that work on pasted text or uploaded files, without opening a document. */
export function toolRoutes(ctx: AppCtx) {
  const r = express.Router();
  const limiter = rateLimit(30, 10 * 60_000);
  const aiFor = (userId: string) => ctx.ai.for(userId);

  // ------------------------------------------------------------ Smart Create

  r.post('/ai/create', limiter, async (req, res) => {
    const user = requireUser(res);
    const kind = req.body?.kind === 'slides' ? 'slides' : 'doc';
    const style = ['pro', 'creative', 'classic'].includes(req.body?.style) ? String(req.body.style) : 'pro';
    const prompt = str(req.body?.prompt, 4000).trim();
    const source = str(req.body?.source, 60_000).trim();
    const pages = Math.min(20, Math.max(4, Number(req.body?.slides) || 9));
    if (prompt.length < 4 && source.length < 40) throw new HttpError(400, 'Describe what you want to create, or upload a document.');
    const ai = await aiFor(user.id);
    const brief = `${prompt ? `<request>\n${prompt}\n</request>\n` : ''}${source ? `<source_document>\n${source}\n</source_document>\nBase the content on the source document.\n` : ''}`;

    if (kind === 'doc') {
      const out = await ai.json<{ title: string; theme: string; markdown: string }>(
        `You are a senior business writer who creates complete, polished documents. ${MARKDOWN_GUIDE}`,
        `${brief}\nCreate the complete document the user asked for, ready to use: real headings, full paragraphs, and tables or checklists where they help. Write realistic example content instead of placeholders wherever you reasonably can. Style: ${style}. Pick the page theme that suits it.`,
        {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short document title' },
            theme: { type: 'string', enum: DOC_STYLES[style] },
            markdown: { type: 'string', description: 'The full document body in Markdown, starting with a # title' },
          },
          required: ['title', 'theme', 'markdown'],
          additionalProperties: false,
        },
        16000,
      );
      res.json({ kind, title: str(out.title, 200) || 'Untitled document', theme: DOC_STYLES[style].includes(out.theme) ? out.theme : DOC_STYLES[style][0], markdown: str(out.markdown, 200_000) });
      return;
    }

    const out = await ai.json<{ title: string; subtitle: string; theme: string; cover: string; slides: { layout: string; title: string; bullets: string[]; notes: string; photo: string }[] }>(
      'You are an expert presentation designer who writes clear, persuasive slide decks.',
      `${brief}\nCreate a presentation of about ${pages} slides (not counting the cover). Mix layouts for variety:
- "agenda": bullets are 3-5 short section names
- "title-content": 3-5 bullets under 14 words
- "image-text": 3-4 bullets beside a photo; choose the photo that fits best
- "stats": exactly 3 bullets, each "VALUE | caption" (e.g. "38% | growth in revenue")
- "process": 3-4 bullets, each "Step | short description"
- "two-column": an even number of bullets; the first half is the left column; start each column with its heading
- "quote": bullets[0] is the quote, title is who said it
- "section": a divider; bullets[0] is a one-line description
- "closing": the last slide, e.g. "Thank you" with contact details in bullets[0]
Speaker notes: 1-3 sentences. Style: ${style}.`,
      {
        type: 'object',
        properties: {
          title: { type: 'string' },
          subtitle: { type: 'string' },
          theme: { type: 'string', enum: DECK_STYLES[style] },
          cover: { type: 'string', enum: PHOTOS },
          slides: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                layout: { type: 'string', enum: ['agenda', 'title-content', 'image-text', 'stats', 'process', 'two-column', 'quote', 'section', 'closing'] },
                title: { type: 'string' },
                bullets: { type: 'array', items: { type: 'string' } },
                notes: { type: 'string' },
                photo: { type: 'string', enum: PHOTOS },
              },
              required: ['layout', 'title', 'bullets', 'notes', 'photo'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'subtitle', 'theme', 'cover', 'slides'],
        additionalProperties: false,
      },
      16000,
    );
    res.json({ kind, deck: { ...out, theme: DECK_STYLES[style].includes(out.theme) ? out.theme : DECK_STYLES[style][0], slides: (out.slides ?? []).slice(0, 30) } });
  });

  // ---------------------------------------------------------- text tools

  r.post('/ai/text', limiter, async (req, res) => {
    const user = requireUser(res);
    const task = str(req.body?.task, 30);
    const text = str(req.body?.text, 40_000).trim();
    const to = lang(req.body?.lang);
    const how = str(req.body?.instruction, 500).trim();
    if (text.length < 2) throw new HttpError(400, 'Paste or type some text first.');
    const ai = await aiFor(user.id);
    const doc = `<text>\n${text}\n</text>`;
    switch (task) {
      case 'spell': {
        const out = await ai.json<{ issues: { wrong: string; right: string; why: string }[]; corrected: string }>(
          'You are a meticulous proofreader. You fix spelling, grammar and punctuation without changing the meaning or the author’s voice.',
          `${doc}\n\nList every spelling, grammar and punctuation mistake (the exact wrong text, the correction and a short reason), then give the fully corrected text.`,
          {
            type: 'object',
            properties: {
              issues: { type: 'array', items: { type: 'object', properties: { wrong: { type: 'string' }, right: { type: 'string' }, why: { type: 'string' } }, required: ['wrong', 'right', 'why'], additionalProperties: false } },
              corrected: { type: 'string' },
            },
            required: ['issues', 'corrected'],
            additionalProperties: false,
          },
        );
        res.json(out);
        return;
      }
      case 'parallel': {
        const out = await ai.json<{ pairs: { source: string; translation: string }[] }>(
          'You are a professional translator. Translate faithfully and naturally.',
          `${doc}\n\nSplit the text into its paragraphs and translate each paragraph into ${to}. Return the pairs in order.`,
          {
            type: 'object',
            properties: { pairs: { type: 'array', items: { type: 'object', properties: { source: { type: 'string' }, translation: { type: 'string' } }, required: ['source', 'translation'], additionalProperties: false } } },
            required: ['pairs'],
            additionalProperties: false,
          },
        );
        res.json(out);
        return;
      }
      default: {
        const tasks: Record<string, [string, string]> = {
          proofread: ['You are a professional copy editor.', 'Proofread and polish this text: fix errors, improve clarity and flow, keep the meaning and length. Reply with the improved text only.'],
          refine: ['You are a skilled editor.', `Rewrite this text so it is clearer, more concise and more engaging${how ? `, and ${how}` : ''}. Reply with the rewritten text only.`],
          formal: ['You are a skilled editor.', 'Rewrite this text in a formal, professional tone. Reply with the rewritten text only.'],
          casual: ['You are a skilled editor.', 'Rewrite this text in a friendly, conversational tone. Reply with the rewritten text only.'],
          shorten: ['You are a skilled editor.', 'Make this text about half as long without losing the key points. Reply with the shorter text only.'],
          expand: ['You are a skilled writer.', 'Expand this text with more detail, examples and explanation, about twice as long. Reply with the expanded text only.'],
          translate: ['You are a professional translator.', `Translate this text into ${to}. Keep Markdown formatting. Reply with the translation only.`],
          summarize: ['You summarise documents for busy readers. Reply in Markdown.', 'Summarise this text: a one-paragraph overview, then "## Key points" as 3-7 bullets, then "## Action items" if there are any.'],
          'smart-edit': ['You are a careful editor. Reply in Markdown.', `Apply this instruction to the text and return the full edited text only: ${how || 'improve it'}.`],
          resume: [
            `You are an expert career coach and resume writer. ${MARKDOWN_GUIDE}`,
            `Using these details about the person, write a polished one-page resume in Markdown: "# Name", a contact line, "## Summary", "## Experience" with achievement bullets that start with strong verbs and include numbers where given, "## Projects", "## Education" and "## Skills". Do not invent employers or degrees that are not mentioned.${how ? ` Target role: ${how}.` : ''}`,
          ],
          'cover-letter': ['You are an expert career coach.', `Write a concise, specific cover letter (under 300 words) from these details.${how ? ` The job: ${how}.` : ''} Reply with the letter only.`],
          outline: [`You are a senior writer. ${MARKDOWN_GUIDE}`, 'Turn this into a well-structured outline with headings and bullet points.'],
        };
        const t = tasks[task];
        if (!t) throw new HttpError(400, 'Unknown tool.');
        res.json({ text: await ai.text(t[0], `${doc}\n\n${t[1]}`, 12000) });
      }
    }
  });

  // ---------------------------------------------------------- file tools

  r.post('/ai/file', limiter, express.raw({ type: () => true, limit: '12mb' }), async (req, res) => {
    const user = requireUser(res);
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (data.length < 20) throw new HttpError(400, 'Choose a file first.');
    const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim();
    const isPdf = mime === 'application/pdf';
    if (!isPdf && !/^image\/(png|jpeg|webp|gif)$/.test(mime)) throw new HttpError(400, 'Upload a PDF or an image (PNG, JPG or WebP).');
    const task = str(req.query.task, 30);
    const q = str(req.query.q, 1000).trim();
    const to = lang(req.query.lang);
    const asks: Record<string, string> = {
      extract: 'Extract all the text of this file in reading order as clean Markdown. Keep headings, lists and tables. Reply with the Markdown only.',
      'to-word': 'Convert this file into a well-formatted Markdown document that matches the original as closely as possible: headings, paragraphs, bullet and numbered lists, and tables. Reply with the Markdown only.',
      'image-text': 'Transcribe all the text in this image exactly, in reading order, as clean Markdown. Reply with the Markdown only.',
      'translate-image': `Read all the text in this file and translate it into ${to}. Keep the structure (headings, lists, tables) in Markdown. Reply with the translation only.`,
      summarize: 'Summarise this file: a one-paragraph overview, then "## Key points" as 3-7 bullets. Reply in Markdown.',
      chat: `Answer the question using only this file. Quote the relevant passage when helpful and say plainly if the file does not contain the answer.\n\nQuestion: ${q}`,
    };
    const ask = asks[task];
    if (!ask) throw new HttpError(400, 'Unknown tool.');
    if (task === 'chat' && !q) throw new HttpError(400, 'Ask a question about the file.');
    const ai = await aiFor(user.id);
    res.json({ text: await ai.llm.image(data, mime, ask, 16000) });
  });

  // ------------------------------------------------------------ assistant

  /** Chat with the assistant; the answer streams back as plain text. */
  r.post('/ai/chat', rateLimit(60, 10 * 60_000), async (req, res) => {
    const user = requireUser(res);
    const raw = Array.isArray(req.body?.messages) ? (req.body.messages as { role?: unknown; text?: unknown }[]) : [];
    const messages = raw.slice(-20).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: str(m.text, 12_000) })).filter((m) => m.text.trim());
    if (!messages.length || messages[messages.length - 1].role !== 'user') throw new HttpError(400, 'Ask something first.');
    const ai = await aiFor(user.id);
    const history = messages
      .slice(0, -1)
      .map((m) => `<${m.role}>\n${m.text}\n</${m.role}>`)
      .join('\n');
    const prompt = `${history ? `Conversation so far:\n${history}\n\n` : ''}${messages[messages.length - 1].text}`;
    const system = `You are ${ai.name === 'Claude' ? 'Claude' : 'a helpful assistant'} inside CoWrite, a collaborative writing app. The user is ${user.name}. Be warm, clear and concise. Use Markdown (headings, lists, tables, code blocks) when it helps. Today is ${new Date().toDateString()}.`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-AI-Name', ai.name);
    try {
      for await (const part of ai.llm.stream(system, prompt, 8000)) res.write(part);
    } catch (err) {
      if (!res.headersSent) throw err;
      res.write(`\n\n_${err instanceof HttpError ? err.message : 'The answer was interrupted. Please try again.'}_`);
    }
    res.end();
  });

  // ---------------------------------------------- backup and batch tools

  /** Text of your documents, for the Backup Center and Batch Print. */
  r.get('/me/backup', rateLimit(20, 10 * 60_000), async (req, res) => {
    const user = requireUser(res);
    const ids = String(req.query.ids ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter((x) => /^[\w-]{1,64}$/.test(x))
      .slice(0, 200);
    const rows = await ctx.db.query<{ id: string; title: string; kind: string; updated_at: number; encrypted: boolean; content_text: string }>(
      `select d.id, d.title, d.kind, d.updated_at, d.encrypted, d.content_text from documents d
       where d.deleted_at is null and (d.owner_id = $1 or exists (select 1 from doc_members m where m.doc_id = d.id and m.user_id = $1))
       ${ids.length ? 'and d.id = any($2)' : ''}
       order by d.updated_at desc limit 500`,
      ids.length ? [user.id, ids] : [user.id],
    );
    res.json({
      exportedAt: Date.now(),
      documents: rows.map((d) => ({ id: d.id, title: d.title, kind: d.kind, updatedAt: d.updated_at, encrypted: d.encrypted, text: d.encrypted ? '' : d.content_text })),
    });
  });

  return r;
}
