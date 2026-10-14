import { BLOCK, EMBED, type Attrs, type Id, type Token } from './crdt.ts';

/**
 * The rich-text model on top of the CRDT's flat token sequence.
 *
 *  - Ordinary characters carry inline marks: b, i, u, s, code, sub, sup
 *    (true) and link, color, bg, font, size (string values).
 *  - "\n" ends a paragraph and carries its block attributes: block (kind),
 *    level, align, checked, assignee, due, lang, emoji, tone.
 *  - "￼" with `atom` is a block-level object (image, table, embed…);
 *    with `inline` it is an inline chip (mention, icon, inline math).
 *
 * Keeping blocks as attributes on a terminator character (rather than as a
 * tree) means every structural edit is still just a character edit, which the
 * sequence CRDT already merges correctly.
 */

export type BlockKind = 'p' | 'h' | 'quote' | 'code' | 'li' | 'oli' | 'task' | 'callout';
export type AtomKind =
  | 'image'
  | 'embed'
  | 'link'
  | 'audio'
  | 'file'
  | 'drawing'
  | 'math'
  | 'mermaid'
  | 'hr'
  | 'pagebreak'
  | 'toc'
  | 'summary'
  | 'signature'
  | 'table';

export const MARKS = ['b', 'i', 'u', 's', 'code', 'sub', 'sup', 'link', 'color', 'bg', 'font', 'size'] as const;
export type MarkName = (typeof MARKS)[number];

export const BLOCK_ATTRS = ['block', 'level', 'align', 'checked', 'assignee', 'due', 'lang', 'emoji', 'tone'] as const;

export interface InlinePart {
  text: string;
  marks: Attrs;
  /** Inline chip (mention, icon, math) instead of text. */
  chip?: Attrs;
}

export type RichBlock =
  | { type: 'text'; kind: BlockKind; attrs: Attrs; parts: InlinePart[]; text: string; id: Id | null; start: number; end: number }
  | { type: 'atom'; kind: AtomKind; attrs: Attrs; id: Id; start: number; end: number };

const markAttrs = (a: Attrs): Attrs => {
  const out: Attrs = {};
  for (const m of MARKS) if (a[m] !== undefined && a[m] !== null && a[m] !== false) out[m] = a[m];
  return out;
};

/** Groups tokens into blocks. `start`/`end` are token indices (end exclusive, terminator included). */
export function blocksOf(tokens: Token[]): RichBlock[] {
  const out: RichBlock[] = [];
  let parts: InlinePart[] = [];
  let text = '';
  let start = 0;
  const flush = (attrs: Attrs, id: Id | null, end: number) => {
    out.push({ type: 'text', kind: ((attrs.block as BlockKind) ?? 'p') as BlockKind, attrs, parts, text, id, start, end });
    parts = [];
    text = '';
  };
  tokens.forEach((t, i) => {
    if (t.ch === BLOCK) {
      flush(t.attrs, t.id, i + 1);
      start = i + 1;
    } else if (t.ch === EMBED && t.attrs.atom) {
      if (parts.length) flush({}, null, i);
      out.push({ type: 'atom', kind: t.attrs.atom as AtomKind, attrs: t.attrs, id: t.id, start: i, end: i + 1 });
      start = i + 1;
    } else if (t.ch === EMBED) {
      parts.push({ text: chipText(t.attrs), marks: markAttrs(t.attrs), chip: t.attrs });
      text += chipText(t.attrs);
    } else {
      const marks = markAttrs(t.attrs);
      const last = parts[parts.length - 1];
      if (last && !last.chip && JSON.stringify(last.marks) === JSON.stringify(marks)) last.text += t.ch;
      else parts.push({ text: t.ch, marks });
      text += t.ch;
    }
  });
  if (parts.length) flush({}, null, tokens.length);
  return out;
}

export function chipText(a: Attrs): string {
  switch (a.inline) {
    case 'mention':
      return `@${String(a.name ?? 'someone')}`;
    case 'math':
      return String(a.tex ?? '');
    case 'icon':
      return '';
    case 'date':
      return String(a.date ?? '');
    default:
      return '';
  }
}

