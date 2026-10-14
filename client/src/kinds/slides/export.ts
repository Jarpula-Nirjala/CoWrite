import type { Obj } from '../objects.ts';
import { fontOf, isTitleLayout, textColor, type DeckSettings, type El, type SlideFields } from './model.ts';
import { shapePath } from './shapePath.ts';
import { decoSvg, themeById, type SlideTheme } from './themes.ts';

export interface DeckData {
  slides: Obj<SlideFields>[];
  els: Obj<El>[];
  deck: DeckSettings;
}

const W = 960;
const H = 540;

/** Same-origin URL for an image (external images go through the server). */
function drawable(url: string): string {
  if (/^https?:/i.test(url) && !url.startsWith(location.origin)) return `/api/media/proxy?url=${encodeURIComponent(url)}`;
  return url;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load an image.'));
    img.src = drawable(url);
  });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** CSS backgrounds used by the themes, as SVG markup for rasterising. */
export function backgroundSvg(bg: string): string {
  const stops = (s: string) =>
    [...s.matchAll(/(#[0-9a-f]{3,8}|rgba?\([^)]*\))\s+(\d+)%/gi)].map((m) => `<stop offset="${m[2]}%" stop-color="${m[1]}"/>`).join('');
  const lin = /^linear-gradient\((\d+)deg,(.*)\)$/i.exec(bg.trim());
  if (lin) {
    const a = (Number(lin[1]) * Math.PI) / 180;
    const dx = Math.sin(a) / 2;
    const dy = -Math.cos(a) / 2;
    return `<defs><linearGradient id="g" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}">${stops(lin[2])}</linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`;
  }
  const rad = /^radial-gradient\(circle at (\d+)% (\d+)%,(.*)\)$/i.exec(bg.trim());
  if (rad) {
    return `<defs><radialGradient id="g" cx="${Number(rad[1]) / 100}" cy="${Number(rad[2]) / 100}" r="1">${stops(rad[3])}</radialGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`;
  }
  const pat = /^(#[0-9a-f]{3,8})\s+url\("data:image\/svg\+xml,(.*)"\)$/i.exec(bg.trim());
  if (pat) {
    const inner = decodeURIComponent(pat[2]);
    const pw = Number(/width='(\d+)'/.exec(inner)?.[1] ?? 40);
    const ph = Number(/height='(\d+)'/.exec(inner)?.[1] ?? 40);
    const href = `data:image/svg+xml,${encodeURIComponent(inner)}`;
    return `<defs><pattern id="p" width="${pw}" height="${ph}" patternUnits="userSpaceOnUse"><image href="${esc(href)}" width="${pw}" height="${ph}"/></pattern></defs><rect width="${W}" height="${H}" fill="${pat[1]}"/><rect width="${W}" height="${H}" fill="url(#p)"/>`;
  }
  return `<rect width="${W}" height="${H}" fill="${esc(bg)}"/>`;
}

function svgImage(svg: string, scale: number): Promise<HTMLImageElement> {
  const full = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${svg}</svg>`;
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(full)}`);
}

/** Background + decoration of one slide as a canvas (used by both exports). */
async function paintBackground(g: CanvasRenderingContext2D, slide: SlideFields, theme: SlideTheme, resolve: (s: string) => Promise<string>, scale: number) {
  const title = isTitleLayout(slide.layout);
  if (slide.bgImage) {
    try {
      const img = await loadImage(await resolve(slide.bgImage));
      drawCover(g, img, 0, 0, W, H);
    } catch {
      g.fillStyle = theme.bg.startsWith('#') ? theme.bg.slice(0, 7) : `#${theme.solid}`;
      g.fillRect(0, 0, W, H);
    }
  } else {
    const bg = slide.bg ?? (title && theme.titleBg ? theme.titleBg : theme.bg);
    g.drawImage(await svgImage(backgroundSvg(bg), scale), 0, 0, W, H);
  }
  const deco = decoSvg(theme.deco, theme.decoColor, title && !!theme.titleBg);
  if (deco) g.drawImage(await svgImage(deco, scale), 0, 0, W, H);
}

function drawCover(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, fit: 'cover' | 'contain' = 'cover') {
  const k = fit === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
  const iw = img.width * k;
  const ih = img.height * k;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  g.restore();
}

function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (g.measureText(next).width > width && line) {
        out.push(line);
        line = w;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

function drawText(g: CanvasRenderingContext2D, el: El, color: string, font: string) {
  const size = el.size ?? 24;
  g.font = `${el.italic ? 'italic ' : ''}${el.bold ? '700 ' : ''}${size}px ${font}`;
  g.fillStyle = color;
  g.textBaseline = 'top';
  const pad = 6;
  const indent = el.list ? size * 1.1 : 0;
  const raw = el.list ? (el.text ?? '').split('\n').filter((l) => l.trim()) : [(el.text ?? '')];
  const lines: { text: string; bullet: boolean }[] = [];
  for (const r of raw) wrap(g, r, el.w - pad * 2 - indent).forEach((t, i) => lines.push({ text: t, bullet: !!el.list && i === 0 }));
  const lh = size * 1.25;
  const total = lines.length * lh + (el.list ? (raw.length - 1) * size * 0.35 : 0);
  let y = el.y + pad + (el.valign === 'middle' ? (el.h - pad * 2 - total) / 2 : el.valign === 'bottom' ? el.h - pad * 2 - total : 0);
  for (const [i, l] of lines.entries()) {
    if (l.bullet && i > 0) y += size * 0.35;
    const w = g.measureText(l.text).width;
    const left = el.x + pad + indent;
    const avail = el.w - pad * 2 - indent;
    const x = el.align === 'center' ? left + (avail - w) / 2 : el.align === 'right' ? left + avail - w : left;
    if (l.bullet) {
      g.beginPath();
      g.arc(el.x + pad + size * 0.35, y + size * 0.62, size * 0.16, 0, Math.PI * 2);
      g.fill();
    }
    g.fillText(l.text, x, y);
    if (el.underline) g.fillRect(x, y + size * 1.05, w, Math.max(1, size / 16));
    y += lh;
  }
}

/** Draws one slide onto a canvas `scale` times 960×540. */
export async function renderSlide(data: DeckData, index: number, resolve: (s: string) => Promise<string>, scale = 2): Promise<HTMLCanvasElement> {
  const slide = data.slides[index];
  const theme = themeById(data.deck.theme);
  const c = document.createElement('canvas');
  c.width = W * scale;
  c.height = H * scale;
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  await paintBackground(g, slide.f, theme, resolve, scale);
  const title = isTitleLayout(slide.f.layout);
  const els = data.els.filter((e) => e.f.slide === slide.id).sort((a, b) => a.f.z - b.f.z);
  for (const { f: el } of els) {
    g.save();
    g.globalAlpha = el.opacity ?? 1;
    if (el.kind === 'shape') {
      g.translate(el.x, el.y);
      const p = new Path2D(shapePath(el.shape, el.w, el.h));
      if (el.shape !== 'line') {
        g.fillStyle = el.fill ?? theme.accent;
        g.fill(p);
      }
      const sw = el.strokeW ?? (el.shape === 'line' ? 4 : 0);
      if (sw) {
        g.strokeStyle = el.stroke ?? theme.accent;
        g.lineWidth = sw;
        g.stroke(p);
      }
      g.translate(-el.x, -el.y);
      if (el.text) drawText(g, el, el.color ?? '#ffffff', fontOf(el, theme));
    } else if (el.kind === 'image' && el.src) {
      try {
        drawCover(g, await loadImage(await resolve(el.src)), el.x, el.y, el.w, el.h, el.fit);
      } catch {
        // skip images that cannot be loaded
      }
    } else if (el.kind === 'text') drawText(g, el, textColor(el, theme, title), fontOf(el, theme));
    g.restore();
  }
  const meta = title && theme.titleBg ? '#ffffffcc' : theme.text;
  g.font = `13px ${theme.bodyFont}`;
  g.fillStyle = meta;
  g.textBaseline = 'alphabetic';
  if (data.deck.footer) g.fillText(data.deck.footer, 40, H - 18);
  if (data.deck.numbers && index > 0) {
    const t = `${index + 1} / ${data.slides.length}`;
    g.fillText(t, W - 40 - g.measureText(t).width, H - 18);
  }
  if (data.deck.logo) {
    try {
      const img = await loadImage(await resolve(data.deck.logo));
      const h = 40;
      const w = (img.width / img.height) * h;
      g.drawImage(img, W - 22 - w, 18, w, h);
    } catch {
      // ignore
    }
  }
  return c;
}

const download = (blob: Blob, name: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

const safeName = (t: string) => t.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Presentation';

export async function exportDeckPdf(title: string, data: DeckData, resolve: (s: string) => Promise<string>) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: [W, H], orientation: 'landscape' });
  for (let i = 0; i < data.slides.length; i++) {
    if (i) pdf.addPage([W, H], 'landscape');
    const c = await renderSlide(data, i, resolve, 2);
    pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, H);
  }
  pdf.save(`${safeName(title)}.pdf`);
}

export async function exportSlidePng(title: string, data: DeckData, index: number, resolve: (s: string) => Promise<string>) {
  const c = await renderSlide(data, index, resolve, 2);
  c.toBlob((b) => b && download(b, `${safeName(title)} - slide ${index + 1}.png`), 'image/png');
}

const hex = (c: string | null | undefined, fallback = '000000') => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(c ?? '');
  if (!m) return fallback;
  const h = m[1];
  return (h.length === 3 ? [...h].map((x) => x + x).join('') : h).toUpperCase();
};
const face = (stack: string) => stack.split(',')[0].replace(/['"]/g, '').trim();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pptx = any;

/** Editable PowerPoint file: native text, shapes and pictures on a rendered background. */
export async function exportDeckPptx(title: string, data: DeckData, resolve: (s: string) => Promise<string>) {
  // The package's CommonJS/ESM default export differs between bundlers.
  const mod = (await import('pptxgenjs')) as unknown as { default: unknown };
  const Ctor = ((mod.default as { default?: unknown }).default ?? mod.default) as new () => Pptx;
  const pres = new Ctor();
  pres.layout = 'LAYOUT_16x9';
  pres.title = title;
  const theme = themeById(data.deck.theme);
  const IN = 96; // slide units per inch (960 units = 10in)
  const pt = 0.75; // font px -> pt
  const SHAPES: Record<string, string> = { rect: 'rect', round: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', arrow: 'rightArrow', line: 'line', star: 'star5', diamond: 'diamond' };
  for (const [index, slide] of data.slides.entries()) {
    const s = pres.addSlide();
    // Backgrounds are opaque, so JPEG at 1.5× keeps the file small and sharp.
    const bg = document.createElement('canvas');
    bg.width = W * 1.5;
    bg.height = H * 1.5;
    const g = bg.getContext('2d')!;
    g.scale(1.5, 1.5);
    await paintBackground(g, slide.f, theme, resolve, 1.5);
    s.background = { data: bg.toDataURL('image/jpeg', 0.88).replace(/^data:/, '') };
    const isTitle = isTitleLayout(slide.f.layout);
    const els = data.els.filter((e) => e.f.slide === slide.id).sort((a, b) => a.f.z - b.f.z);
    for (const { f: el } of els) {
      const box = { x: el.x / IN, y: el.y / IN, w: el.w / IN, h: el.h / IN };
      const textOpts = {
        ...box,
        fontSize: Math.round((el.size ?? 24) * pt),
        fontFace: face(fontOf(el, theme)),
        bold: !!el.bold,
        italic: !!el.italic,
        underline: el.underline ? { style: 'sng' as const } : undefined,
        align: el.align ?? 'left',
        valign: el.valign === 'middle' ? ('middle' as const) : el.valign === 'bottom' ? ('bottom' as const) : ('top' as const),
        transparency: el.opacity !== undefined ? Math.round((1 - el.opacity) * 100) : 0,
      };
      if (el.kind === 'text') {
        const color = hex(textColor(el, theme, isTitle));
        if (el.list) {
          const items = (el.text ?? '').split('\n').filter((l) => l.trim());
          s.addText(
            items.map((t) => ({ text: t, options: { bullet: { indent: 18 }, breakLine: true } })),
            { ...textOpts, color, paraSpaceAfter: 6 },
          );
        } else s.addText(el.text ?? '', { ...textOpts, color });
      } else if (el.kind === 'shape') {
        const type = SHAPES[el.shape ?? 'rect'] ?? 'rect';
        s.addShape(type as never, {
          ...box,
          fill: el.shape === 'line' ? undefined : { color: hex(el.fill ?? theme.accent), transparency: el.opacity !== undefined ? Math.round((1 - el.opacity) * 100) : 0 },
          line: (el.strokeW ?? (el.shape === 'line' ? 4 : 0)) ? { color: hex(el.stroke ?? theme.accent), width: (el.strokeW ?? 4) * pt } : undefined,
        });
        if (el.text) s.addText(el.text, { ...textOpts, color: hex(el.color ?? '#ffffff') });
      } else if (el.kind === 'image' && el.src) {
        try {
          const img = await loadImage(await resolve(el.src));
          const c = document.createElement('canvas');
          const k = Math.min(1, 1600 / Math.max(img.width, img.height));
          c.width = Math.round(img.width * k);
          c.height = Math.round(img.height * k);
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
          s.addImage({ data: c.toDataURL('image/jpeg', 0.9).replace(/^data:/, ''), ...box, sizing: { type: el.fit === 'contain' ? 'contain' : 'cover', w: box.w, h: box.h } });
        } catch {
          // skip
        }
      }
    }
    const metaColor = isTitle && theme.titleBg ? 'FFFFFF' : hex(theme.text);
    if (data.deck.footer) s.addText(data.deck.footer, { x: 0.4, y: 5.2, w: 6, h: 0.3, fontSize: 10, color: metaColor, fontFace: face(theme.bodyFont) });
    if (data.deck.numbers && index > 0) s.addText(`${index + 1} / ${data.slides.length}`, { x: 8.6, y: 5.2, w: 1, h: 0.3, fontSize: 10, color: metaColor, align: 'right', fontFace: face(theme.bodyFont) });
    if (data.deck.logo) {
      try {
        const img = await loadImage(await resolve(data.deck.logo));
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d')!.drawImage(img, 0, 0);
        const h = 40 / IN;
        const w = (img.width / img.height) * h;
        s.addImage({ data: c.toDataURL('image/png').replace(/^data:/, ''), x: (W - 22) / IN - w, y: 18 / IN, w, h });
      } catch {
        // ignore
      }
    }
    if (slide.f.notes) s.addNotes(slide.f.notes);
  }
  await pres.writeFile({ fileName: `${safeName(title)}.pptx` });
}
