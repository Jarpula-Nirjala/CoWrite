import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colIndex, colName, display, Sheet } from '../client/src/kinds/sheet/formula.ts';

const sheet = (cells: Record<string, string>) => new Sheet((r) => cells[r]);

test('column names round-trip', () => {
  for (const c of [0, 1, 25, 26, 27, 51, 52, 701, 702]) assert.equal(colIndex(colName(c)), c);
  assert.equal(colName(26), 'AA');
});

test('arithmetic, precedence and percentages', () => {
  const s = sheet({ A1: '2', A2: '3', B1: '=A1+A2*4', B2: '=(A1+A2)*4', B3: '=2^3^2', B4: '=-A1+10%', B5: '="x"&A1' });
  assert.equal(s.value('B1'), 14);
  assert.equal(s.value('B2'), 20);
  assert.equal(s.value('B3'), 512);
  assert.equal(s.value('B4'), -1.9);
  assert.equal(s.value('B5'), 'x2');
});

test('functions and ranges', () => {
  const s = sheet({ A1: '1', A2: '2', A3: '3', A4: 'text', B1: '=SUM(A1:A4)', B2: '=AVERAGE(A1:A3)', B3: '=COUNT(A1:A4)', B4: '=COUNTA(A1:A4)', B5: '=IF(B1>5,"big","small")', B6: '=MAX(A1:A3)-MIN(A1:A3)', B7: '=COUNTIF(A1:A3,">1")', B8: '=SUMIF(A1:A3,">=2")', B9: '=ROUND(2/3,2)' });
  assert.equal(s.value('B1'), 6);
  assert.equal(s.value('B2'), 2);
  assert.equal(s.value('B3'), 3);
  assert.equal(s.value('B4'), 4);
  assert.equal(s.value('B5'), 'big');
  assert.equal(s.value('B6'), 2);
  assert.equal(s.value('B7'), 2);
  assert.equal(s.value('B8'), 5);
  assert.equal(s.value('B9'), 0.67);
});

test('errors propagate and IFERROR catches them', () => {
  const s = sheet({ A1: '=1/0', A2: '=A1+1', A3: '=IFERROR(A2,"oops")', A4: '=NOPE(1)', A5: '=1+', A6: '#TAG', A7: '=A6&"!"' });
  assert.equal(s.value('A1'), '#DIV/0!');
  assert.equal(s.value('A2'), '#DIV/0!');
  assert.equal(s.value('A3'), 'oops');
  assert.equal(s.value('A4'), '#NAME?');
  assert.equal(s.value('A5'), '#ERROR!');
  assert.equal(s.value('A7'), '#TAG!');
});

test('cycles are reported, not looped', () => {
  const s = sheet({ A1: '=B1+1', B1: '=A1+1', C1: '=C1' });
  assert.equal(s.value('A1'), '#CYCLE!');
  assert.equal(s.value('C1'), '#CYCLE!');
});

test('display formats', () => {
  assert.equal(display(0.256, 'pct'), '25.6%');
  assert.equal(display(3, null), '3');
  assert.equal(display(0.1 + 0.2, null), '0.3');
  assert.equal(display(true, null), 'TRUE');
});
