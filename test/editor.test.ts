import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Doc } from '../shared/crdt.ts';
import { formatEdit } from '../client/src/editor/format.ts';
import { UndoStack } from '../client/src/editor/undo.ts';
import { applyEdits, diffText, outline, textStats } from '../client/src/lib/text.ts';

describe('diff', () => {
  it('turns any text into any other with minimal edits', () => {
    const alpha = 'ab c\n';
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let t = 0; t < 300; t++) {
      const a = Array.from({ length: Math.floor(rand() * 40) }, () => alpha[Math.floor(rand() * alpha.length)]).join('');
      const b = a.slice(0, Math.floor(rand() * a.length)) + 'xy' + a.slice(Math.floor(rand() * a.length));
      const doc = new Doc('d');
      doc.insert(0, a);
      applyEdits(doc, diffText(a, b));
      assert.equal(doc.text(), b);
    }
  });

  it('keeps unchanged characters (and their ids)', () => {
    const doc = new Doc('d');
    doc.insert(0, 'The quick brown fox');
    const keep = doc.idAt(0);
    applyEdits(doc, diffText(doc.text(), 'The quick red fox'));
    assert.equal(doc.text(), 'The quick red fox');
    assert.equal(doc.locate(keep)?.deleted, false);
  });
});

describe('formatting', () => {
  it('wraps and unwraps inline styles', () => {
    const t = 'make this bold';
    const f = formatEdit(t, 10, 14, 'bold');
    const bolded = t.slice(0, f.from) + f.insert + t.slice(f.to);
    assert.equal(bolded, 'make this **bold**');
    const g = formatEdit(bolded, f.select[0], f.select[1], 'bold');
    assert.equal(bolded.slice(0, g.from) + g.insert + bolded.slice(g.to), t);
  });

  it('toggles line prefixes across a selection', () => {
    const t = 'one\ntwo\nthree';
    const f = formatEdit(t, 0, t.length, 'ol');
    assert.equal(f.insert, '1. one\n2. two\n3. three');
    const g = formatEdit(f.insert, 0, f.insert.length, 'ol');
    assert.equal(g.insert, t);
  });
});

describe('selective undo', () => {
  it('undoes only my changes, leaving a collaborator’s edits alone', () => {
    const mine = new Doc('me');
    const theirs = new Doc('them');
    const undo = new UndoStack();
    const ops = mine.insert(0, 'Hello');
    undo.record(ops, '');
    theirs.apply(ops);
    mine.apply(theirs.insert(5, ' world'));
    const removed = mine.text().slice(0, 1);
    undo.record(mine.delete(0, 1), removed); // delete "H"
    assert.equal(mine.text(), 'ello world');
    undo.undo(mine);
    assert.equal(mine.text(), 'Hello world');
    undo.undo(mine);
    assert.equal(mine.text(), ' world');
    undo.redo(mine);
    assert.equal(mine.text(), 'Hello world');
  });
});

describe('text helpers', () => {
  it('builds an outline and statistics', () => {
    const t = '# Title\nIntro text here.\n## Part one\nMore words. And more.\n```\n# not a heading\n```';
    assert.deepEqual(outline(t).map((h) => [h.level, h.text]), [
      [1, 'Title'],
      [2, 'Part one'],
    ]);
    const s = textStats(t);
    assert.ok(s.words >= 10);
    assert.equal(s.sentences, 3);
  });
});
