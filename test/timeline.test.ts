import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Doc } from '../shared/crdt.ts';
import { diffDoc, heatmap, paragraphHistory, revertOps } from '../client/src/editor/timeline.ts';

test('revertOps undoes one person’s edits since a moment and keeps others’', () => {
  const a = new Doc('alice');
  a.insert(0, 'The cat sat.\n');
  const since = { ...a.vector };
  const b = new Doc('bob');
  b.apply(a.missingFor({}));
  // Bob deletes "cat" and types "dog"; Alice adds an ending.
  b.delete(4, 3, 'bob');
  b.insert(4, 'dog', 'bob');
  b.insert(b.text().indexOf('.'), ' down', 'alice');
  assert.equal(b.text(), 'The dog sat down.\n');
  const r = revertOps(b, ['bob'], since);
  assert.equal(b.text(), 'The cat sat down.\n');
  assert.equal(r.removed, 3);
  assert.equal(r.restored, 3);
  // The ops replay on another replica to the same result.
  const c = new Doc('carol');
  c.apply(b.missingFor({}));
  assert.equal(c.text(), b.text());
});

test('revertOps does not resurrect text typed and deleted after the moment', () => {
  const d = new Doc('x');
  d.insert(0, 'abc');
  const since = { ...d.vector };
  d.insert(3, 'XYZ');
  d.delete(3, 3);
  revertOps(d, ['x'], since);
  assert.equal(d.text(), 'abc');
});

test('diffDoc marks additions and removals', () => {
  const d = new Doc('a');
  d.insert(0, 'old text');
  const v1 = { ...d.vector };
  d.delete(0, 3);
  d.insert(0, 'new');
  const r = diffDoc(d, v1, d.vector);
  assert.equal(r.added, 3);
  assert.equal(r.removed, 3);
  assert.ok(r.doc.tokens().some((t) => t.attrs.s && t.ch === 'o'));
});

test('paragraphHistory lists typing and deletions by author', () => {
  const d = new Doc('a');
  d.insert(0, 'Hello world\nSecond\n');
  d.delete(5, 6, 'b');
  const end = d.text().indexOf('\n');
  const ev = paragraphHistory(d, 0, end);
  assert.ok(ev.some((e) => e.kind === 'typed' && e.site === 'a' && e.text.includes('Hello')));
  assert.ok(ev.some((e) => e.kind === 'deleted' && e.site === 'b' && e.text === ' world'));
});

test('heatmap flags paragraphs edited by two people at the same time', () => {
  const a = new Doc('a');
  a.insert(0, 'calm paragraph\n');
  const b = new Doc('b');
  b.apply(a.missingFor({}));
  // Concurrent edits to the second paragraph.
  a.insert(a.length, 'busy\n');
  b.apply(a.missingFor(b.vector));
  b.insert(b.length - 1, ' and contested', 'b');
  a.apply(b.missingFor(a.vector));
  a.insert(a.length - 1, '!');
  const heat = heatmap(a);
  assert.equal(heat.length, 1);
  assert.equal(a.text().slice(heat[0].from, heat[0].to).startsWith('busy'), true);
});
