import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Doc, type Op } from '../shared/crdt.ts';

/** Deterministic PRNG so failing fuzz seeds can be replayed. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function seeded(site: string, text: string): Doc {
  const base = new Doc('seed');
  base.insert(0, text);
  const doc = new Doc(site);
  doc.apply(base.snapshot().ops);
  return doc;
}

describe('local editing', () => {
  it('inserts and deletes like a string', () => {
    const d = new Doc('a');
    d.insert(0, 'hello');
    d.insert(5, ' world');
    d.insert(0, '>> ');
    d.delete(3, 6); // "hello "
    assert.equal(d.text(), '>> world');
    assert.equal(d.length, 8);
    assert.equal(d.size, 14); // tombstones are kept
  });

  it('rejects out-of-range positions', () => {
    const d = new Doc('a');
    d.insert(0, 'abc');
    assert.throws(() => d.insert(4, 'x'), RangeError);
    assert.throws(() => d.delete(2, 2), RangeError);
  });

  it('handles pastes larger than the spread limit', () => {
    const d = new Doc('a');
    const big = 'x'.repeat(150_000);
    d.insert(0, 'ab');
    d.insert(1, big);
    assert.equal(d.length, big.length + 2);
    assert.equal(d.text().at(-1), 'b');
  });
});

describe('concurrency', () => {
  it('converges on concurrent inserts at the same position in either order', () => {
    const a = seeded('a', 'ac');
    const b = seeded('b', 'ac');
    const opsA = a.insert(1, 'X');
    const opsB = b.insert(1, 'Y');
    a.apply(opsB);
    b.apply(opsA);
    assert.equal(a.text(), b.text());
    assert.match(a.text(), /^a(XY|YX)c$/);
  });

  it('never interleaves two runs typed concurrently at the same spot', () => {
    const a = seeded('a', '[]');
    const b = seeded('b', '[]');
    const opsA: Op[] = [];
    const opsB: Op[] = [];
    // Type character by character, as an editor would.
    for (const [i, ch] of [...'apple'].entries()) opsA.push(...a.insert(1 + i, ch));
    for (const [i, ch] of [...'berry'].entries()) opsB.push(...b.insert(1 + i, ch));
    a.apply(opsB);
    b.apply(opsA);
    assert.equal(a.text(), b.text());
    assert.ok(['[appleberry]', '[berryapple]'].includes(a.text()), a.text());
  });

  it('keeps an insert whose origin was concurrently deleted', () => {
    const a = seeded('a', 'abc');
    const b = seeded('b', 'abc');
    const del = a.delete(1, 1); // delete "b"
    const ins = b.insert(2, 'X'); // type after "b"
    a.apply(ins);
    b.apply(del);
    assert.equal(a.text(), 'aXc');
    assert.equal(b.text(), 'aXc');
  });

  it('ignores duplicate delivery', () => {
    const a = seeded('a', 'abc');
    const b = seeded('b', 'abc');
    const ops = [...a.insert(3, 'd'), ...a.delete(0, 1)];
    assert.equal(b.apply(ops).length, 2);
    assert.equal(b.apply(ops).length, 0);
    assert.equal(b.text(), 'bcd');
  });

  it('buffers ops that arrive before their dependencies', () => {
    const a = new Doc('a');
    const b = new Doc('b');
    const ops = [...a.insert(0, 'abc'), ...a.delete(1, 1)];
    assert.equal(b.apply(ops.slice().reverse().slice(0, 3)).length, 0);
    assert.equal(b.pendingCount, 3);
    b.apply([ops[0]]);
    assert.equal(b.text(), 'ac');
    assert.equal(b.pendingCount, 0);
  });

  it('treats concurrent deletes of the same character as one', () => {
    const a = seeded('a', 'abc');
    const b = seeded('b', 'abc');
    const da = a.delete(1, 1);
    const db = b.delete(1, 1);
    a.apply(db);
    b.apply(da);
    assert.equal(a.text(), 'ac');
    assert.equal(b.text(), 'ac');
  });
});

describe('sync', () => {
  it('missingFor brings a stale replica up to date', () => {
    const a = seeded('a', 'hello');
    const b = seeded('b', 'hello');
    a.insert(5, ' world');
    a.delete(0, 1);
    b.insert(0, 'H');
    b.apply(a.missingFor(b.vector));
    a.apply(b.missingFor(a.vector));
    assert.equal(a.text(), b.text());
    assert.equal(a.text(), 'Hello world');
    assert.deepEqual(a.missingFor(b.vector), []);
  });

  it('round-trips through a snapshot', () => {
    const a = seeded('a', 'snapshot me');
    a.delete(0, 4);
    const restored = Doc.fromSnapshot('r', JSON.parse(JSON.stringify(a.snapshot())));
    assert.equal(restored.text(), 'shot me');
    assert.equal(restored.size, a.size);
    assert.deepEqual(restored.vector, a.vector);
    // The restored replica's clock must be past everything it has seen.
    const [op] = restored.insert(0, '!');
    assert.ok(op.id[1] > Math.max(...Object.values(a.vector)));
  });
});

describe('anchors', () => {
  it('keeps a caret attached to its character across remote edits', () => {
    const a = seeded('a', 'hello world');
    const b = seeded('b', 'hello world');
    const caret = a.idBefore(6); // before "w"
    a.apply(b.insert(0, '>>> '));
    assert.equal(a.posAfter(caret), 10);
    a.apply(b.delete(4, 6)); // delete "hello " including the anchor char
    assert.equal(a.posAfter(caret), 4);
    assert.equal(a.posAfter(null), 0);
    assert.equal(a.posAfter(['nobody', 1]), -1);
  });
});

describe('fuzz: random concurrent editing converges', () => {
  const ALPHABET = 'abcdefghij \n';

  for (let seed = 1; seed <= 60; seed++) {
    it(`seed ${seed}`, () => {
      const rand = mulberry32(seed);
      const n = 2 + Math.floor(rand() * 3);
      const docs = Array.from({ length: n }, (_, i) => new Doc(`s${i}`));
      // inbox[i] holds ops not yet delivered to replica i
      const inbox: Op[][] = docs.map(() => []);

      for (let round = 0; round < 120; round++) {
        const i = Math.floor(rand() * n);
        const d = docs[i];
        let ops: Op[];
        if (d.length > 0 && rand() < 0.35) {
          const pos = Math.floor(rand() * d.length);
          ops = d.delete(pos, 1 + Math.floor(rand() * Math.min(4, d.length - pos)));
        } else {
          const len = 1 + Math.floor(rand() * 4);
          let s = '';
          for (let k = 0; k < len; k++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
          ops = d.insert(Math.floor(rand() * (d.length + 1)), s);
        }
        for (let j = 0; j < n; j++) if (j !== i) inbox[j].push(...ops);

        // Deliver a random, reordered, partly duplicated subset.
        if (rand() < 0.5) {
          const j = Math.floor(rand() * n);
          const batch = shuffle(inbox[j].splice(0, Math.floor(rand() * (inbox[j].length + 1))), rand);
          if (rand() < 0.2) batch.push(...batch.slice(0, 3));
          docs[j].apply(batch);
        }
      }

      for (let j = 0; j < n; j++) docs[j].apply(shuffle(inbox[j], rand));

      const expected = docs[0].text();
      for (const d of docs) {
        assert.equal(d.pendingCount, 0);
        assert.equal(d.text(), expected);
      }
    });
  }
});
