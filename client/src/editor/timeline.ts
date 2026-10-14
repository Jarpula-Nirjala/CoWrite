import { BLOCK, Doc, keyOf, type Id, type Op, type Token } from '../../../shared/crdt.ts';
import type { Author } from '../api.ts';

export type Vector = Record<string, number>;
export interface Checkpoint {
  at: number;
  vector: Vector;
}

// ------------------------------------------------------------------ time

/** The first checkpoint at which `site` had reached `clock`: roughly when that edit happened. */
export function timeOf(checkpoints: Checkpoint[], site: string, clock: number): number | null {
  for (const c of checkpoints) if ((c.vector[site] ?? 0) >= clock) return c.at;
  return null;
}

/** A read-only document showing what changed between two moments, coloured like a diff. */
export function diffDoc(doc: Doc, a: Vector, b: Vector): { doc: Doc; added: number; removed: number } {
  const out = new Doc('diff');
  let added = 0;
  let removed = 0;
  const tokens = doc.compare(a, b).map(({ token, state }) => {
    const attrs = { ...token.attrs };
    if (token.ch !== BLOCK && state === 'added') {
      added++;
      attrs.bg = '#c9f2d2';
    } else if (token.ch !== BLOCK && state === 'removed') {
      removed++;
      attrs.bg = '#fbd5d2';
      attrs.s = true;
      attrs.color = '#9b1c1c';
    }
    return { ch: token.ch, a: attrs };
  });
  out.insertTokens(0, tokens);
  return { doc: out, added, removed };
}

export interface ParaEvent {
  kind: 'typed' | 'deleted' | 'formatted';
  site: string;
  text: string;
  clock: number;
}

/** Everything that ever happened inside the paragraph ending at token index `blockEnd`. */
export function paragraphHistory(doc: Doc, blockStart: number, blockEnd: number): ParaEvent[] {
  const tokens = doc.tokens();
  const first = tokens[blockStart]?.id;
  const last = tokens[blockEnd]?.id;
  if (!first || !last) return [];
  const items = doc.rawItems();
  const i0 = items.findIndex((x) => x.id[0] === first[0] && x.id[1] === first[1]);
  const i1 = items.findIndex((x) => x.id[0] === last[0] && x.id[1] === last[1]);
  if (i0 < 0 || i1 < i0) return [];
  // Include deleted characters just before the first visible one.
  let s = i0;
  while (s > 0 && items[s - 1].del && items[s - 1].ch !== BLOCK) s--;
  const span = items.slice(s, i1 + 1);
  const events: ParaEvent[] = [];
  const push = (kind: ParaEvent['kind'], site: string, clock: number, ch: string) => {
    const prev = events[events.length - 1];
    if (prev && prev.kind === kind && prev.site === site && clock - prev.clock <= 3 && clock >= prev.clock) {
      prev.text += ch;
      prev.clock = clock;
    } else events.push({ kind, site, text: ch, clock });
  };
  for (const it of [...span].sort((x, y) => x.id[1] - y.id[1])) push('typed', it.id[0], it.id[1], it.ch === BLOCK ? '' : it.ch === '￼' ? '▣' : it.ch);
  for (const it of span.filter((x) => x.del).sort((x, y) => x.del![1] - y.del![1])) push('deleted', it.del![0], it.del![1], it.ch === BLOCK ? '' : it.ch);
  const fmt = new Map<string, number>();
  for (const it of span) for (const f of it.formats) fmt.set(`${f[0]}|${f[1]}`, f[1]);
  for (const k of fmt.keys()) {
    const [site, clock] = k.split('|');
    push('formatted', site, Number(clock), '');
  }
  return events.filter((e) => e.text.trim() || e.kind === 'formatted').sort((x, y) => y.clock - x.clock);
}

/**
 * Conflict heatmap: how much each paragraph was edited by different people at
 * nearly the same time (Lamport clocks within a small window).
 */
export function heatmap(doc: Doc): { from: number; to: number; score: number; sites: number }[] {
  const items = doc.rawItems();
  const out: { from: number; to: number; score: number; sites: number }[] = [];
  let pos = 0;
  let start = 0;
  let edits: [string, number][] = [];
  for (const it of items) {
    edits.push([it.id[0], it.id[1]]);
    if (it.del) edits.push([it.del[0], it.del[1]]);
    for (const f of it.formats) edits.push([f[0], f[1]]);
    if (it.del) continue;
    pos++;
    if (it.ch !== BLOCK) continue;
    const bySite = new Map<string, number[]>();
    for (const [site, clock] of edits) bySite.set(site, [...(bySite.get(site) ?? []), clock]);
    let score = 0;
    const sites = [...bySite.keys()];
    for (let i = 0; i < sites.length; i++)
      for (let j = i + 1; j < sites.length; j++) {
        const a = bySite.get(sites[i])!;
        const b = new Set(bySite.get(sites[j])!.map((c) => Math.floor(c / 25)));
        score += a.filter((c) => b.has(Math.floor(c / 25))).length;
      }
    if (sites.length > 1 && score > 0) out.push({ from: start, to: pos, score, sites: sites.length });
    start = pos;
    edits = [];
  }
  return out;
}