/** Plain text of a token list (paragraphs separated by newlines, embeds omitted). */
export function plainText(tokens: Token[]): string {
  return blocksOf(tokens)
    .map((b) => (b.type === 'text' ? b.text : b.kind === 'table' ? tableText(b.attrs) : b.kind === 'image' ? String(b.attrs.caption ?? '') : ''))
    .join('\n');
}

function tableText(a: Attrs): string {
  const rows = Array.isArray(a.rows) ? (a.rows as string[][]) : [];
  return rows.map((r) => r.join(' | ')).join('\n');
}

// --------------------------------------------------------------- markdown

const esc = (s: string) => s.replace(/([*_`[\]])/g, '\\$1');

/** Markdown export. */
export function toMarkdown(tokens: Token[]): string {
  const lines: string[] = [];
  let olIndex = 0;
  for (const b of blocksOf(tokens)) {
    if (b.type === 'atom') {
      olIndex = 0;
      const a = b.attrs;
      switch (b.kind) {
        case 'image':
          lines.push(`![${String(a.caption ?? a.alt ?? '')}](${String(a.src ?? '')})`);
          break;
        case 'hr':
        case 'pagebreak':
          lines.push('---');
          break;
        case 'link':
        case 'embed':
          lines.push(`[${String(a.title ?? a.url ?? '')}](${String(a.url ?? '')})`);
          break;
        case 'math':
          lines.push(`$$\n${String(a.tex ?? '')}\n$$`);
          break;
        case 'mermaid':
          lines.push('```mermaid\n' + String(a.code ?? '') + '\n```');
          break;
        case 'table': {
          const rows = Array.isArray(a.rows) ? (a.rows as string[][]) : [];
          if (rows.length) {
            lines.push(`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`));
          }
          break;
        }
        case 'summary':
          lines.push(`> **Summary:** ${String(a.text ?? '')}`);
          break;
        case 'signature':
          lines.push(`*Signed by ${String(a.name ?? '')}${a.at ? ` on ${new Date(Number(a.at)).toDateString()}` : ''}*`);
          break;
        case 'file':
        case 'audio':
          lines.push(`[${String(a.name ?? 'attachment')}](${String(a.src ?? '')})`);
          break;
        default:
          break;
      }
      lines.push('');
      continue;
    }
    const inline = b.parts
      .map((p) => {
        if (p.chip) return p.text;
        let t = esc(p.text);
        if (p.marks.code) t = `\`${p.text}\``;
        if (p.marks.b) t = `**${t}**`;
        if (p.marks.i) t = `*${t}*`;
        if (p.marks.s) t = `~~${t}~~`;
        if (p.marks.link) t = `[${t}](${String(p.marks.link)})`;
        return t;
      })
      .join('');
    const level = Number(b.attrs.level ?? 0);
    const indent = '  '.repeat(Math.max(0, Math.min(6, level)));
    if (b.kind !== 'oli') olIndex = 0;
    switch (b.kind) {
      case 'h':
        lines.push(`${'#'.repeat(Math.max(1, Math.min(6, level || 1)))} ${inline}`, '');
        break;
      case 'quote':
        lines.push(`> ${inline}`, '');
        break;
      case 'code':
        lines.push('```', b.text, '```', '');
        break;
      case 'li':
        lines.push(`${indent}- ${inline}`);
        break;
      case 'oli':
        lines.push(`${indent}${++olIndex}. ${inline}`);
        break;
      case 'task':
        lines.push(`${indent}- [${b.attrs.checked ? 'x' : ' '}] ${inline}`);
        break;
      case 'callout':
        lines.push(`> ${String(b.attrs.emoji ?? '💡')} ${inline}`, '');
        break;
      default:
        lines.push(inline, '');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export interface NewToken {
  ch: string;
  a?: Attrs;
}

/** Inline markdown (**bold**, *italic*, `code`, ~~strike~~, [link](url)) to tokens. */
function inlineTokens(text: string, base: Attrs = {}): NewToken[] {
  const out: NewToken[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)(.+?)\*|_(?!\s)(.+?)_|`([^`]+)`|~~(.+?)~~|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  const push = (s: string, a: Attrs) => {
    for (const ch of s) {
      // Surrogate pairs become two tokens, like the editor's UTF-16 units.
      for (let i = 0; i < ch.length; i++) out.push({ ch: ch[i], a: Object.keys(a).length ? a : undefined });
    }
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    push(text.slice(last, m.index), base);
    if (m[1] ?? m[2]) out.push(...inlineTokens(m[1] ?? m[2], { ...base, b: true }));
    else if (m[3] ?? m[4]) out.push(...inlineTokens(m[3] ?? m[4], { ...base, i: true }));
    else if (m[5]) push(m[5], { ...base, code: true });
    else if (m[6]) out.push(...inlineTokens(m[6], { ...base, s: true }));
    else if (m[7]) out.push(...inlineTokens(m[7], { ...base, link: m[8] }));
    last = re.lastIndex;
  }
  push(text.slice(last), base);
  return out;
}

/**
 * A small Markdown-to-tokens converter (headings, lists, tasks, quotes, code,
 * rules, tables, images and inline styles). Used for AI output and imports on
 * both the browser and the server, where no DOM is available.
 */
export function markdownToTokens(md: string): NewToken[] {
  const out: NewToken[] = [];
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const end = (a: Attrs) => out.push({ ch: BLOCK, a: Object.keys(a).length ? a : undefined });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpExecArray | null;
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      if (lang === 'mermaid') {
        out.push({ ch: EMBED, a: { atom: 'mermaid', code: body.join('\n') } });
      } else {
        for (const b of body.length ? body : ['']) {
          for (const ch of b) for (let k = 0; k < ch.length; k++) out.push({ ch: ch[k] });
          end({ block: 'code', ...(lang ? { lang } : {}) });
        }
      }
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows: string[][] = [];
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      rows.push(cells(line));
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]));
      i--;
      out.push({ ch: EMBED, a: { atom: 'table', rows, header: true } });
      continue;
    }
    if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line))) {
      out.push({ ch: EMBED, a: { atom: 'image', src: m[2], caption: m[1], w: 100, align: 'center' } });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push({ ch: EMBED, a: { atom: 'hr' } });
      continue;
    }
    if (!line.trim()) {
      // Blank lines separate paragraphs in Markdown; they are not blocks.
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      out.push(...inlineTokens(m[2]));
      end({ block: 'h', level: Math.min(3, m[1].length) });
    } else if ((m = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line))) {
      out.push(...inlineTokens(m[3]));
      end({ block: 'task', ...(m[2] !== ' ' ? { checked: true } : {}), ...(m[1].length >= 2 ? { level: Math.min(4, Math.floor(m[1].length / 2)) } : {}) });
    } else if ((m = /^(\s*)[-*+]\s+(.*)$/.exec(line))) {
      out.push(...inlineTokens(m[2]));
      end({ block: 'li', ...(m[1].length >= 2 ? { level: Math.min(4, Math.floor(m[1].length / 2)) } : {}) });
    } else if ((m = /^(\s*)\d+[.)]\s+(.*)$/.exec(line))) {
      out.push(...inlineTokens(m[2]));
      end({ block: 'oli', ...(m[1].length >= 2 ? { level: Math.min(4, Math.floor(m[1].length / 2)) } : {}) });
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      out.push(...inlineTokens(m[1]));
      end({ block: 'quote' });
    } else {
      out.push(...inlineTokens(line));
      end({});
    }
  }
  return out;
}

/** Tasks found in a document, for the "assigned to me" view and calendar. */
export function tasksOf(tokens: Token[]): { blockId: Id; text: string; done: boolean; assignee: string | null; due: string | null }[] {
  return blocksOf(tokens)
    .filter((b): b is Extract<RichBlock, { type: 'text' }> => b.type === 'text' && b.kind === 'task' && b.id !== null)
    .map((b) => ({
      blockId: b.id!,
      text: b.text.slice(0, 300),
      done: !!b.attrs.checked,
      assignee: (b.attrs.assignee as { id?: string } | undefined)?.id ?? null,
      due: typeof b.attrs.due === 'string' ? b.attrs.due : null,
    }));
}
