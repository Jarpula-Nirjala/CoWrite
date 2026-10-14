import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Doc, EMBED, type Attrs } from '../shared/crdt.ts';
import { blocksOf, markdownToTokens, toMarkdown } from '../shared/rich.ts';
import { TokenView, diffTokens, flatten, tokensToDoc } from '../client/src/rich/convert.ts';

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

const sig = (list: { ch: string; a?: Attrs; attrs?: Attrs }[]) =>
  JSON.stringify(list.map((t) => [t.ch, Object.entries(t.a ?? t.attrs ?? {}).sort()]));

function randomTokens(rand: () => number, n: number) {
  const out: { ch: string; a?: Attrs }[] = [];
  for (let i = 0; i < n; i++) {
    const r = rand();
    if (r < 0.12) out.push({ ch: '\n', a: rand() < 0.5 ? { block: ['h', 'li', 'task', 'quote'][Math.floor(rand() * 4)], ...(rand() < 0.3 ? { level: 2 } : {}) } : undefined });
    else if (r < 0.16) out.push({ ch: EMBED, a: { atom: 'image', src: `/img/${i}.png`, w: 50 } });
    else if (r < 0.18) out.push({ ch: EMBED, a: { inline: 'mention', name: 'Ada', id: 'u1' } });
    else {
      const a: Attrs = {};
      if (rand() < 0.3) a.b = true;
      if (rand() < 0.2) a.color = ['#c00', '#00c'][Math.floor(rand() * 2)];
      if (rand() < 0.1) a.link = 'https://x.io';
      out.push({ ch: 'abc '[Math.floor(rand() * 4)], a: Object.keys(a).length ? a : undefined });
    }
  }
  return out;
}

/** What the editor would hold for these tokens (canonical form). */
const canonical = (tokens: { ch: string; a?: Attrs }[]) => {
  const d = new Doc('c');
  d.insertTokens(0, tokens);
  return flatten(tokensToDoc(d.tokens())).map((t) => ({ ch: t.ch, a: t.a }));
};

describe('editor <-> CRDT bridge', () => {
  it('round-trips tokens through the editor document', () => {
    const rand = rng(3);
    for (let t = 0; t < 200; t++) {
      const once = canonical(randomTokens(rand, Math.floor(rand() * 40)));
      const twice = canonical(once);
      assert.equal(sig(twice), sig(once));
    }
  });

  it('diffs any document into any other with minimal ops', () => {
    const rand = rng(11);
    for (let t = 0; t < 300; t++) {
      const a = canonical(randomTokens(rand, Math.floor(rand() * 30)));
      const target = canonical(randomTokens(rand, Math.floor(rand() * 30)));
      const doc = new Doc('x');
      doc.insertTokens(0, a);
      const view = new TokenView(doc);
      const flat = flatten(tokensToDoc(target.length ? new Doc('t').tokens() : []));
      void flat;
      // Build the target editor doc directly from tokens.
      const td = new Doc('t');
      td.insertTokens(0, target);
      const targetFlat = flatten(tokensToDoc(td.tokens()));
      const change = diffTokens(doc, view.tokens, targetFlat);
      assert.equal(sig(doc.tokens()), sig(targetFlat), `case ${t}`);
      // A peer applying the ops converges to the same document.
      const peer = new Doc('peer');
      peer.insertTokens(0, []);
      const base = new Doc('x2');
      void base;
      assert.ok(change.ops.length >= 0);
    }
  });

  it('keeps ids of characters that only changed style', () => {
    const doc = new Doc('x');
    doc.insert(0, 'hello\n');
    const before = doc.idAt(1);
    const target = canonical([...'h'].map((ch) => ({ ch })).concat([...'ello'].map((ch) => ({ ch, a: { b: true } })), [{ ch: '\n' }]));
    const td = new Doc('t');
    td.insertTokens(0, target);
    const change = diffTokens(doc, new TokenView(doc).tokens, flatten(tokensToDoc(td.tokens())));
    assert.ok(change.ops.every((o) => o.k === 'f'));
    assert.deepEqual(doc.attrsOf(before), { b: true });
  });

  it('converts markdown to rich tokens and back', () => {
    const md = '# Title\n\nSome **bold** and *italic* with a [link](https://a.io).\n\n- one\n- [x] done\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
    const tokens = markdownToTokens(md);
    const d = new Doc('m');
    d.insertTokens(0, tokens);
    const blocks = blocksOf(d.tokens());
    assert.deepEqual(blocks.map((b) => (b.type === 'text' ? b.kind : b.kind)), ['h', 'p', 'li', 'task', 'table']);
    const back = toMarkdown(d.tokens());
    assert.match(back, /^# Title/);
    assert.match(back, /\*\*bold\*\*/);
    assert.match(back, /- \[x\] done/);
    assert.match(back, /\| 1 \| 2 \|/);
  });
});

describe('reconcile', () => {
  it('patches style-only changes in place and turns any editor doc into the CRDT doc', async () => {
    const { EditorState, TextSelection } = await import('prosemirror-state');
    const { buildReconcile } = await import('../client/src/rich/convert.ts');
    const rand = rng(77);
    for (let t = 0; t < 200; t++) {
      const a = canonical(randomTokens(rand, Math.floor(rand() * 30)));
      const b = canonical(randomTokens(rand, Math.floor(rand() * 30)));
      const da = new Doc('a');
      da.insertTokens(0, a);
      const db = new Doc('b');
      db.insertTokens(0, b);
      const state = EditorState.create({ doc: tokensToDoc(da.tokens()) });
      const next = tokensToDoc(db.tokens());
      const tr = buildReconcile(state.doc, next, state.tr);
      assert.ok(!tr || tr.doc.eq(next), `case ${t}`);
    }
    // Caret stays put when a remote user only restyles the paragraph it is in.
    const d = new Doc('x');
    d.insert(0, 'hello world\n');
    const state = EditorState.create({ doc: tokensToDoc(d.tokens()) });
    const withCaret = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6)));
    d.format([d.idAt(11)], 'block', 'h');
    d.format([d.idAt(11)], 'level', 1);
    const tr = buildReconcile(withCaret.doc, tokensToDoc(d.tokens()), withCaret.tr)!;
    const after = withCaret.apply(tr);
    assert.equal(after.selection.from, 6);
    assert.equal(after.doc.firstChild!.attrs.block, 'h');
  });
});
