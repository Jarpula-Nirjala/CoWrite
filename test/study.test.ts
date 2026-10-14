import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Doc } from '../shared/crdt.ts';
import { markdownToTokens } from '../shared/rich.ts';
import { cardsFromNotes, makeQuiz, schedule } from '../client/src/editor/study.ts';

const docOf = (md: string) => {
  const d = new Doc('a');
  d.insertTokens(0, markdownToTokens(md));
  return d.tokens();
};

test('flashcards are found in ordinary notes', () => {
  const cards = cardsFromNotes(
    docOf(['# Biology', 'Photosynthesis: how plants turn light into food', '- Mitosis — cell division into two identical cells', '| Term | Meaning |', '| --- | --- |', '| ATP | the energy currency of cells |', '## Osmosis', 'Water moving across a membrane from low to high solute concentration.', 'See https://example.com for more'].join('\n')),
  );
  const qs = cards.map((c) => c.q);
  assert.ok(qs.includes('Photosynthesis'));
  assert.ok(qs.includes('Mitosis'));
  assert.ok(qs.includes('ATP'));
  assert.ok(qs.some((q) => q.includes('Osmosis')));
  assert.ok(!qs.includes('See https'));
});

test('spaced repetition grows intervals and resets on “again”', () => {
  let r = schedule(undefined, 'k', 2, 0);
  assert.equal(r.interval, 1);
  r = schedule(r, 'k', 2, 0);
  assert.equal(r.interval, 3);
  r = schedule(r, 'k', 2, 0);
  assert.ok(r.interval > 6);
  const easy = schedule(r, 'k', 3, 0);
  assert.ok(easy.interval > r.interval && easy.ease > r.ease);
  const again = schedule(r, 'k', 0, 0);
  assert.equal(again.reps, 0);
  assert.equal(again.due, 10 * 60_000);
});

test('quiz questions have the right answer among four options', () => {
  const cards = ['a', 'b', 'c', 'd', 'e'].map((x) => ({ key: x, q: `Q${x}`, a: `A${x}`, source: 'notes' as const }));
  for (const q of makeQuiz(cards, 5)) {
    assert.equal(q.options.length, 4);
    assert.equal(q.options[q.correct], `A${q.q.slice(1)}`);
  }
});
