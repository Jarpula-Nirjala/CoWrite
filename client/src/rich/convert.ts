import { Fragment, Mark, type Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { BLOCK, EMBED, sameValue, type Attrs, type Doc, type Id, type Op, type Token } from '../../../shared/crdt.ts';
import { MARKS } from '../../../shared/rich.ts';
import { diffText } from '../lib/text.ts';
import { PARA_DEFAULTS, VALUE_MARKS, schema } from './schema.ts';

/** A token produced from the editor document, with its editor position. */
export interface FlatToken {
  ch: string;
  a: Attrs;
  key: string;
  /** Editor position of the character (or of the paragraph end / the atom). */
  pm: number;
}

/** Stable string for an attribute object (sorted keys). */
export function attrsKey(a: Attrs): string {
  const keys = Object.keys(a).sort();
  if (!keys.length) return '';
  return JSON.stringify(keys.map((k) => [k, a[k]]));
}

// ------------------------------------------------------------ marks/attrs

function marksToAttrs(marks: readonly Mark[]): Attrs {
  const a: Attrs = {};
  for (const m of marks) {
    const valueAttr = VALUE_MARKS[m.type.name];
    a[m.type.name] = valueAttr ? m.attrs[valueAttr] : true;
  }
  return a;
}

const markCache = new Map<string, Mark[]>();
function attrsToMarks(a: Attrs): Mark[] {
  const key = attrsKey(a);
  const hit = markCache.get(key);
  if (hit) return hit;
  const marks: Mark[] = [];
  for (const name of MARKS) {
    const v = a[name];
    if (v === undefined || v === null || v === false) continue;
    const type = schema.marks[name];
    if (!type) continue;
    const valueAttr = VALUE_MARKS[name];
    marks.push(valueAttr ? type.create({ [valueAttr]: v }) : type.create());
  }
  const sorted = [...Mark.setFrom(marks)];
  if (markCache.size > 2000) markCache.clear();
  markCache.set(key, sorted);
  return sorted;
}

/** Block attributes as stored on the "\n" character (defaults omitted). */
export function paraToAttrs(attrs: Record<string, unknown>): Attrs {
  const a: Attrs = {};
  for (const [k, def] of Object.entries(PARA_DEFAULTS)) {
    const v = attrs[k];
    if (v === undefined || sameValue(v, def)) continue;
    a[k] = v;
  }
  return a;
}

function attrsToPara(a: Attrs): Record<string, unknown> {
  const out: Record<string, unknown> = { ...PARA_DEFAULTS };
  for (const k of Object.keys(PARA_DEFAULTS)) if (a[k] !== undefined && a[k] !== null) out[k] = a[k];
  return out;
}

const isDefaultPara = (attrs: Record<string, unknown>) => Object.keys(paraToAttrs(attrs)).length === 0;

// ---------------------------------------------------------- CRDT -> editor

/**
 * The canonical editor document for a token list. It always ends with a
 * plain paragraph that has no terminator yet: the text after the last
 * terminator, or an empty line to type into.
 */
export function tokensToDoc(tokens: Token[]): PMNode {
  const blocks: PMNode[] = [];
  let inline: PMNode[] = [];
  let run = '';
  let runKey = '';
  let runAttrs: Attrs = {};
  const flushRun = () => {
    if (run) inline.push(schema.text(run, attrsToMarks(runAttrs)));
    run = '';
  };
  const endPara = (a: Attrs) => {
    flushRun();
    blocks.push(schema.nodes.para.create(attrsToPara(a), inline));
    inline = [];
  };
  for (const t of tokens) {
    if (t.ch === BLOCK) {
      endPara(t.attrs);
    } else if (t.ch === EMBED && t.attrs.atom) {
      if (run || inline.length) endPara({});
      const { atom, ...data } = t.attrs;
      blocks.push(schema.nodes.atom.create({ kind: atom, data }));
    } else if (t.ch === EMBED) {
      flushRun();
      const { inline: kind, ...rest } = t.attrs;
      const data: Attrs = {};
      for (const [k, v] of Object.entries(rest)) if (!(MARKS as readonly string[]).includes(k)) data[k] = v;
      inline.push(schema.nodes.chip.create({ kind: kind ?? 'mention', data }, null, attrsToMarks(t.attrs)));
    } else {
      const marksOnly: Attrs = {};
      for (const m of MARKS) if (t.attrs[m] !== undefined) marksOnly[m] = t.attrs[m];
      const k = attrsKey(marksOnly);
      if (k !== runKey) {
        flushRun();
        runKey = k;
        runAttrs = marksOnly;
      }
      run += t.ch;
    }
  }
  endPara({});
  return schema.nodes.doc.create(null, blocks);
}

// ---------------------------------------------------------- editor -> CRDT

const flatCache = new WeakMap<PMNode, FlatToken[]>();

/** The token list an editor document stands for, with editor positions. */
export function flatten(doc: PMNode): FlatToken[] {
  const hit = flatCache.get(doc);
  if (hit) return hit;
  const out: FlatToken[] = [];
  const count = doc.childCount;
  let pos = 0;
  doc.forEach((block, _offset, index) => {
    if (block.type.name === 'atom') {
      const a: Attrs = { atom: block.attrs.kind, ...(block.attrs.data as Attrs) };
      out.push({ ch: EMBED, a, key: attrsKey(a), pm: pos });
    } else {
      const start = pos + 1;
      block.forEach((child, off) => {
        if (child.isText) {
          const a = marksToAttrs(child.marks);
          const key = attrsKey(a);
          const text = child.text!;
          for (let i = 0; i < text.length; i++) out.push({ ch: text[i], a, key, pm: start + off + i });
        } else {
          const a: Attrs = { ...marksToAttrs(child.marks), inline: child.attrs.kind, ...(child.attrs.data as Attrs) };
          out.push({ ch: EMBED, a, key: attrsKey(a), pm: start + off });
        }
      });
      // A plain final paragraph has no terminator; styled ones need it for their attributes.
      const isLast = index === count - 1;
      if (!(isLast && isDefaultPara(block.attrs))) {
        const a = paraToAttrs(block.attrs);
        out.push({ ch: BLOCK, a, key: attrsKey(a), pm: start + block.content.size });
      }
    }
    pos += block.nodeSize;
  });
  flatCache.set(doc, out);
  return out;
}

// ------------------------------------------------------------ local diff

export interface LocalChange {
  ops: Op[];
  /** For undo: what the change removed and which attributes it overwrote. */
  removed: { ids: Id[]; tokens: { ch: string; a?: Attrs }[] }[];
  formats: { id: Id; attr: string; prev: unknown; next: unknown }[];
}

/** Cached CRDT tokens with attribute keys, rebuilt when the CRDT changes. */
export class TokenView {
  private doc: Doc;
  private cached: (Token & { key: string })[] | null = null;
  constructor(doc: Doc) {
    this.doc = doc;
  }
  invalidate() {
    this.cached = null;
  }
  get tokens(): (Token & { key: string })[] {
    if (!this.cached) this.cached = this.doc.tokens().map((t) => ({ ...t, key: attrsKey(t.attrs) }));
    return this.cached;
  }
}

/**
 * Turns the difference between the CRDT's tokens and the editor's tokens into
 * operations: inserts and deletes for changed characters (via a Myers diff on
 * the characters), and per-attribute format ops for characters that only
 * changed style. Unchanged characters keep their ids, so cursors, comments
 * and suggestions anchored to them stay put.
 */
export function diffTokens(
  doc: Doc,
  old: (Token & { key: string })[],
  next: FlatToken[],
  /** Suggestion mode: which of the removed characters really get deleted (the rest are only marked). */
  filterDelete?: (ids: Id[]) => Id[],
): LocalChange & { marked: Id[] } {
  let p = 0;
  while (p < old.length && p < next.length && old[p].ch === next[p].ch && old[p].key === next[p].key) p++;
  let s = 0;
  while (s < old.length - p && s < next.length - p && old[old.length - 1 - s].ch === next[next.length - 1 - s].ch && old[old.length - 1 - s].key === next[next.length - 1 - s].key) s++;
  const oldMid = old.slice(p, old.length - s);
  const newMid = next.slice(p, next.length - s);
  const change: LocalChange & { marked: Id[] } = { ops: [], removed: [], formats: [], marked: [] };
  if (!oldMid.length && !newMid.length) return change;

  const edits = diffText(oldMid.map((t) => t.ch).join(''), newMid.map((t) => t.ch).join(''), 3000);

  // Walk aligned (equal-character) stretches to find style-only changes.
  const restyle = (o: Token & { key: string }, n: FlatToken) => {
    if (o.key === n.key) return;
    for (const attr of new Set([...Object.keys(o.attrs), ...Object.keys(n.a)])) {
      const prev = o.attrs[attr] ?? null;
      const value = n.a[attr] ?? null;
      if (sameValue(prev, value)) continue;
      change.ops.push(...doc.format([o.id], attr, value));
      change.formats.push({ id: o.id, attr, prev, next: value });
    }
  };
  let oi = 0;
  let ni = 0;
  const inserts: { at: number; tokens: FlatToken[] }[] = [];
  const deletes: { at: number; len: number }[] = [];
  for (const e of edits) {
    const eq = e.pos - oi;
    for (let k = 0; k < eq; k++) restyle(oldMid[oi + k], newMid[ni + k]);
    oi += eq;
    ni += eq;
    if (e.del) deletes.push({ at: p + oi, len: e.del });
    if (e.ins.length) inserts.push({ at: p + oi, tokens: newMid.slice(ni, ni + e.ins.length) });
    oi += e.del;
    ni += e.ins.length;
  }
  for (let k = 0; oi + k < oldMid.length; k++) restyle(oldMid[oi + k], newMid[ni + k]);

  // Apply right to left so earlier positions stay valid.
  const all = [...deletes.map((d) => ({ ...d, kind: 'del' as const })), ...inserts.map((i) => ({ ...i, kind: 'ins' as const }))].sort(
    // Same position: remove the old characters before inserting the new ones.
    (a, b) => b.at - a.at || (a.kind === 'del' ? -1 : 1),
  );
  for (const e of all) {
    if (e.kind === 'del') {
      const ids = doc.idsInRange(e.at, e.at + e.len);
      const slice = old.slice(e.at, e.at + e.len);
      const keep = filterDelete ? new Set(filterDelete(ids).map((id) => `${id[0]}:${id[1]}`)) : null;
      const del = keep ? ids.filter((id) => keep.has(`${id[0]}:${id[1]}`)) : ids;
      if (keep) change.marked.push(...ids.filter((id) => !keep.has(`${id[0]}:${id[1]}`)));
      const removed = slice.filter((t) => !keep || keep.has(`${t.id[0]}:${t.id[1]}`)).map((t) => ({ ch: t.ch, a: Object.keys(t.attrs).length ? t.attrs : undefined }));
      change.removed.push({ ids: del, tokens: removed });
      change.ops.push(...(keep ? doc.deleteIds(del) : doc.delete(e.at, e.len)));
    } else {
      change.ops.push(...doc.insertTokens(e.at, e.tokens.map((t) => ({ ch: t.ch, a: Object.keys(t.a).length ? t.a : undefined }))));
    }
  }
  return change;
}

// --------------------------------------------------------- remote changes

/**
 * Brings the editor in line with the CRDT. Changed blocks are patched in
 * place where possible (style-only changes just update attributes; text
 * changes replace only the differing characters), so everyone's caret stays
 * where it was; structural changes replace the smallest differing range.
 */
export function reconcile(view: EditorView, tokens: Token[]): boolean {
  const next = tokensToDoc(tokens);
  const tr = buildReconcile(view.state.doc, next, view.state.tr);
  if (!tr) return false;
  tr.setMeta('remote', true).setMeta('addToHistory', false);
  view.dispatch(tr);
  return true;
}

/** The transaction turning `cur` into `next` (null when equal). Exported for tests. */
export function buildReconcile(cur: PMNode, next: PMNode, t: Transaction): Transaction | null {
  if (next.eq(cur)) return null;
  const nc = next.childCount;
  const cc = cur.childCount;
  let i = 0;
  while (i < nc && i < cc && next.child(i).eq(cur.child(i))) i++;
  let j = 0;
  while (j < nc - i && j < cc - i && next.child(nc - 1 - j).eq(cur.child(cc - 1 - j))) j++;

  if (nc === cc) {
    // Same number of changed blocks: patch each in place.
    let pos = 0;
    for (let k = 0; k < i; k++) pos += cur.child(k).nodeSize;
    for (let k = i; k < nc - j; k++) {
      const a = next.child(k);
      const b = cur.child(k);
      const at = t.mapping.map(pos);
      if (a.type === b.type && a.content.eq(b.content)) {
        t.setNodeMarkup(at, undefined, a.attrs);
      } else if (a.type === b.type && a.type.name === 'para') {
        if (!a.sameMarkup(b)) t.setNodeMarkup(at, undefined, a.attrs);
        const s0 = a.content.findDiffStart(b.content);
        if (s0 !== null && s0 !== undefined) {
          const e0 = a.content.findDiffEnd(b.content)!;
          let ea = e0.a;
          let eb = e0.b;
          const ov = s0 - Math.min(ea, eb);
          if (ov > 0) {
            ea += ov;
            eb += ov;
          }
          t.replace(at + 1 + s0, at + 1 + eb, a.slice(s0, ea));
        }
      } else {
        t.replaceWith(at, at + b.nodeSize, a);
      }
      pos += b.nodeSize;
    }
  } else {
    const start = next.content.findDiffStart(cur.content)!;
    const end = next.content.findDiffEnd(cur.content);
    let endNext = end ? end.a : next.content.size;
    let endCur = end ? end.b : cur.content.size;
    const overlap = start - Math.min(endNext, endCur);
    if (overlap > 0) {
      endNext += overlap;
      endCur += overlap;
    }
    t.replace(start, endCur, next.slice(start, endNext));
  }
  return t;
}

/** Editor position of the caret placed just before token `i` (or the end). */
export function tokenToPos(flat: FlatToken[], i: number, doc: PMNode): number {
  if (i < flat.length) return flat[i].pm;
  // After the last token: inside the final (open) paragraph if any.
  const last = doc.lastChild;
  return last && last.type.name === 'para' ? doc.content.size - 1 : doc.content.size;
}

/** Number of tokens before editor position `pos`. */
export function posToToken(flat: FlatToken[], pos: number): number {
  let lo = 0;
  let hi = flat.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (flat[mid].pm < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const emptyFragment = Fragment.empty;
