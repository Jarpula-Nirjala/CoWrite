import type { Token } from '../../../shared/crdt.ts';
import { blocksOf } from '../../../shared/rich.ts';

export interface Card {
  key: string;
  q: string;
  a: string;
  source: 'notes' | 'ai';
}

export interface Review {
  card: string;
  ease: number;
  interval: number;
  reps: number;
  due: number;
}

/** Short stable id for a card (from its question). */
export function cardKey(q: string): string {
  let h = 5381;
  for (const ch of q.trim().toLowerCase()) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

const DEF = /^(.{2,80}?)\s*(?::|—|–|\s-\s|=)\s+(.{2,400})$/;

/**
 * Flashcards found in ordinary notes, no AI needed:
 * "Term: definition" lines, two-column tables, and short headings followed by a paragraph.
 */
export function cardsFromNotes(tokens: Token[]): Card[] {
  const out: Card[] = [];
  const seen = new Set<string>();
  const add = (q: string, a: string) => {
    q = q.replace(/\*\*/g, '').trim();
    a = a.trim();
    if (q.length < 2 || a.length < 2 || q.length > 160) return;
    const key = cardKey(q);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, q, a, source: 'notes' });
  };
  const blocks = blocksOf(tokens);
  blocks.forEach((b, i) => {
    if (b.type === 'atom') {
      if (b.kind === 'table') {
        const rows = (b.attrs.rows as string[][] | undefined) ?? [];
        for (const row of rows.slice(b.attrs.header ? 1 : 0)) if (row.length >= 2 && row[0] && row[1]) add(row[0], row.slice(1).filter(Boolean).join(' · '));
      }
      return;
    }
    const text = b.text.trim();
    if (b.kind === 'h') {
      const next = blocks[i + 1];
      if (Number(b.attrs.level ?? 1) >= 2 && next?.type === 'text' && next.kind === 'p' && next.text.trim().length > 20 && text.length < 80) {
        add(text.endsWith('?') ? text : `What about “${text}”?`, next.text.trim().slice(0, 300));
      }
      return;
    }
    if (b.kind === 'code') return;
    const m = DEF.exec(text);
    if (m && !/^https?$/i.test(m[1])) add(m[1], m[2]);
  });
  return out;
}

/** SM-2 style scheduling. Grades: 0 again, 1 hard, 2 good, 3 easy. */
export function schedule(prev: Review | undefined, card: string, grade: 0 | 1 | 2 | 3, now = Date.now()): Review {
  let ease = prev?.ease ?? 2.5;
  let interval = prev?.interval ?? 0;
  let reps = prev?.reps ?? 0;
  if (grade === 0) {
    reps = 0;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
    return { card, ease, interval, reps, due: now + 10 * 60_000 };
  }
  if (grade === 1) {
    interval = Math.max(1, interval * 1.2);
    ease = Math.max(1.3, ease - 0.15);
  } else if (reps === 0) interval = grade === 3 ? 4 : 1;
  else if (reps === 1) interval = grade === 3 ? 6 : 3;
  else interval = interval * ease * (grade === 3 ? 1.3 : 1);
  if (grade === 3) ease = Math.min(3, ease + 0.15);
  reps++;
  return { card, ease, interval: Math.round(interval * 10) / 10, reps, due: now + interval * 86_400_000 };
}

/** A multiple-choice quiz: each card's answer among three others. */
export function makeQuiz(cards: Card[], n = 10): { q: string; options: string[]; correct: number }[] {
  const pool = [...cards].sort(() => Math.random() - 0.5).slice(0, n);
  return pool.map((c) => {
    const wrong = cards
      .filter((x) => x.key !== c.key && x.a !== c.a)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map((x) => x.a);
    const options = [...wrong, c.a].sort(() => Math.random() - 0.5);
    return { q: c.q, options, correct: options.indexOf(c.a) };
  });
}
