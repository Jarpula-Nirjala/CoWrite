import Anthropic from '@anthropic-ai/sdk';
import { keyOf, type Id } from '../shared/crdt.ts';
import type { PeerInfo, Selection } from '../shared/protocol.ts';
import { randomSite } from '../shared/sync-client.ts';
import { HttpError } from './http.ts';
import type { Room } from './rooms.ts';

export type AiAction = 'continue' | 'summarize' | 'rewrite' | 'grammar' | 'shorten' | 'expand' | 'custom';
export const AI_ACTIONS: AiAction[] = ['continue', 'summarize', 'rewrite', 'grammar', 'shorten', 'expand', 'custom'];
const NEEDS_SELECTION = new Set<AiAction>(['rewrite', 'grammar', 'shorten', 'expand']);

export const AI_NAME = 'Claude';
export const AI_COLOR = '#c15f3c';
const MODEL = 'claude-opus-5-5';

export interface AiResult {
  /** Characters Claude inserted (the client can undo them). */
  inserted: Id[];
  /** Characters Claude replaced, with their original text for undo. */
  deleted: Id[];
  original: string;
  site: string;
}

const SYSTEM = `You are Claude, a writing assistant working inside CoWrite, a collaborative Markdown editor.
Your output is inserted directly into the shared document as you write it, so reply with the document text only:
no preamble, no explanations, no surrounding quotes or code fences. Markdown formatting is fine.
Match the language, tone and formatting conventions of the surrounding document.`;

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
    case 'custom':
      return `Follow this instruction from the user: "${custom}". If text is selected, output only its replacement; otherwise output only the text to insert at ⟦CURSOR⟧.`;
  }
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

  async run(room: Room, action: AiAction, sel: Selection, custom: string, onSite: (site: string) => void): Promise<AiResult> {
    if (!this.client) throw new HttpError(503, 'The AI co-writer is not configured on this server (ANTHROPIC_API_KEY is missing).');
    if (room.encrypted) throw new HttpError(400, 'The AI co-writer is unavailable in end-to-end encrypted documents, because the server cannot read them.');
    if (this.busy.has(room.id)) throw new HttpError(409, 'Claude is already writing in this document. Please wait for it to finish.');

    const doc = room.doc;
    const text = doc.text();
    let from = sel ? Math.max(0, doc.posAfter(sel[0])) : text.length;
    let to = sel ? Math.max(0, doc.posAfter(sel[1])) : text.length;
    if (from > to) [from, to] = [to, from];
    const hasSelection = to > from;
    if (NEEDS_SELECTION.has(action) && !hasSelection) throw new HttpError(400, 'Select some text first.');

    let prompt: string;
    if (action === 'summarize') {
      prompt = `<document>\n${text}\n</document>\n\n${instructionFor(action, custom)}`;
      from = to = text.length;
    } else if (hasSelection) {
      prompt = `<document>\n${text.slice(0, from)}⟦SELECTION START⟧${text.slice(from, to)}⟦SELECTION END⟧${text.slice(to)}\n</document>\n\n<selection>\n${text.slice(from, to)}\n</selection>\n\n${instructionFor(action, custom)}`;
    } else {
      prompt = `<document>\n${text.slice(0, from)}⟦CURSOR⟧${text.slice(from)}\n</document>\n\n${instructionFor(action, custom)}`;
    }

    this.busy.add(room.id);
    const site = `claude-${randomSite()}`;
    onSite(site);
    const peer: PeerInfo = { site, name: AI_NAME, color: AI_COLOR, sel: null, userId: null, state: 'active', typing: true };
    const result: AiResult = { inserted: [], deleted: [], original: text.slice(from, to), site };

    try {
      // Replace the selection first, then stream the new text in after the
      // character before it. Anchoring by id keeps us in place while others type.
      let anchor: Id | null = doc.idBefore(from);
      if (hasSelection && action !== 'summarize') {
        result.deleted = doc.idsInRange(from, to);
        room.publish(doc.deleteIds(result.deleted, site), peer);
      } else if (action === 'summarize' && text.length && !text.endsWith('\n\n')) {
        anchor = this.write(room, peer, anchor, text.endsWith('\n') ? '\n' : '\n\n', result);
      }
      room.setVirtualPeer(site, { ...peer, sel: [anchor, anchor] });

      const stream = this.client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        // Writing help should feel quick; low effort keeps latency down.
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      });

      let buffer = '';
      let lastFlush = Date.now();
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          buffer += event.delta.text;
          if (Date.now() - lastFlush > 60) {
            anchor = this.write(room, peer, anchor, buffer, result);
            buffer = '';
            lastFlush = Date.now();
          }
        }
      }
      if (buffer) anchor = this.write(room, peer, anchor, buffer, result);
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') {
        this.revert(room, peer, result);
        throw new HttpError(422, 'Claude declined this request.');
      }
      return result;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      this.revert(room, peer, result);
      if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The AI service is busy right now. Please try again shortly.');
      if (err instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'The AI co-writer is misconfigured (invalid API key).');
      if (err instanceof Anthropic.APIError) throw new HttpError(502, `The AI service returned an error (${err.status ?? 'network'}).`);
      throw err;
    } finally {
      room.setVirtualPeer(site, null);
      this.busy.delete(room.id);
    }
  }

  private write(room: Room, peer: PeerInfo, anchor: Id | null, chunk: string, result: AiResult): Id | null {
    if (!chunk) return anchor;
    const doc = room.doc;
    const pos = anchor ? doc.posAfter(anchor) : 0;
    const ops = doc.insert(Math.max(0, pos), chunk, peer.site);
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
    if (result.deleted.length && result.original) {
      const first = result.deleted[0];
      const at = doc.locate(first)?.pos ?? doc.length;
      room.publish(doc.insert(at, result.original, peer.site), peer);
    }
    result.inserted = [];
  }
}

export const idKeys = (ids: Id[]) => ids.map(keyOf);
