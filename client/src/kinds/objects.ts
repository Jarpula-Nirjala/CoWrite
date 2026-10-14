import { useMemo } from 'react';
import type { Attrs, Doc } from '../../../shared/crdt.ts';

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * A string that sorts strictly between `a` and `b` (fractional indexing).
 * Reordering an item only rewrites its own key, so concurrent moves by
 * different people merge without conflicts.
 */
export function keyBetween(a: string | null, b: string | null): string {
  const lo = a ?? '';
  let hi = b;
  let out = '';
  for (let i = 0; ; i++) {
    const da = i < lo.length ? DIGITS.indexOf(lo[i]) : 0;
    const db = hi !== null && i < hi.length ? DIGITS.indexOf(hi[i]) : DIGITS.length;
    if (db - da > 1) return out + DIGITS[Math.floor((da + db) / 2)];
    out += DIGITS[da];
    if (db - da === 1) hi = null;
  }
}

/** n keys in order after `after`. */
export function keysAfter(after: string | null, n: number): string[] {
  const out: string[] = [];
  let prev = after;
  for (let i = 0; i < n; i++) out.push((prev = keyBetween(prev, null)));
  return out;
}

export const uid = () => {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => DIGITS[x % 62]).join('');
};

export interface Obj<T = Attrs> {
  id: string;
  key: string;
  f: T;
}

/** Live objects whose keys start with `prefix:`, sorted by their `order` field. */
export function useObjects<T = Attrs>(doc: Doc, prefix: string, version: number): Obj<T>[] {
  return useMemo(
    () =>
      doc
        .objectsWith(`${prefix}:`)
        .map((o) => ({ id: o.key.slice(prefix.length + 1), key: o.key, f: o.fields as T }))
        .sort((x, y) => {
          const ox = String((x.f as Attrs).order ?? '');
          const oy = String((y.f as Attrs).order ?? '');
          return ox < oy ? -1 : ox > oy ? 1 : x.id < y.id ? -1 : 1;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, prefix, version],
  );
}

export const byZ = <T extends { f: Attrs }>(a: T, b: T) => Number(a.f.z ?? 0) - Number(b.f.z ?? 0);
