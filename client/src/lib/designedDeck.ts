import { keysAfter, uid } from '../kinds/objects.ts';
import type { El } from '../kinds/slides/model.ts';
import type { Deco, SlideTheme } from '../kinds/slides/themes.ts';
import type { InitialContent } from './templates.ts';

/** What AI Smart Create returns: the deck's own design plus slide-by-slide layouts. */
export interface DesignedDeck {
  title: string;
  subtitle: string;
  design: Partial<Record<'darkBg' | 'lightBg' | 'darkText' | 'lightText' | 'accent' | 'accent2' | 'headingFont' | 'bodyFont' | 'mood', string>>;
  slides: {
    layout: string;
    dark: boolean;
    title: string;
    subtitle: string;
    subtitle2?: string;
    bullets: string[];
    items: { icon: string; heading: string; text: string }[];
    imageQuery?: string;
    image?: string | null;
    notes: string;
  }[];
}

type Part = Partial<El>;
const W = 960;
const hex = (v: string | undefined, d: string) => (v && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : d);
const SERIF = ['Playfair Display', 'Merriweather', 'Georgia', 'Times New Roman'];
const fontStack = (f: string | undefined, d: string) => {
  const name = f || d;
  return `'${name}', ${SERIF.includes(name) ? "Georgia, 'Times New Roman', serif" : "'Segoe UI', Arial, sans-serif"}`;
};
const MOOD_DECO: Record<string, Deco> = { tech: 'circuit', corporate: 'poly', academic: 'arch', creative: 'mesh', minimal: 'none', warm: 'halo', nature: 'corner', medical: 'plus', finance: 'ledger' };
const MOOD_PHOTO: Record<string, string> = { tech: 'circuit', corporate: 'office', academic: 'lecture', creative: 'idea', minimal: 'architecture', warm: 'teamwork', nature: 'forest', medical: 'doctors', finance: 'finance' };

/** Roughly how many lines a phrase needs at a size and width (on the 960-wide canvas). */
const lines = (text: string, width: number, size: number) => Math.max(1, Math.ceil((text.length * size * 0.56) / width));

