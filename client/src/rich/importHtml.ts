import { DOMParser as PMDOMParser } from 'prosemirror-model';
import type { Attrs } from '../../../shared/crdt.ts';
import { flatten } from './convert.ts';
import { schema } from './schema.ts';

/** Converts pasted or imported HTML (e.g. from Word via mammoth) into rich tokens. */
export function htmlToTokens(html: string): { ch: string; a?: Attrs }[] {
  const dom = new window.DOMParser().parseFromString(html, 'text/html');
  const doc = PMDOMParser.fromSchema(schema).parse(dom.body);
  return flatten(doc).map((t) => ({ ch: t.ch, a: Object.keys(t.a).length ? t.a : undefined }));
}
