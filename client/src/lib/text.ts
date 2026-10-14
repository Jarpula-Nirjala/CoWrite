import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Doc } from '../../../shared/crdt.ts';

marked.setOptions({ gfm: true, breaks: true });

/** Markdown to sanitised HTML for previews and published pages. */
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
}

export interface Heading {
  level: number;
  text: string;
  pos: number;
}

export function outline(text: string): Heading[] {
  const out: Heading[] = [];
  let pos = 0;
  let inCode = false;
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) inCode = !inCode;
    const m = !inCode && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`]/g, ''), pos });
    pos += line.length + 1;
  }
  return out;
}

// --------------------------------------------------------------- statistics

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export interface TextStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  sentences: number;
  paragraphs: number;
  readingMinutes: number;
  /** Flesch reading ease, 0–100 (higher is easier); null for very short text. */
  readingEase: number | null;
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

export function textStats(text: string): TextStats {
  const plain = text.replace(/[#*_`>~[\]()-]/g, ' ');
  const wordList = plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const words = wordList.length;
  const sentences = Math.max(words ? 1 : 0, (plain.match(/[.!?]+(\s|$)/g) ?? []).length);
  const syl = wordList.reduce((n, w) => n + syllables(w), 0);
  return {
    words,
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
    sentences,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
    readingMinutes: words / 230,
    readingEase: words >= 30 && sentences ? Math.max(0, Math.min(100, 206.835 - 1.015 * (words / sentences) - 84.6 * (syl / words))) : null,
  };
}

export function easeLabel(score: number): string {
  if (score >= 80) return 'Very easy';
  if (score >= 65) return 'Easy';
  if (score >= 50) return 'Fairly difficult';
  if (score >= 30) return 'Difficult';
  return 'Very difficult';
}

// ------------------------------------------------------------------ diffing

export interface TextEdit {
  /** Position in the old text. */
  pos: number;
  del: number;
  ins: string;
}

/**
 * Character-level Myers diff. Turning a target text into minimal edits (not
 * "delete everything, insert everything") keeps characters that did not
 * change, so comments and cursors anchored to them survive a restore.
 */
export function diffText(a: string, b: string, maxD = 4000): TextEdit[] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const A = a.slice(p, a.length - s);
  const B = b.slice(p, b.length - s);
  if (!A.length && !B.length) return [];
  const whole = [{ pos: p, del: A.length, ins: B }];
  if (!A.length || !B.length) return whole;

  const N = A.length;
  const M = B.length;
  const max = Math.min(N + M, maxD);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= N && y >= M) {
        found = d;
        break outer;
      }
    }
  }
  if (found < 0) return whole;

  // Walk back through the trace collecting single-character steps.
  const steps: { type: 'del' | 'ins'; at: number; ch: string }[] = [];
  let x = N;
  let y = M;
  for (let d = found; d > 0; d--) {
    const vv = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1]) ? k + 1 : k - 1;
    const prevX = vv[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
    }
    if (prevK === k + 1) steps.push({ type: 'ins', at: x, ch: B[y - 1] });
    else steps.push({ type: 'del', at: prevX, ch: '' });
    x = prevX;
    y = prevY;
  }
  steps.reverse();

  const edits: TextEdit[] = [];
  for (const st of steps) {
    const last = edits[edits.length - 1];
    if (st.type === 'del') {
      if (last && last.pos + last.del === st.at && !last.ins) last.del++;
      else edits.push({ pos: st.at, del: 1, ins: '' });
    } else if (last && last.pos + last.del === st.at) last.ins += st.ch;
    else edits.push({ pos: st.at, del: 0, ins: st.ch });
  }
  return edits.map((e) => ({ ...e, pos: e.pos + p }));
}

/** Applies edits to a CRDT doc (right to left so earlier positions stay valid). */
export function applyEdits(doc: Doc, edits: TextEdit[]) {
  const ops = [];
  for (const e of [...edits].sort((x, y) => y.pos - x.pos)) {
    ops.push(...doc.delete(e.pos, e.del), ...doc.insert(e.pos, e.ins));
  }
  return ops;
}