/** Mixes two hex colours (0 = a, 1 = b). */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Builds a deck with its own theme from an AI design; optionally on the person's background picture. */
export function designedDeck(d: DesignedDeck, opts: { backgroundImage?: string | null; backdrop?: 'dark' | 'light' | null } = {}): InitialContent {
  const g = d.design ?? {};
  const darkBg = hex(g.darkBg, '#0B1020');
  const lightBg = hex(g.lightBg, '#F5F7FB');
  const darkText = hex(g.darkText, '#141B2D');
  const lightText = hex(g.lightText, '#FFFFFF');
  const accent = hex(g.accent, '#00A3C4');
  const accent2 = hex(g.accent2, '#8B5CF6');
  const hFont = fontStack(g.headingFont, 'Poppins');
  const bFont = fontStack(g.bodyFont, 'Inter');
  const mood = g.mood ?? 'corporate';
  const darkGrad = `linear-gradient(135deg, ${darkBg} 0%, ${mix(darkBg, accent2, 0.22)} 100%)`;
  const theme: SlideTheme = {
    id: 'custom',
    name: 'Designed for this deck',
    bg: lightBg,
    titleBg: darkGrad,
    title: darkText,
    text: darkText,
    accent,
    titleFont: hFont,
    bodyFont: bFont,
    deco: opts.backgroundImage ? 'none' : (MOOD_DECO[mood] ?? 'none'),
    decoColor: accent,
    solid: lightBg.slice(1).toUpperCase(),
  };
  const fallbackPhoto = `/tpl/${MOOD_PHOTO[mood] ?? 'office'}.jpg`;
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  const slides: { layout: string; notes: string; bg?: string; bgImage?: string; els: Part[] }[] = [];
  let section = 0;

  for (const s of d.slides) {
    const onImage = !!opts.backgroundImage;
    const dark = onImage ? opts.backdrop === 'dark' : s.dark || ['cover', 'section', 'closing'].includes(s.layout);
    const fg = dark ? lightText : darkText;
    const soft = dark ? mix(lightText, darkBg, 0.25) : mix(darkText, lightBg, 0.3);
    const card = dark ? 'rgba(255,255,255,0.07)' : onImage ? 'rgba(255,255,255,0.88)' : '#ffffff';
    const cardLine = dark ? mix(darkBg, lightText, 0.25) : mix(lightBg, darkText, 0.12);
    const T = (x: number, y: number, w: number, h: number, text: string, o: Part = {}): Part => ({ kind: 'text', x, y, w, h, text, size: 20, align: 'left', valign: 'top', color: fg, font: bFont, ...o });
    const H = (x: number, y: number, w: number, h: number, text: string, o: Part = {}): Part => T(x, y, w, h, text, { bold: true, font: hFont, ...o });
    const box = (x: number, y: number, w: number, h: number, fill: string, o: Part = {}): Part => ({ kind: 'shape', shape: 'rect', x, y, w, h, fill, ...o });
    const img = (x: number, y: number, w: number, h: number, src: string): Part => ({ kind: 'image', x, y, w, h, src, fit: 'cover' });
    const title = (t: string): Part[] => [H(60, 34, 840, 70, t, { role: 'title', size: t.length > 48 ? 28 : 34, valign: 'middle' }), box(60, 106, 64, 5, accent)];
    const b = s.bullets.filter((x) => x.trim());
    const items = s.items.filter((x) => x.heading.trim() || x.text.trim());
    const photo = s.image || null;
    const els: Part[] = [];
    let layout = 'title-content';

    switch (s.layout) {
      case 'cover': {
        layout = 'title';
        const pic = photo || (onImage ? null : fallbackPhoto);
        const textW = pic ? 440 : 760;
        if (pic) els.push(img(540, 0, 420, 540, pic), box(532, 0, 8, 540, accent));
        else if (!onImage) els.push({ kind: 'shape', shape: 'ellipse', x: 640, y: 90, w: 360, h: 360, fill: accent, opacity: 0.1 }, { kind: 'shape', shape: 'ellipse', x: 720, y: 170, w: 200, h: 200, fill: 'none', stroke: accent, strokeW: 2 });
        els.push(
          H(60, 150, textW, 190, s.title || d.title, { role: 'title', size: (s.title || d.title).length > 50 ? 36 : 44, valign: 'bottom' }),
          box(60, 352, 70, 5, accent),
          T(60, 370, textW, 80, s.subtitle || d.subtitle, { role: 'subtitle', size: 20, color: soft }),
          T(60, 456, textW, 60, s.subtitle2 || `Presenter · ${date}`, { size: (s.subtitle2 ?? '').length > 60 ? 12 : 14, color: soft }),
        );
        break;
      }
      case 'section': {
        layout = 'section';
        section++;
        els.push(H(80, 110, 300, 140, String(section).padStart(2, '0'), { size: 110, color: accent, opacity: 0.85 }), H(80, 262, 800, 92, s.title, { role: 'title', size: 46, valign: 'middle' }), T(80, 360, 760, 70, s.subtitle || b[0] || '', { size: 20, color: soft }));
        break;
      }
      case 'closing': {
        layout = 'title';
        if (photo) els.push(img(0, 0, W, 540, photo), box(0, 0, W, 540, darkBg, { opacity: 0.72 }));
        els.push(
          box(450, 150, 60, 5, accent),
          H(80, 168, 800, 110, s.title || 'Thank You', { role: 'title', size: 60, align: 'center', valign: 'middle', color: lightText }),
          T(80, 282, 800, 50, s.subtitle || 'Questions and Answers', { size: 24, align: 'center', color: accent, bold: true }),
          T(130, 350, 700, 100, b[0] ?? '', { size: 18, align: 'center', color: mix(lightText, darkBg, 0.2), italic: true }),
        );
        break;
      }
      case 'text-image':
      case 'bullets': {
        els.push(...title(s.title));
        const pic = s.layout === 'text-image' ? photo || fallbackPhoto : photo;
        if (pic) {
          layout = 'image-text';
          els.push(T(60, 135, 470, 370, b.join('\n'), { role: 'body', size: b.length > 5 ? 18 : 21, list: true }), img(570, 130, 330, 360, pic), box(570, 484, 330, 6, accent));
        } else els.push(T(60, 135, 840, 370, b.join('\n'), { role: 'body', size: b.length > 6 ? 19 : 23, list: true }));
        break;
      }
      case 'cards': {
        els.push(...title(s.title));
        const list = items.slice(0, 6);
        const n = Math.max(1, list.length);
        const cols = n <= 4 ? n : 3;
        const rows = Math.ceil(n / cols);
        const top = s.subtitle ? 160 : 135;
        if (s.subtitle) els.push(T(60, 116, 840, 34, s.subtitle, { size: 16, color: soft }));
        const cw = (840 - (cols - 1) * 16) / cols;
        const ch = rows === 1 ? 500 - top : (500 - top - 16) / 2;
        list.forEach((it, i) => {
          const x = 60 + (i % cols) * (cw + 16);
          const y = top + Math.floor(i / cols) * (ch + 16);
          const c = i % 2 ? accent2 : accent;
          // Headings wrap to as many lines as they need; the description starts below them.
          const hs = rows === 1 ? (cols >= 4 ? 18 : 20) : 17;
          const hLines = lines(it.heading, cw - 32, hs);
          const hy = y + (rows === 1 ? 70 : 56);
          const hh = hLines * hs * 1.3 + 4;
          els.push(
            box(x, y, cw, ch, card, { stroke: cardLine, strokeW: 1 }),
            box(x, y, cw, 5, c),
            T(x + 16, y + 14, 60, 46, it.icon || '•', { size: rows === 1 ? 32 : 26 }),
            H(x + 16, hy, cw - 32, hh, it.heading, { size: hs, color: dark ? lightText : mix(c, darkText, 0.35) }),
            T(x + 16, hy + hh + 4, cw - 32, Math.max(30, y + ch - (hy + hh + 12)), it.text, { size: rows === 1 ? 16 : 14, color: soft }),
          );
        });
        break;
      }
      case 'process': {
        els.push(...title(s.title));
        const list = items.slice(0, 6);
        const n = Math.max(1, list.length);
        const gap = 34;
        const bw = (840 - (n - 1) * gap) / n;
        const mid = Math.floor(n / 2);
        list.forEach((it, i) => {
          const x = 60 + i * (bw + gap);
          const c = i === mid ? accent2 : accent;
          els.push(
            { kind: 'shape', shape: 'round', x, y: 160, w: bw, h: 120, fill: c },
            T(x, 172, bw, 40, it.icon || String(i + 1), { size: 28, align: 'center', color: '#ffffff' }),
            H(x + 8, 214, bw - 16, 56, it.heading, { size: n > 4 ? 14 : 16, align: 'center', valign: 'middle', color: '#ffffff' }),
            T(x, 296, bw, 190, it.text, { size: n > 4 ? 13 : 15, align: 'center', color: soft }),
          );
          if (i < n - 1) els.push({ kind: 'shape', shape: 'arrow', x: x + bw + 5, y: 206, w: gap - 10, h: 28, fill: accent2 });
        });
        break;
      }
      case 'nested': {
        els.push(...title(s.title));
        const list = items.slice(0, 4);
        const n = Math.max(1, list.length);
        const cx = 300;
        const cy = 318;
        const step = 190 / n;
        list.forEach((it, i) => {
          const r = 240 - i * step;
          const c = i % 2 ? accent2 : accent;
          els.push({ kind: 'shape', shape: 'ellipse', x: cx - r, y: cy - r * 0.78, w: r * 2, h: r * 1.56, fill: c, opacity: 0.16 + i * 0.12, stroke: c, strokeW: 2 });
        });
        list.forEach((it, i) => {
          const r = 240 - i * step;
          els.push(H(cx - 130, cy - r * 0.78 + (i === n - 1 ? r * 0.55 : 12), 260, 30, it.heading, { size: i === n - 1 ? 18 : 16, align: 'center', color: dark ? lightText : darkText }));
        });
        list.forEach((it, i) => {
          const y = 150 + i * (340 / n);
          const c = i % 2 ? accent2 : accent;
          els.push({ kind: 'shape', shape: 'ellipse', x: 580, y: y + 6, w: 16, h: 16, fill: c }, H(608, y, 300, 28, it.heading, { size: 18 }), T(608, y + 30, 300, 340 / n - 36, it.text, { size: 14, color: soft }));
        });
        break;
      }
      case 'compare': {
        els.push(...title(s.title));
        const [l, r] = [items[0], items[1]];
        [l, r].forEach((it, i) => {
          if (!it) return;
          const x = i ? 490 : 60;
          const c = i ? accent2 : accent;
          const points = it.text.split(/\s*\|\s*|\n/).filter(Boolean);
          els.push(
            box(x, 136, 410, 360, card, { stroke: cardLine, strokeW: 1 }),
            box(x, 136, 410, 56, c),
            H(x + 14, 136, 382, 56, `${it.icon ? `${it.icon}  ` : ''}${it.heading}`, { size: 20, valign: 'middle', color: '#ffffff' }),
            T(x + 18, 206, 378, 280, points.join('\n'), { size: points.length > 5 ? 16 : 18, list: true }),
          );
        });
        break;
      }
      case 'hub': {
        els.push(...title(s.title));
        const list = items.slice(0, 6);
        const centre = s.subtitle || s.title;
        // The middle of the ellipse is narrower than its box, so long phrases get a smaller size.
        const cs = centre.length > 60 ? 13 : centre.length > 40 ? 15 : centre.length > 22 ? 17 : 20;
        els.push({ kind: 'shape', shape: 'ellipse', x: 380, y: 130, w: 200, h: 320, fill: accent }, H(410, 200, 140, 180, centre, { size: cs, align: 'center', valign: 'middle', color: '#ffffff' }));
        list.forEach((it, i) => {
          const left = i % 2 === 0;
          const row = Math.floor(i / 2);
          const rowsN = Math.ceil(list.length / 2);
          const y = 140 + row * (330 / rowsN) + (330 / rowsN - 96) / 2;
          const x = left ? 60 : 640;
          const c = left ? accent : accent2;
          els.push(
            box(left ? 320 : 560, y + 47, 80, 2, c),
            box(x, y, 260, 96, card, { stroke: c, strokeW: 1.5 }),
            H(x + 14, y + 10, 232, 28, `${it.icon ? `${it.icon} ` : ''}${it.heading}`, { size: 16 }),
            T(x + 14, y + 40, 232, 52, it.text, { size: 13, color: soft }),
          );
        });
        break;
      }
      case 'stats': {
        els.push(...title(s.title));
        const list = items.slice(0, 4);
        const n = Math.max(1, list.length);
        const w = (840 - (n - 1) * 20) / n;
        list.forEach((it, i) => {
          const x = 60 + i * (w + 20);
          const c = i % 2 ? accent2 : accent;
          els.push(box(x, 160, w, 230, card, { stroke: cardLine, strokeW: 1 }), box(x, 160, w, 6, c), H(x, 190, w, 90, it.heading, { size: it.heading.length > 7 ? 40 : 54, align: 'center', valign: 'middle', color: c }), T(x + 14, 290, w - 28, 90, it.text, { size: 16, align: 'center', color: soft }));
        });
        break;
      }
      case 'timeline': {
        els.push(...title(s.title));
        const list = items.slice(0, 6);
        const n = Math.max(1, list.length);
        const span = 780;
        els.push(box(90, 318, span, 5, accent));
        list.forEach((it, i) => {
          const cx = 90 + (n === 1 ? span / 2 : (i * span) / (n - 1));
          const up = i % 2 === 0;
          const c = i % 2 ? accent2 : accent;
          els.push(
            { kind: 'shape', shape: 'ellipse', x: cx - 14, y: 306, w: 28, h: 28, fill: c, stroke: '#ffffff', strokeW: 3 },
            H(cx - 80, up ? 196 : 346, 160, 34, it.heading, { size: 18, align: 'center', color: c }),
            T(cx - 80, up ? 232 : 382, 160, 70, `${it.icon ? `${it.icon} ` : ''}${it.text}`, { size: 13, align: 'center', color: soft }),
          );
        });
        break;
      }
      case 'quote': {
        layout = 'quote';
        els.push(H(90, 60, 120, 120, '“', { size: 150, color: accent }), T(120, 150, 720, 210, b[0] ?? s.title, { size: 32, italic: true, align: 'center', valign: 'middle', font: hFont }), box(450, 380, 60, 4, accent), T(120, 395, 720, 50, s.subtitle ? `— ${s.subtitle}` : '', { size: 18, align: 'center', color: soft }));
        break;
      }
      case 'references': {
        els.push(...title(s.title || 'References'), T(60, 135, 840, 370, b.join('\n'), { size: 16, list: true }));
        break;
      }
      default:
        els.push(...title(s.title), T(60, 135, 840, 370, (b.length ? b : items.map((x) => `${x.heading}: ${x.text}`)).join('\n'), { size: 22, list: true }));
    }

    const slideBg = onImage ? undefined : dark && !['title', 'section'].includes(layout) ? darkGrad : undefined;
    slides.push({ layout, notes: s.notes ?? '', ...(slideBg ? { bg: slideBg } : {}), ...(opts.backgroundImage ? { bgImage: opts.backgroundImage } : {}), els });
  }

  const orders = keysAfter(null, slides.length);
  const objects: { key: string; fields: Record<string, unknown> }[] = [];
  slides.forEach((s, i) => {
    const sid = uid();
    objects.push({ key: `slide:${sid}`, fields: { order: orders[i], layout: s.layout, notes: s.notes, ...(s.bg ? { bg: s.bg } : {}), ...(s.bgImage ? { bgImage: s.bgImage } : {}) } });
    s.els.forEach((el, z) => objects.push({ key: `el:${uid()}`, fields: { ...el, slide: sid, z: z + 1 } as Record<string, unknown> }));
  });
  return { tokens: [], objects, settings: { theme: 'custom', custom: theme, footer: '', numbers: true, logo: null } as unknown as InitialContent['settings'] };
}
