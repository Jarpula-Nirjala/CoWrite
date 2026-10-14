import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { BLOCK, EMBED, type Id, type Token } from '../shared/crdt.ts';
import type { PeerInfo, Selection } from '../shared/protocol.ts';
import { inlineTokens, markdownToTokens, type NewToken } from '../shared/rich.ts';
import { randomSite } from '../shared/sync-client.ts';
import { HttpError } from './http.ts';
import type { Room } from './rooms.ts';

export type AiAction = 'continue' | 'summarize' | 'rewrite' | 'grammar' | 'shorten' | 'expand' | 'custom' | 'tone';
export const AI_ACTIONS: AiAction[] = ['continue', 'summarize', 'rewrite', 'grammar', 'shorten', 'expand', 'custom', 'tone'];
const NEEDS_SELECTION = new Set<AiAction>(['rewrite', 'grammar', 'shorten', 'expand', 'tone']);
export const TONES = ['formal', 'casual', 'persuasive', 'simple', 'friendly', 'confident', 'academic'] as const;

export const AI_NAME = 'Claude';
export const AI_COLOR = '#c15f3c';
const MODEL = 'claude-opus-5-5';
const BETAS = ['server-side-fallback-2026-07-01'];

export interface AiResult {
  /** Characters Claude inserted (the client can undo them). */
  inserted: Id[];
  /** Characters Claude replaced, with their original content for undo. */
  deleted: Id[];
  original: Token[];
  site: string;
}

const SYSTEM = `You are Claude, a writing assistant working inside CoWrite, a collaborative rich-text editor.
Your output is inserted directly into the shared document as you write it, so reply with the document text only:
no preamble, no explanations, no surrounding quotes or code fences.
You may use Markdown for structure (# headings, - bullets, 1. numbered lists, - [ ] tasks, **bold**, *italic*);
it is converted into real formatting. Match the language, tone and conventions of the surrounding document.`;

function instructionFor(action: AiAction, custom: string): string {
  switch (action) {
    case 'continue':
      return 'Continue writing from the cursor position marked ⟦CURSOR⟧. Write one or two natural paragraphs that follow on from the text before the cursor and fit with the text after it. Output only the new text.';
    case 'summarize':
      return 'Write a concise summary (3 to 6 bullet points) of the whole document. Start with the line "## Summary". Output only the summary.';
    case 'rewrite':
      return 'Rewrite the selected passage to be clearer and more engaging while keeping its meaning. Output only the replacement for the selection.';
    case 'grammar':
      return 'Fix spelling, grammar and punctuation in the selected passage. Change nothing else. Output only the corrected passage.';
    case 'shorten':
      return 'Make the selected passage about half as long while keeping the key points. Output only the replacement for the selection.';
    case 'expand':
      return 'Expand the selected passage with more detail and examples, roughly doubling its length. Output only the replacement for the selection.';
    case 'tone':
      return `Rewrite the selected passage in a ${custom || 'formal'} tone, keeping its meaning and roughly its length. Output only the replacement for the selection.`;
    case 'custom':
      return `Follow this instruction from the user: "${custom}". If text is selected, output only its replacement; otherwise output only the text to insert at ⟦CURSOR⟧.`;
  }
}

/** Readable text of tokens (objects shown as placeholders) for prompts. */
export function promptText(tokens: Token[]): string {
  return tokens.map((t) => (t.ch === EMBED ? (t.attrs.atom ? `[${String(t.attrs.atom)}]` : '') : t.ch)).join('');
}

function errorFor(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof Anthropic.RateLimitError) return new HttpError(429, 'The AI service is busy right now. Please try again shortly.');
  if (err instanceof Anthropic.AuthenticationError) return new HttpError(503, 'The AI features are misconfigured (invalid API key).');
  if (err instanceof Anthropic.BadRequestError) return new HttpError(400, 'The AI service could not process this request.');
  if (err instanceof Anthropic.APIError) return new HttpError(502, `The AI service returned an error (${err.status ?? 'network'}).`);
  return new HttpError(500, 'The AI request failed.');
}