/** Ops that undo everything `sites` did after `since` (their typing removed, their deletions restored). */
export function revertOps(doc: Doc, sites: string[], since: Vector): { ops: Op[]; removed: number; restored: number } {
  const ops: Op[] = [];
  let removed = 0;
  let restored = 0;
  const toRestore: { id: Id; ch: string; attrs: Token['attrs'] }[] = [];
  for (const site of sites) {
    const e = doc.editsBy(site, since);
    removed += e.inserted.length;
    ops.push(...doc.deleteIds(e.inserted));
    // Only bring back text that existed at that moment.
    toRestore.push(...e.deleted.filter((t) => (since[t.id[0]] ?? 0) >= t.id[1]));
  }
  // Restore deleted characters where they used to be, last first so positions hold.
  const located = toRestore
    .map((t) => ({ ...t, at: doc.locate(t.id) }))
    .filter((t) => t.at)
    .sort((x, y) => y.at!.pos - x.at!.pos || doc.indexOf(y.id) - doc.indexOf(x.id));
  const runs: { pos: number; tokens: { ch: string; a: Token['attrs'] }[] }[] = [];
  for (const t of located) {
    const run = runs[runs.length - 1];
    if (run && run.pos === t.at!.pos) run.tokens.unshift({ ch: t.ch, a: t.attrs });
    else runs.push({ pos: t.at!.pos, tokens: [{ ch: t.ch, a: t.attrs }] });
  }
  for (const r of runs) {
    ops.push(...doc.insertTokens(Math.min(r.pos, doc.length), r.tokens));
    restored += r.tokens.length;
  }
  return { ops, removed, restored };
}

export const nameOf = (authors: Author[], site: string) => authors.find((a) => a.site === site)?.name ?? (site === 'server' ? 'Server' : 'Someone');
export const colorOf = (authors: Author[], site: string) => authors.find((a) => a.site === site)?.color ?? '#9aa0a6';
export const blockKey = (id: Id) => keyOf(id);

/** Records a replay of the document's history as a WebM video. */
export async function recordReplay(
  history: Op[],
  title: string,
  colors: Map<string, string>,
  opts: { seconds: number; onProgress(p: number): void; onlySite?: string | null },
): Promise<Blob> {
  const W = 1280;
  const H = 720;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const stream = c.captureStream(30);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob>((resolve) => (rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))));
  const doc = new Doc('video');
  const frames = Math.max(30, Math.round(opts.seconds * 30));
  const per = Math.max(1, Math.ceil(history.length / frames));
  rec.start(500);

  const draw = (step: number) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1f3a68';
    g.fillRect(0, 0, W, 64);
    g.fillStyle = '#ffffff';
    g.font = "bold 26px 'Times New Roman', serif";
    g.fillText(title.slice(0, 70), 32, 42);
    g.font = "16px 'Times New Roman', serif";
    const label = `CoWrite replay · ${Math.min(step, history.length).toLocaleString()} / ${history.length.toLocaleString()} edits`;
    g.fillText(label, W - 32 - g.measureText(label).width, 40);
    // Lay the text out line by line, each character in its author's colour.
    let x = 48;
    let y = 110;
    const lh = 30;
    for (const t of doc.tokens()) {
      if (y > H - 40) break;
      const heading = t.attrs.block === 'h';
      if (t.ch === BLOCK) {
        x = 48;
        y += heading ? lh * 1.4 : lh;
        continue;
      }
      const size = 22;
      g.font = `${t.attrs.b ? 'bold ' : ''}${t.attrs.i ? 'italic ' : ''}${size}px 'Times New Roman', serif`;
      const ch = t.ch === '￼' ? '▣' : t.ch;
      const w = g.measureText(ch).width;
      if (x + w > W - 48) {
        x = 48;
        y += lh;
      }
      const site = t.id[0];
      g.fillStyle = opts.onlySite && site !== opts.onlySite ? '#c4c7cc' : (colors.get(site) ?? '#111418');
      g.fillText(ch, x, y);
      x += w;
    }
  };

  for (let f = 0, at = 0; at < history.length; f++) {
    const next = Math.min(history.length, at + per);
    doc.apply(history.slice(at, next));
    at = next;
    draw(at);
    opts.onProgress(at / history.length);
    await new Promise((r) => setTimeout(r, 1000 / 30));
  }
  // Hold the final frame for two seconds.
  for (let i = 0; i < 60; i++) {
    draw(history.length);
    await new Promise((r) => setTimeout(r, 1000 / 30));
  }
  rec.stop();
  return done;
}
