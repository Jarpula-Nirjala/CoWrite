import type { Token } from '../../../shared/crdt.ts';
import { blocksOf, markdownToTokens, plainText, toMarkdown, type InlinePart, type NewToken, type RichBlock } from '../../../shared/rich.ts';

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
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportMarkdown(title: string, tokens: Token[]) {
  download(new Blob([toMarkdown(tokens)], { type: 'text/markdown;charset=utf-8' }), `${safeFileName(title)}.md`);
}

export function exportText(title: string, tokens: Token[]) {
  download(new Blob([plainText(tokens)], { type: 'text/plain;charset=utf-8' }), `${safeFileName(title)}.txt`);
}

export function exportHtml(title: string, html: string) {
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title><style>body{font-family:'Times New Roman',serif;max-width:760px;margin:40px auto;line-height:1.6;padding:0 16px}img{max-width:100%}table{border-collapse:collapse}td{border:1px solid #ccc;padding:4px 8px}</style></head><body>${html}</body></html>`;
  download(new Blob([page], { type: 'text/html;charset=utf-8' }), `${safeFileName(title)}.html`);
}

type Resolve = (src: string) => Promise<string>;

async function imageBytes(src: string, resolve: Resolve): Promise<{ data: ArrayBuffer; w: number; h: number; type: 'png' | 'jpg' } | null> {
  try {
    const url = await resolve(src);
    const blob = await (await fetch(url)).blob();
    // Normalise everything (webp, gif…) to PNG via a canvas.
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    const png = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (!png) return null;
    return { data: await png.arrayBuffer(), w: bmp.width, h: bmp.height, type: 'png' };
  } catch {
    return null;
  }
}

const listMarker = (b: Extract<RichBlock, { type: 'text' }>, n: number) => (b.kind === 'oli' ? `${n}. ` : b.kind === 'task' ? (b.attrs.checked ? '☑ ' : '☐ ') : '• ');

// ------------------------------------------------------------------- DOCX

export async function exportDocx(title: string, tokens: Token[], resolve: Resolve, opts: { blob?: boolean } = {}): Promise<Blob | void> {
  const d = await import('docx');
  const runOf = (p: InlinePart) =>
    new d.TextRun({
      text: p.text,
      bold: !!p.marks.b,
      italics: !!p.marks.i,
      strike: !!p.marks.s,
      underline: p.marks.u || p.marks.link ? {} : undefined,
      font: p.marks.code ? 'Courier New' : undefined,
      color: typeof p.marks.color === 'string' ? p.marks.color.replace('#', '') : p.marks.link ? '1F3A68' : undefined,
      highlight: p.marks.bg ? 'yellow' : undefined,
      size: p.marks.size ? Number(p.marks.size) * 2 : undefined,
      superScript: !!p.marks.sup,
      subScript: !!p.marks.sub,
    });
  const HEADINGS = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3];
  const ALIGN: Record<string, (typeof d.AlignmentType)[keyof typeof d.AlignmentType]> = {
    center: d.AlignmentType.CENTER,
    right: d.AlignmentType.RIGHT,
    justify: d.AlignmentType.JUSTIFIED,
  };
  const children: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = [];
  let n = 0;
  for (const b of blocksOf(tokens)) {
    if (b.type === 'text') {
      n = b.kind === 'oli' ? n + 1 : 0;
      const runs = b.parts.map(runOf);
      const alignment = ALIGN[String(b.attrs.align ?? '')];
      const level = Number(b.attrs.level ?? 0);
      switch (b.kind) {
        case 'h':
          children.push(new d.Paragraph({ heading: HEADINGS[Math.min(2, Math.max(0, (level || 1) - 1))], children: runs, alignment }));
          break;
        case 'li':
        case 'oli':
        case 'task':
          children.push(new d.Paragraph({ children: [new d.TextRun(listMarker(b, n)), ...runs], indent: { left: 360 * (level + 1), hanging: 260 }, alignment }));
          break;
        case 'quote':
          children.push(new d.Paragraph({ children: b.parts.map((p) => runOf({ ...p, marks: { ...p.marks, i: true } })), indent: { left: 560 }, alignment }));
          break;
        case 'callout':
          children.push(
            new d.Paragraph({
              children: [new d.TextRun(`${String(b.attrs.emoji ?? '💡')} `), ...runs],
              shading: { type: d.ShadingType.CLEAR, fill: 'EEF2F8', color: 'auto' },
              border: { left: { style: d.BorderStyle.SINGLE, size: 18, color: '1F3A68', space: 6 } },
            }),
          );
          break;
        case 'code':
          children.push(new d.Paragraph({ children: [new d.TextRun({ text: b.text || ' ', font: 'Courier New', size: 20 })], shading: { type: d.ShadingType.CLEAR, fill: 'F4F4F1', color: 'auto' } }));
          break;
        default:
          children.push(new d.Paragraph({ children: runs, alignment, spacing: { after: 140 } }));
      }
      continue;
    }
    n = 0;
    const a = b.attrs;
    switch (b.kind) {
      case 'image':
      case 'signature': {
        const src = String(a.src ?? a.img ?? '');
        const img = src ? await imageBytes(src, resolve) : null;
        if (img) {
          const maxW = b.kind === 'signature' ? 220 : (600 * Number(a.w ?? 100)) / 100;
          const scale = Math.min(1, maxW / img.w);
          children.push(
            new d.Paragraph({
              alignment: a.align === 'left' ? d.AlignmentType.LEFT : a.align === 'right' ? d.AlignmentType.RIGHT : d.AlignmentType.CENTER,
              children: [new d.ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.w * scale), height: Math.round(img.h * scale) } })],
            }),
          );
        }
        const caption = b.kind === 'signature' ? `${String(a.name ?? '')}${a.at ? ` — signed ${new Date(Number(a.at)).toLocaleString()}` : ''}` : String(a.caption ?? '');
        if (caption) children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: caption, italics: true, size: 20 })] }));
        break;
      }
      case 'table': {
        const rows = (Array.isArray(a.rows) ? a.rows : []) as string[][];
        if (!rows.length) break;
        children.push(
          new d.Table({
            width: { size: 100, type: d.WidthType.PERCENTAGE },
            rows: rows.map(
              (r, i) =>
                new d.TableRow({
                  children: r.map((cell) => new d.TableCell({ children: [new d.Paragraph({ children: [new d.TextRun({ text: cell, bold: i === 0 && a.header !== false })] })] })),
                }),
            ),
          }),
        );
        break;
      }
      case 'hr':
        children.push(new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: 'C9C9C1', space: 1 } } }));
        break;
      case 'pagebreak':
        children.push(new d.Paragraph({ children: [new d.PageBreak()] }));
        break;
      case 'link':
      case 'embed':
        children.push(new d.Paragraph({ children: [new d.ExternalHyperlink({ link: String(a.url ?? a.src ?? ''), children: [new d.TextRun({ text: String(a.title ?? a.kind ?? a.url ?? 'Link'), style: 'Hyperlink' })] })] }));
        break;
      case 'math':
        children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: String(a.tex ?? ''), italics: true, font: 'Cambria Math' })] }));
        break;
      case 'summary':
        children.push(new d.Paragraph({ children: [new d.TextRun({ text: 'Summary: ', bold: true }), new d.TextRun(String(a.text ?? ''))] }));
        break;
      case 'file':
      case 'audio':
        children.push(new d.Paragraph({ children: [new d.TextRun({ text: `Attachment: ${String(a.name ?? 'file')}`, italics: true })] }));
        break;
      default:
        break;
    }
  }
  const file = new d.Document({
    title,
    creator: 'CoWrite',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [{ children: children.length ? children : [new d.Paragraph('')] }],
  });
  const blob = await d.Packer.toBlob(file);
  if (opts.blob) return blob;
  download(blob, `${safeFileName(title)}.docx`);
}

