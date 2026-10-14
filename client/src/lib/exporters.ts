import { marked, type Token, type Tokens } from 'marked';

/** Downloads, conversions and imports. Heavy libraries load only when used. */

export function safeFileName(title: string): string {
  return (title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'document').slice(0, 80);
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportMarkdown(title: string, text: string) {
  download(new Blob([text], { type: 'text/markdown;charset=utf-8' }), `${safeFileName(title)}.md`);
}

export function exportText(title: string, text: string) {
  const plain = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  download(new Blob([plain], { type: 'text/plain;charset=utf-8' }), `${safeFileName(title)}.txt`);
}

// ----------------------------------------------------------- inline runs

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  link?: string;
}

function inlineRuns(tokens: Token[] | undefined, style: Omit<Run, 'text'> = {}): Run[] {
  const out: Run[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong':
        out.push(...inlineRuns((t as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case 'em':
        out.push(...inlineRuns((t as Tokens.Em).tokens, { ...style, italic: true }));
        break;
      case 'del':
        out.push(...inlineRuns((t as Tokens.Del).tokens, { ...style, strike: true }));
        break;
      case 'codespan':
        out.push({ ...style, code: true, text: decode((t as Tokens.Codespan).text) });
        break;
      case 'link':
        out.push(...inlineRuns((t as Tokens.Link).tokens, { ...style, link: (t as Tokens.Link).href }));
        break;
      case 'br':
        out.push({ ...style, text: '\n' });
        break;
      default:
        if ('tokens' in t && Array.isArray(t.tokens) && t.tokens.length) out.push(...inlineRuns(t.tokens as Token[], style));
        else out.push({ ...style, text: decode((t as { text?: string }).text ?? t.raw) });
    }
  }
  return out;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

type Block =
  | { kind: 'heading'; level: number; runs: Run[] }
  | { kind: 'para'; runs: Run[] }
  | { kind: 'item'; ordered: boolean; index: number; depth: number; runs: Run[] }
  | { kind: 'quote'; runs: Run[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' }
  | { kind: 'table'; rows: string[][] };

function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  const walk = (tokens: Token[], depth = 0) => {
    for (const t of tokens) {
      switch (t.type) {
        case 'heading':
          out.push({ kind: 'heading', level: (t as Tokens.Heading).depth, runs: inlineRuns((t as Tokens.Heading).tokens) });
          break;
        case 'paragraph':
          out.push({ kind: 'para', runs: inlineRuns((t as Tokens.Paragraph).tokens) });
          break;
        case 'list': {
          const list = t as Tokens.List;
          list.items.forEach((item, i) => {
            const textTokens = item.tokens.filter((x) => x.type !== 'list');
            const runs = textTokens.flatMap((x) => ('tokens' in x && x.tokens ? inlineRuns(x.tokens as Token[]) : [{ text: decode(x.raw.trim()) }]));
            const prefix = item.task ? (item.checked ? '☑ ' : '☐ ') : '';
            out.push({ kind: 'item', ordered: list.ordered, index: (Number(list.start) || 1) + i, depth, runs: prefix ? [{ text: prefix }, ...runs] : runs });
            const nested = item.tokens.filter((x) => x.type === 'list');
            if (nested.length) walk(nested, depth + 1);
          });
          break;
        }
        case 'blockquote':
          out.push({ kind: 'quote', runs: inlineRuns((t as Tokens.Blockquote).tokens.flatMap((x) => ('tokens' in x ? (x.tokens as Token[]) : []))) });
          break;
        case 'code':
          out.push({ kind: 'code', text: (t as Tokens.Code).text });
          break;
        case 'hr':
          out.push({ kind: 'rule' });
          break;
        case 'table': {
          const tb = t as Tokens.Table;
          out.push({ kind: 'table', rows: [tb.header.map((c) => decode(c.text)), ...tb.rows.map((r) => r.map((c) => decode(c.text)))] });
          break;
        }
        case 'space':
          break;
        default:
          if (t.raw.trim()) out.push({ kind: 'para', runs: [{ text: decode(t.raw.trim()) }] });
      }
    }
  };
  walk(marked.lexer(markdown));
  return out;
}

// ------------------------------------------------------------------- DOCX

export async function exportDocx(title: string, markdown: string) {
  const d = await import('docx');
  const runOf = (r: Run) =>
    new d.TextRun({
      text: r.text,
      bold: r.bold,
      italics: r.italic,
      strike: r.strike,
      font: r.code ? 'Courier New' : 'Times New Roman',
      color: r.link ? '1F3A68' : undefined,
      underline: r.link ? {} : undefined,
    });
  const HEADINGS = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6];
  const children: InstanceType<typeof d.Paragraph | typeof d.Table>[] = [];
  for (const b of blocks(markdown)) {
    switch (b.kind) {
      case 'heading':
        children.push(new d.Paragraph({ heading: HEADINGS[b.level - 1], children: b.runs.map(runOf) }));
        break;
      case 'para':
        children.push(new d.Paragraph({ children: b.runs.map(runOf), spacing: { after: 160 } }));
        break;
      case 'item':
        children.push(
          new d.Paragraph({
            children: [new d.TextRun({ text: b.ordered ? `${b.index}. ` : '• ', font: 'Times New Roman' }), ...b.runs.map(runOf)],
            indent: { left: 360 * (b.depth + 1), hanging: 260 },
          }),
        );
        break;
      case 'quote':
        children.push(new d.Paragraph({ children: b.runs.map((r) => runOf({ ...r, italic: true })), indent: { left: 540 } }));
        break;
      case 'code':
        for (const line of b.text.split('\n')) children.push(new d.Paragraph({ children: [new d.TextRun({ text: line || ' ', font: 'Courier New', size: 20 })] }));
        break;
      case 'rule':
        children.push(new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: 'C9C9C1', space: 1 } } }));
        break;
      case 'table':
        children.push(
          new d.Table({
            width: { size: 100, type: d.WidthType.PERCENTAGE },
            rows: b.rows.map(
              (row, i) =>
                new d.TableRow({
                  children: row.map((cell) => new d.TableCell({ children: [new d.Paragraph({ children: [new d.TextRun({ text: cell, bold: i === 0, font: 'Times New Roman' })] })] })),
                }),
            ),
          }),
        );
        break;
    }
  }
  const file = new d.Document({
    title,
    creator: 'CoWrite',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [{ children }],
  });
  download(await d.Packer.toBlob(file), `${safeFileName(title)}.docx`);
}

