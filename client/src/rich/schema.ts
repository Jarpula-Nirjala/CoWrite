import { Schema, type DOMOutputSpec, type Mark, type Node as PMNode } from 'prosemirror-model';

/**
 * The editor schema mirrors the CRDT's flat model: every paragraph is one
 * `para` node whose kind (heading, list item, task…) is an attribute, objects
 * are `atom` nodes, and inline objects are `chip` nodes. That keeps the
 * mapping between editor positions and CRDT characters trivial.
 */

export const PARA_DEFAULTS = {
  block: 'p',
  level: 0,
  align: null as string | null,
  checked: false,
  assignee: null as { id: string; name: string } | null,
  due: null as string | null,
  lang: null as string | null,
  emoji: null as string | null,
  tone: null as string | null,
};

const FONTS: Record<string, string> = {
  serif: "'Times New Roman', Times, serif",
  georgia: 'Georgia, serif',
  sans: "Arial, 'Helvetica Neue', sans-serif",
  verdana: 'Verdana, sans-serif',
  mono: "'Courier New', ui-monospace, monospace",
  garamond: "Garamond, 'EB Garamond', serif",
  trebuchet: "'Trebuchet MS', sans-serif",
  dyslexic: "'OpenDyslexic', sans-serif",
  hand: "'Caveat', 'Segoe Print', cursive",
};
export const FONT_NAMES = Object.keys(FONTS);
export const fontStack = (f: string) => FONTS[f] ?? FONTS.serif;

function paraDOM(node: PMNode): DOMOutputSpec {
  const a = node.attrs;
  const style = a.align ? `text-align:${a.align}` : '';
  const common = { class: `blk blk-${a.block} lvl-${a.level}`, style, 'data-level': String(a.level) };
  switch (a.block) {
    case 'h':
      return [`h${Math.min(3, Math.max(1, a.level || 1))}`, { ...common, class: `blk blk-h` }, 0];
    case 'quote':
      return ['blockquote', common, 0];
    case 'code':
      return ['pre', { ...common, 'data-lang': a.lang ?? '' }, ['code', 0]];
    case 'task': {
      const meta = [a.assignee ? `@${a.assignee.name}` : '', a.due ? `due ${a.due}` : ''].filter(Boolean).join(' · ');
      return ['div', { ...common, 'data-checked': a.checked ? 'true' : 'false', ...(meta ? { 'data-meta': meta } : {}) }, ['span', { class: 'task-text' }, 0]];
    }
    case 'callout':
      return ['div', { ...common, 'data-tone': a.tone ?? 'info', 'data-emoji': a.emoji ?? '💡' }, 0];
    default:
      return ['p', common, 0];
  }
}

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    para: {
      group: 'block',
      content: 'inline*',
      attrs: Object.fromEntries(Object.entries(PARA_DEFAULTS).map(([k, v]) => [k, { default: v }])),
      defining: true,
      parseDOM: [
        { tag: 'p', getAttrs: (d) => alignOf(d as HTMLElement) },
        { tag: 'h1', getAttrs: (d) => ({ block: 'h', level: 1, ...alignOf(d as HTMLElement) }) },
        { tag: 'h2', getAttrs: (d) => ({ block: 'h', level: 2, ...alignOf(d as HTMLElement) }) },
        { tag: 'h3', getAttrs: (d) => ({ block: 'h', level: 3, ...alignOf(d as HTMLElement) }) },
        { tag: 'h4', getAttrs: () => ({ block: 'h', level: 3 }) },
        { tag: 'blockquote', getAttrs: () => ({ block: 'quote' }) },
        { tag: 'pre', preserveWhitespace: 'full', getAttrs: () => ({ block: 'code' }) },
        { tag: 'li', getAttrs: (d) => listAttrs(d as HTMLElement) },
        { tag: 'div[data-block]', getAttrs: (d) => ({ block: (d as HTMLElement).dataset.block }) },
      ],
      toDOM: paraDOM,
    },
    atom: {
      group: 'block',
      atom: true,
      selectable: true,
      draggable: true,
      attrs: { kind: { default: 'hr' }, data: { default: {} } },
      parseDOM: [
        { tag: 'hr', getAttrs: () => ({ kind: 'hr', data: {} }) },
        {
          tag: 'img[src]',
          getAttrs: (d) => ({ kind: 'image', data: { src: (d as HTMLImageElement).getAttribute('src'), caption: (d as HTMLImageElement).alt ?? '', w: 100, align: 'center' } }),
        },
        { tag: 'table', getAttrs: (d) => ({ kind: 'table', data: { rows: tableRows(d as HTMLElement), header: true } }) },
      ],
      toDOM: (node) => ['div', { class: `atom atom-${node.attrs.kind}` }],
    },
    chip: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { kind: { default: 'mention' }, data: { default: {} } },
      toDOM: (node) => ['span', { class: `chip chip-${node.attrs.kind}` }, chipLabel(node)],
    },
    text: { group: 'inline' },
  },
  marks: {
    b: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight=bold' }, { style: 'font-weight=700' }], toDOM: () => ['strong', 0] },
    i: { parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
    u: { parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }], toDOM: () => ['u', 0] },
    s: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }], toDOM: () => ['s', 0] },
    code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
    sub: { excludes: 'sup', parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
    sup: { excludes: 'sub', parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
    link: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [{ tag: 'a[href]', getAttrs: (d) => ({ href: (d as HTMLElement).getAttribute('href') }) }],
      toDOM: (m: Mark) => ['a', { href: m.attrs.href, rel: 'noopener noreferrer nofollow', target: '_blank' }, 0],
    },
    color: {
      attrs: { c: {} },
      parseDOM: [{ style: 'color', getAttrs: (v) => ({ c: v }) }],
      toDOM: (m: Mark) => ['span', { style: `color:${m.attrs.c}` }, 0],
    },
    bg: {
      attrs: { c: {} },
      parseDOM: [{ tag: 'mark', getAttrs: () => ({ c: '#fff59d' }) }],
      toDOM: (m: Mark) => ['mark', { style: `background:${m.attrs.c}` }, 0],
    },
    font: {
      attrs: { f: {} },
      toDOM: (m: Mark) => ['span', { style: `font-family:${fontStack(m.attrs.f)}` }, 0],
    },
    size: {
      attrs: { s: {} },
      toDOM: (m: Mark) => ['span', { style: `font-size:${m.attrs.s}px` }, 0],
    },
  },
});

function alignOf(el: HTMLElement) {
  const a = el.style?.textAlign;
  return a && ['center', 'right', 'justify'].includes(a) ? { align: a } : {};
}

function listAttrs(el: HTMLElement) {
  const ordered = el.parentElement?.tagName === 'OL';
  const box = el.querySelector('input[type=checkbox]') as HTMLInputElement | null;
  let level = 0;
  for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'UL' || p.tagName === 'OL') level++;
  return { block: box ? 'task' : ordered ? 'oli' : 'li', level: Math.max(0, Math.min(4, level - 1)), checked: !!box?.checked };
}

function tableRows(el: HTMLElement): string[][] {
  return [...el.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => (c.textContent ?? '').trim()));
}

function chipLabel(node: PMNode): string {
  const d = node.attrs.data as Record<string, unknown>;
  switch (node.attrs.kind) {
    case 'mention':
      return `@${String(d.name ?? '')}`;
    case 'date':
      return String(d.date ?? '');
    default:
      return '';
  }
}

/** Mark names whose value is a string attribute. */
export const VALUE_MARKS: Record<string, string> = { link: 'href', color: 'c', bg: 'c', font: 'f', size: 's' };