// -------------------------------------------------------------------- PDF

export async function exportPdf(title: string, tokens: Token[], resolve: Resolve, opts: { header?: string; footer?: string; pageNumbers?: boolean } = {}) {
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
  const styleOf = (m: InlinePart['marks']) => (m.code ? 'normal' : m.b && m.i ? 'bolditalic' : m.b ? 'bold' : m.i ? 'italic' : 'normal');

  const paragraph = (parts: InlinePart[], size: number, indent = 0, after = 8, prefix?: string, align?: string) => {
    const lineH = size * 1.45;
    const maxX = W - M;
    const startX = M + indent;
    // Lay out words into lines first so alignment can be applied.
    type Word = { text: string; w: number; font: string; style: string; size: number; color: string };
    const lines: Word[][] = [[]];
    let x = 0;
    for (const p of parts) {
      const font = p.marks.code ? 'courier' : 'times';
      const style = styleOf(p.marks);
      const sz = p.marks.size ? Number(p.marks.size) * 0.75 : p.marks.code ? size * 0.9 : size;
      pdf.setFont(font, style);
      pdf.setFontSize(sz);
      const color = typeof p.marks.color === 'string' ? p.marks.color : p.marks.link ? '#1f3a68' : '#111418';
      for (const piece of p.text.split(/(\s+)/)) {
        if (!piece) continue;
        const w = pdf.getTextWidth(piece);
        if (x + w > maxX - startX && x > 0 && piece.trim()) {
          lines.push([]);
          x = 0;
        }
        if (x === 0 && !piece.trim()) continue;
        lines[lines.length - 1].push({ text: piece, w, font, style, size: sz, color });
        x += w;
      }
    }
    if (prefix) {
      ensure(lineH);
      pdf.setFont('times', 'normal');
      pdf.setFontSize(size);
      pdf.setTextColor('#111418');
      pdf.text(prefix, startX - pdf.getTextWidth(prefix) - 4, y + size);
    }
    for (const line of lines) {
      ensure(lineH);
      const width = line.reduce((s, wd) => s + wd.w, 0);
      let lx = align === 'center' ? startX + (maxX - startX - width) / 2 : align === 'right' ? maxX - width : startX;
      for (const wd of line) {
        pdf.setFont(wd.font, wd.style);
        pdf.setFontSize(wd.size);
        pdf.setTextColor(wd.color);
        pdf.text(wd.text, lx, y + size);
        lx += wd.w;
      }
      y += lineH;
    }
    y += after;
  };

  pdf.setProperties({ title, creator: 'CoWrite' });
  let n = 0;
  for (const b of blocksOf(tokens)) {
    if (b.type === 'text') {
      n = b.kind === 'oli' ? n + 1 : 0;
      const level = Number(b.attrs.level ?? 0);
      const align = String(b.attrs.align ?? '');
      const parts = b.parts.length ? b.parts : [{ text: ' ', marks: {} }];
      switch (b.kind) {
        case 'h': {
          const size = [22, 17, 14][Math.min(2, Math.max(0, (level || 1) - 1))];
          y += 6;
          paragraph(parts.map((p) => ({ ...p, marks: { ...p.marks, b: true } })), size, 0, 6, undefined, align);
          break;
        }
        case 'li':
        case 'oli':
        case 'task':
          paragraph(parts, 12, 22 * (level + 1), 3, listMarker(b, n).trim(), align);
          break;
        case 'quote':
          paragraph(parts.map((p) => ({ ...p, marks: { ...p.marks, i: true } })), 12, 18, 8, undefined, align);
          break;
        case 'callout': {
          ensure(30);
          const top = y;
          paragraph(parts, 12, 26, 8, String(b.attrs.emoji ?? '').length ? '›' : undefined, align);
          pdf.setDrawColor('#1f3a68');
          pdf.setLineWidth(2);
          pdf.line(M + 8, top, M + 8, y - 6);
          break;
        }
        case 'code':
          paragraph([{ text: b.text || ' ', marks: { code: true } }], 10.5, 12, 1);
          break;
        default:
          paragraph(parts, 12, 0, 8, undefined, align);
      }
      continue;
    }
    n = 0;
    const a = b.attrs;
    switch (b.kind) {
      case 'image':
      case 'signature': {
        const src = String(a.src ?? a.img ?? '');
        const img = src ? await imageBytes(src, resolve) : null;
        if (img) {
          const maxW = b.kind === 'signature' ? 200 : ((W - 2 * M) * Number(a.w ?? 100)) / 100;
          let w = Math.min(maxW, img.w);
          let h = (img.h / img.w) * w;
          if (h > H - 2 * M) {
            h = H - 2 * M;
            w = (img.w / img.h) * h;
          }
          ensure(h + 10);
          const x = a.align === 'left' ? M : a.align === 'right' ? W - M - w : (W - w) / 2;
          pdf.addImage(new Uint8Array(img.data), 'PNG', x, y, w, h);
          y += h + 6;
        }
        const caption = b.kind === 'signature' ? `${String(a.name ?? '')}${a.at ? ` — signed ${new Date(Number(a.at)).toLocaleString()}` : ''}` : String(a.caption ?? '');
        if (caption) paragraph([{ text: caption, marks: { i: true } }], 10, 0, 10, undefined, 'center');
        break;
      }
      case 'table': {
        const rows = (Array.isArray(a.rows) ? a.rows : []) as string[][];
        const cols = Math.max(1, ...rows.map((r) => r.length));
        const cw = (W - 2 * M) / cols;
        pdf.setDrawColor('#c9c9c1');
        pdf.setLineWidth(0.6);
        for (const [i, r] of rows.entries()) {
          pdf.setFont('times', i === 0 && a.header !== false ? 'bold' : 'normal');
          pdf.setFontSize(11);
          const wrapped = r.map((c) => pdf.splitTextToSize(c || ' ', cw - 10) as string[]);
          const rh = Math.max(...wrapped.map((w) => w.length)) * 14 + 8;
          ensure(rh);
          wrapped.forEach((lines, j) => {
            pdf.rect(M + j * cw, y, cw, rh);
            pdf.setTextColor('#111418');
            pdf.text(lines, M + j * cw + 5, y + 15);
          });
          y += rh;
        }
        y += 10;
        break;
      }
      case 'hr':
        ensure(16);
        pdf.setDrawColor('#c9c9c1');
        pdf.setLineWidth(0.8);
        pdf.line(M, y + 6, W - M, y + 6);
        y += 18;
        break;
      case 'pagebreak':
        pdf.addPage();
        y = M;
        break;
      case 'link':
      case 'embed':
        paragraph([{ text: String(a.title ?? a.kind ?? 'Link'), marks: { link: String(a.url ?? '') } }, { text: `  ${String(a.url ?? a.src ?? '')}`, marks: { size: '9' } }], 11);
        break;
      case 'math':
        paragraph([{ text: String(a.tex ?? ''), marks: { i: true } }], 12, 0, 10, undefined, 'center');
        break;
      case 'summary':
        paragraph([{ text: 'Summary: ', marks: { b: true } }, { text: String(a.text ?? ''), marks: {} }], 12);
        break;
      case 'file':
      case 'audio':
        paragraph([{ text: `Attachment: ${String(a.name ?? '')}`, marks: { i: true } }], 11);
        break;
      default:
        break;
    }
  }
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont('times', 'italic');
    pdf.setFontSize(9);
    pdf.setTextColor('#6a707a');
    if (opts.header) pdf.text(opts.header, W / 2, 32, { align: 'center' });
    const foot = [opts.footer, opts.pageNumbers !== false ? `Page ${i} of ${pages}` : ''].filter(Boolean).join('  ·  ');
    if (foot) pdf.text(foot, W / 2, H - 28, { align: 'center' });
  }
  pdf.save(`${safeFileName(title)}.pdf`);
}

// ------------------------------------------------------------------ import

/** Reads .md, .txt, .html or .docx files into rich tokens. */
export async function readImport(file: File): Promise<{ title: string; tokens: NewToken[]; html?: string }> {
  if (file.size > 5_000_000) throw new Error('Files must be under 5 MB.');
  const name = file.name.toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, '');
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return { title: base, tokens: [], html: value };
  }
  if (name.endsWith('.html') || name.endsWith('.htm')) return { title: base, tokens: [], html: await file.text() };
  if (!/\.(md|markdown|txt|text)$/i.test(name) && !file.type.startsWith('text/')) throw new Error('Import .docx, .md, .txt or .html files.');
  const text = (await file.text()).replace(/\r\n?/g, '\n');
  if (text.length > 200_000) throw new Error('That file is too long to import (200,000 characters maximum).');
  const heading = /^#\s+(.+)$/m.exec(text);
  return { title: heading?.[1].trim() || base, tokens: markdownToTokens(text) };
}