// -------------------------------------------------------------------- PDF

export async function exportPdf(title: string, markdown: string) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 64;
  let y = M;

  const ensure = (h: number) => {
    if (y + h > H - M) {
      pdf.addPage();
      y = M;
    }
  };
  const styleOf = (r: Run) => (r.code ? 'normal' : r.bold && r.italic ? 'bolditalic' : r.bold ? 'bold' : r.italic ? 'italic' : 'normal');

  /** Lays out styled runs word by word with wrapping. */
  const paragraph = (runs: Run[], size: number, indent = 0, after = 8, prefix?: string) => {
    const lineH = size * 1.45;
    const maxX = W - M;
    const startX = M + indent;
    let x = startX;
    ensure(lineH);
    if (prefix) {
      pdf.setFont('times', 'normal');
      pdf.setFontSize(size);
      pdf.text(prefix, startX - pdf.getTextWidth(prefix) - 4, y + size);
    }
    for (const r of runs) {
      pdf.setFont(r.code ? 'courier' : 'times', styleOf(r));
      pdf.setFontSize(r.code ? size * 0.9 : size);
      pdf.setTextColor(r.link ? '#1f3a68' : '#111418');
      for (const part of r.text.split(/(\s+)/)) {
        if (!part) continue;
        if (part.includes('\n')) {
          x = startX;
          y += lineH;
          ensure(lineH);
          continue;
        }
        const w = pdf.getTextWidth(part);
        if (x + w > maxX && x > startX && part.trim()) {
          x = startX;
          y += lineH;
          ensure(lineH);
        }
        if (x === startX && !part.trim()) continue;
        pdf.text(part, x, y + size);
        x += w;
      }
    }
    y += lineH + after;
  };

  pdf.setProperties({ title, creator: 'CoWrite' });
  for (const b of blocks(markdown)) {
    switch (b.kind) {
      case 'heading': {
        const size = [24, 19, 16, 14, 13, 12][b.level - 1];
        y += b.level <= 2 ? 8 : 4;
        paragraph(b.runs.map((r) => ({ ...r, bold: true })), size, 0, 6);
        break;
      }
      case 'para':
        paragraph(b.runs, 12);
        break;
      case 'item':
        paragraph(b.runs, 12, 22 * (b.depth + 1), 3, b.ordered ? `${b.index}.` : '•');
        break;
      case 'quote':
        pdf.setDrawColor('#c9c9c1');
        paragraph(b.runs.map((r) => ({ ...r, italic: true })), 12, 18);
        break;
      case 'code':
        for (const line of b.text.split('\n')) paragraph([{ text: line || ' ', code: true }], 10.5, 12, 0);
        y += 8;
        break;
      case 'rule':
        ensure(16);
        pdf.setDrawColor('#c9c9c1');
        pdf.line(M, y + 6, W - M, y + 6);
        y += 18;
        break;
      case 'table':
        for (const [i, row] of b.rows.entries()) paragraph([{ text: row.join('   |   '), bold: i === 0 }], 11, 0, 2);
        y += 8;
        break;
    }
  }
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont('times', 'italic');
    pdf.setFontSize(9);
    pdf.setTextColor('#6a707a');
    pdf.text(`${title} · page ${i} of ${pages}`, W / 2, H - 32, { align: 'center' });
  }
  pdf.save(`${safeFileName(title)}.pdf`);
}

// ------------------------------------------------------------------ import

export async function readImport(file: File): Promise<{ title: string; text: string }> {
  if (file.size > 1_000_000) throw new Error('Files must be under 1 MB.');
  if (!/\.(md|markdown|txt|text)$/i.test(file.name) && !file.type.startsWith('text/')) throw new Error('Import .md or .txt files.');
  const text = (await file.text()).replace(/\r\n?/g, '\n');
  if (text.length > 150_000) throw new Error('That file is too long to import (150,000 characters maximum).');
  const heading = /^#\s+(.+)$/m.exec(text);
  return { title: heading?.[1].trim() || file.name.replace(/\.[^.]+$/, ''), text };
}
