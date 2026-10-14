import { BLOCK, EMBED, type Id, type Token } from '../shared/crdt.ts';
import type { PeerInfo, Selection } from '../shared/protocol.ts';
import { inlineTokens, markdownToTokens, type NewToken } from '../shared/rich.ts';
import { randomSite } from '../shared/sync-client.ts';
import type { Db } from './db.ts';
import { HttpError } from './http.ts';
import { ClaudeLlm, GeminiLlm, llmForKey, type Llm } from './llm.ts';
import type { Room } from './rooms.ts';
import type { Vault } from './secrets.ts';

export type AiAction = 'continue' | 'summarize' | 'rewrite' | 'grammar' | 'shorten' | 'expand' | 'custom' | 'tone';
export const AI_ACTIONS: AiAction[] = ['continue', 'summarize', 'rewrite', 'grammar', 'shorten', 'expand', 'custom', 'tone'];
const NEEDS_SELECTION = new Set<AiAction>(['rewrite', 'grammar', 'shorten', 'expand', 'tone']);
export const TONES = ['formal', 'casual', 'persuasive', 'simple', 'friendly', 'confident', 'academic'] as const;


export interface AiResult {
  /** Characters the AI inserted (the client can undo them). */
  inserted: Id[];
  /** Characters the AI replaced, with their original content for undo. */
  deleted: Id[];
  original: Token[];
  site: string;
}

const SYSTEM = `You are a writing assistant working inside CoWrite, a collaborative rich-text editor.
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

/**
 * Picks the model for each request: the person's own Gemini key first (their
 * own free quota), then the site's Gemini key, then the site's Claude key.
 */
export class AiHub {
  private readonly db: Db;
  private readonly vault: Vault;
  private readonly server: Llm | null;

  constructor(db: Db, vault: Vault) {
    this.db = db;
    this.vault = vault;
    this.server = process.env.GEMINI_API_KEY ? new GeminiLlm(process.env.GEMINI_API_KEY, 'server') : process.env.ANTHROPIC_API_KEY ? new ClaudeLlm() : null;
  }

  /** Whether the site itself has an AI key (people can still bring their own). */
  get enabled(): boolean {
    return this.server !== null;
  }

  get serverName(): string | null {
    return this.server?.name ?? null;
  }

  /** The writer for a user (their own key if they connected one). */
  async for(userId: string | null | undefined): Promise<AiWriter> {
    if (userId) {
      const [row] = await this.db.query<{ ai_key: string | null }>('select ai_key from users where id = $1', [userId]);
      const key = row?.ai_key ? await this.vault.open(row.ai_key) : null;
      if (key) return new AiWriter(llmForKey(key, 'user'));
    }
    if (!this.server) throw new HttpError(503, 'AI is not set up yet. Connect your free Gemini key in Account settings → AI assistant.');
    return new AiWriter(this.server);
  }

  /** Like `for`, but null instead of an error when no AI is available. */
  async maybeFor(userId: string | null | undefined): Promise<AiWriter | null> {
    try {
      return await this.for(userId);
    } catch {
      return null;
    }
  }
}

/** Rooms where an AI is typing right now (one at a time per document). */
const busy = new Set<string>();

/** The AI co-writer: the model joins the room as a peer and types its answer in live. */
export class AiWriter {
  readonly llm: Llm;

  constructor(llm: Llm) {
    this.llm = llm;
  }

  get name(): string {
    return this.llm.name;
  }

  get color(): string {
    return this.llm.color;
  }

  text(system: string, prompt: string, maxTokens = 8000): Promise<string> {
    return this.llm.text(system, prompt, maxTokens);
  }

  json<T>(system: string, prompt: string, schema: Record<string, unknown> & { type: 'object' }, maxTokens = 12000): Promise<T> {
    return this.llm.json<T>(system, prompt, schema, maxTokens);
  }

  describeImage(data: Buffer, mime: string, ask: string): Promise<string> {
    return this.llm.image(data, mime, ask);
  }

  // ------------------------------------------------------- live co-writer

  async run(room: Room, action: AiAction, sel: Selection, custom: string, onSite: (site: string) => void): Promise<AiResult> {
    if (room.encrypted) throw new HttpError(400, 'The AI co-writer is unavailable in end-to-end encrypted documents, because the server cannot read them.');
    if (busy.has(room.id)) throw new HttpError(409, 'The AI is already writing in this document. Please wait for it to finish.');

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

    busy.add(room.id);
    const site = `ai-${randomSite()}`;
    onSite(site);
    const peer: PeerInfo = { site, name: this.name, color: this.color, sel: null, userId: null, state: 'active', typing: true };
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
      for await (const fragment of this.llm.stream(SYSTEM, prompt, 16000)) {
        pending += fragment;
        let nl = pending.indexOf('\n');
        while (nl >= 0) {
          emitLine(pending.slice(0, nl), false);
          pending = pending.slice(nl + 1);
          nl = pending.indexOf('\n');
        }
      }
      if (pending) emitLine(pending, true);
      return result;
    } catch (err) {
      this.revert(room, peer, result);
      throw err instanceof HttpError ? err : new HttpError(500, 'The AI request failed.');
    } finally {
      room.setVirtualPeer(site, null);
      busy.delete(room.id);
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