/** The AI co-writer: Claude joins the room as a peer and types its answer in live. */
export class AiWriter {
  private readonly client: Anthropic | null;
  private readonly busy = new Set<string>();

  constructor() {
    this.client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  private need(): Anthropic {
    if (!this.client) throw new HttpError(503, 'AI features are not configured on this server (ANTHROPIC_API_KEY is missing).');
    return this.client;
  }

  // ----------------------------------------------------- one-shot helpers

  /** A plain text answer. */
  async text(system: string, prompt: string, maxTokens = 8000): Promise<string> {
    const client = this.need();
    try {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: maxTokens,
        output_config: { effort: 'low' },
        betas: BETAS,
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') throw new HttpError(422, 'Claude declined this request.');
      return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    } catch (err) {
      throw errorFor(err);
    }
  }

  /** A JSON answer that matches `schema` (structured outputs). */
  async json<T>(system: string, prompt: string, schema: Record<string, unknown> & { type: 'object' }, maxTokens = 12000): Promise<T> {
    const client = this.need();
    try {
      const msg = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: maxTokens,
        output_config: { effort: 'low', format: betaJSONSchemaOutputFormat(schema) },
        betas: BETAS,
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      if (msg.stop_reason === 'refusal') throw new HttpError(422, 'Claude declined this request.');
      if (!msg.parsed_output) throw new HttpError(502, 'The AI returned an unexpected answer. Please try again.');
      return msg.parsed_output as T;
    } catch (err) {
      throw errorFor(err);
    }
  }

  /** Describes an image (vision). */
  async describeImage(data: Buffer, mime: string, ask: string): Promise<string> {
    const client = this.need();
    const media = (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime) ? mime : 'image/png') as 'image/png';
    try {
      const msg = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: 'low' },
        betas: BETAS,
        fallbacks: 'default',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: media, data: data.toString('base64') } },
              { type: 'text', text: ask },
            ],
          },
        ],
      });
      if (msg.stop_reason === 'refusal') throw new HttpError(422, 'Claude declined this request.');
      return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    } catch (err) {
      throw errorFor(err);
    }
  }

  // ------------------------------------------------------- live co-writer

  async run(room: Room, action: AiAction, sel: Selection, custom: string, onSite: (site: string) => void): Promise<AiResult> {
    const client = this.need();
    if (room.encrypted) throw new HttpError(400, 'The AI co-writer is unavailable in end-to-end encrypted documents, because the server cannot read them.');
    if (this.busy.has(room.id)) throw new HttpError(409, 'Claude is already writing in this document. Please wait for it to finish.');

    const doc = room.doc;
    const tokens = doc.tokens();
    let from = sel ? Math.max(0, doc.posAfter(sel[0])) : tokens.length;
    let to = sel ? Math.max(0, doc.posAfter(sel[1])) : tokens.length;
    if (from > to) [from, to] = [to, from];
    const hasSelection = to > from;
    if (NEEDS_SELECTION.has(action) && !hasSelection) throw new HttpError(400, 'Select some text first.');

    const before = promptText(tokens.slice(0, from));
    const selected = promptText(tokens.slice(from, to));
    const after = promptText(tokens.slice(to));
    let prompt: string;
    if (action === 'summarize') prompt = `<document>\n${before}${selected}${after}\n</document>\n\n${instructionFor(action, custom)}`;
    else if (hasSelection) prompt = `<document>\n${before}⟦SELECTION START⟧${selected}⟦SELECTION END⟧${after}\n</document>\n\n<selection>\n${selected}\n</selection>\n\n${instructionFor(action, custom)}`;
    else prompt = `<document>\n${before}⟦CURSOR⟧${after}\n</document>\n\n${instructionFor(action, custom)}`;

    this.busy.add(room.id);
    const site = `claude-${randomSite()}`;
    onSite(site);
    const peer: PeerInfo = { site, name: AI_NAME, color: AI_COLOR, sel: null, userId: null, state: 'active', typing: true };
    const replace = hasSelection && action !== 'summarize';
    const result: AiResult = { inserted: [], deleted: [], original: replace ? tokens.slice(from, to) : [], site };

    try {
      // Replacements go inline where the selection was; new writing goes in
      // fresh paragraphs after the cursor's paragraph (or at the end).
      let anchor: Id | null;
      if (replace) {
        anchor = doc.idBefore(from);
        result.deleted = doc.idsInRange(from, to);
        room.publish(doc.deleteIds(result.deleted, site), peer);
      } else {
        const start = action === 'summarize' ? tokens.length : from;
        let end = -1;
        for (let i = start; i < tokens.length; i++) {
          if (tokens[i].ch === BLOCK || (tokens[i].ch === EMBED && tokens[i].attrs.atom)) {
            end = i;
            break;
          }
        }
        if (end >= 0) anchor = tokens[end].id;
        else if (tokens.length) {
          // The last paragraph has no terminator yet: give it one.
          anchor = doc.idAt(tokens.length - 1);
          anchor = this.insert(room, peer, anchor, [{ ch: BLOCK }], result);
        } else anchor = null;
      }
      room.setVirtualPeer(site, { ...peer, sel: [anchor, anchor] });

      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        // Writing help should feel quick; low effort keeps latency down.
        output_config: { effort: 'low' },
        betas: BETAS,
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      });

      // Text arrives in fragments; whole lines are converted from Markdown.
      let pending = '';
      let firstLine = true;
      const emitLine = (line: string, final: boolean) => {
        let toks: NewToken[];
        if (replace) {
          toks = inlineTokens(line.replace(/^#{1,6}\s+|^\s*[-*]\s+/, ''));
          if (!final) toks.push({ ch: BLOCK });
        } else {
          toks = markdownToTokens(line);
        }
        if (!toks.length) return;
        if (replace && firstLine && !line.trim()) return;
        firstLine = false;
        anchor = this.insert(room, peer, anchor, toks, result);
      };
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          pending += event.delta.text;
          let nl = pending.indexOf('\n');
          while (nl >= 0) {
            emitLine(pending.slice(0, nl), false);
            pending = pending.slice(nl + 1);
            nl = pending.indexOf('\n');
          }
        }
      }
      if (pending) emitLine(pending, true);
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') {
        this.revert(room, peer, result);
        throw new HttpError(422, 'Claude declined this request.');
      }
      return result;
    } catch (err) {
      this.revert(room, peer, result);
      throw errorFor(err);
    } finally {
      room.setVirtualPeer(site, null);
      this.busy.delete(room.id);
    }
  }

  private insert(room: Room, peer: PeerInfo, anchor: Id | null, toks: NewToken[], result: AiResult): Id | null {
    if (!toks.length) return anchor;
    const doc = room.doc;
    const pos = anchor ? doc.posAfter(anchor) : 0;
    const ops = doc.insertTokens(Math.max(0, pos), toks, peer.site);
    room.publish(ops, peer);
    for (const op of ops) result.inserted.push(op.id);
    const last = ops[ops.length - 1].id;
    room.setVirtualPeer(peer.site, { ...peer, sel: [last, last] });
    return last;
  }

  /** Undo a failed run: remove what was typed, restore what was replaced. */
  private revert(room: Room, peer: PeerInfo, result: AiResult): void {
    const doc = room.doc;
    room.publish(doc.deleteIds(result.inserted, peer.site), peer);
    if (result.deleted.length && result.original.length) {
      const at = doc.locate(result.deleted[0])?.pos ?? doc.length;
      room.publish(doc.insertTokens(at, result.original.map((t) => ({ ch: t.ch, a: t.attrs })), peer.site), peer);
    }
    result.inserted = [];
  }
}
