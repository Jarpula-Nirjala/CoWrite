/**
 * Formatting is Markdown: the toolbar edits the text itself, so formatting
 * merges conflict-free like any other edit and exports cleanly.
 */

export type FormatCmd = 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'task' | 'quote' | 'codeblock' | 'hr' | 'table';

export interface FormatEdit {
  from: number;
  to: number;
  insert: string;
  select: [number, number];
}

const INLINE: Partial<Record<FormatCmd, [string, string]>> = {
  bold: ['**', 'bold text'],
  italic: ['*', 'italic text'],
  strike: ['~~', 'struck text'],
  code: ['`', 'code'],
};

const LINE_PREFIX: Partial<Record<FormatCmd, RegExp>> = {
  h1: /^#\s+/,
  h2: /^##\s+/,
  h3: /^###\s+/,
  ul: /^[-*+]\s+(?!\[)/,
  ol: /^\d+[.)]\s+/,
  task: /^[-*+]\s+\[[ xX]\]\s+/,
  quote: /^>\s?/,
};

const ANY_PREFIX = /^(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/;

export function formatEdit(text: string, start: number, end: number, cmd: FormatCmd): FormatEdit {
  const inline = INLINE[cmd];
  if (inline) {
    const [mark, placeholder] = inline;
    const sel = text.slice(start, end);
    // Toggle off when the selection is already wrapped.
    if (text.slice(start - mark.length, start) === mark && text.slice(end, end + mark.length) === mark) {
      return { from: start - mark.length, to: end + mark.length, insert: sel, select: [start - mark.length, end - mark.length] };
    }
    if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) {
      const inner = sel.slice(mark.length, sel.length - mark.length);
      return { from: start, to: end, insert: inner, select: [start, start + inner.length] };
    }
    const body = sel || placeholder;
    return { from: start, to: end, insert: `${mark}${body}${mark}`, select: [start + mark.length, start + mark.length + body.length] };
  }

  if (cmd === 'link') {
    const label = text.slice(start, end) || 'link text';
    const insert = `[${label}](https://)`;
    const urlStart = start + label.length + 3;
    return { from: start, to: end, insert, select: [urlStart, urlStart + 8] };
  }

  // Whole-line commands operate on every line the selection touches.
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd < 0) lineEnd = text.length;
  const block = text.slice(lineStart, lineEnd);

  if (cmd === 'codeblock') {
    const insert = `\`\`\`\n${block || 'code'}\n\`\`\``;
    return { from: lineStart, to: lineEnd, insert, select: [lineStart + 4, lineStart + 4 + (block || 'code').length] };
  }
  if (cmd === 'hr') {
    const insert = `${block}${block ? '\n' : ''}\n---\n`;
    return { from: lineStart, to: lineEnd, insert, select: [lineStart + insert.length, lineStart + insert.length] };
  }
  if (cmd === 'table') {
    const table = '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |';
    const insert = `${block}${block ? '\n\n' : ''}${table}\n`;
    const at = lineStart + (block ? block.length + 2 : 0) + 2;
    return { from: lineStart, to: lineEnd, insert, select: [at, at + 8] };
  }

  const re = LINE_PREFIX[cmd]!;
  const lines = block.split('\n');
  const allHave = lines.every((l) => re.test(l) || !l.trim());
  const prefixFor = (i: number) =>
    cmd === 'h1' ? '# ' : cmd === 'h2' ? '## ' : cmd === 'h3' ? '### ' : cmd === 'ul' ? '- ' : cmd === 'ol' ? `${i + 1}. ` : cmd === 'task' ? '- [ ] ' : '> ';
  let n = 0;
  const out = lines.map((l) => {
    if (!l.trim() && lines.length > 1) return l;
    if (allHave) return l.replace(re, '');
    return prefixFor(n++) + l.replace(ANY_PREFIX, '');
  });
  const insert = out.join('\n');
  return { from: lineStart, to: lineEnd, insert, select: lines.length === 1 ? [lineStart + insert.length, lineStart + insert.length] : [lineStart, lineStart + insert.length] };
}
