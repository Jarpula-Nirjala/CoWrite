import type { Attrs, Doc, Op } from '../../../../shared/crdt.ts';
import { keyBetween, uid } from '../objects.ts';
import type { LayoutId, SlideTheme } from './themes.ts';

export interface SlideFields {
  order: string;
  layout: LayoutId;
  notes?: string;
  bg?: string | null;
  bgImage?: string | null;
}

export interface El {
  slide: string;
  kind: 'text' | 'image' | 'shape';
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  text?: string;
  role?: 'title' | 'subtitle' | 'body' | 'caption' | 'number' | 'quote';
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string | null;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  font?: string | null;
  list?: boolean;
  fill?: string | null;
  stroke?: string | null;
  strokeW?: number;
  shape?: 'rect' | 'round' | 'ellipse' | 'triangle' | 'arrow' | 'line' | 'star' | 'diamond';
  src?: string | null;
  fit?: 'cover' | 'contain';
  opacity?: number;
  credit?: string;
}

export interface DeckSettings {
  theme: string;
  logo: string | null;
  footer: string;
  numbers: boolean;
}

export const DECK_DEFAULTS: DeckSettings = { theme: 'navy', logo: null, footer: '', numbers: true };

export function readDeck(doc: Doc): DeckSettings {
  return readDeckFields(doc.getObject('settings') ?? {});
}

export const readDeckFields = (f: Attrs): DeckSettings => ({ ...DECK_DEFAULTS, ...(f as Partial<DeckSettings>) });

export const isTitleLayout = (l: string) => l === 'title' || l === 'section';

/** Default elements for a new slide of the given layout. */
export function layoutElements(layout: LayoutId, slide: string, content?: { title?: string; subtitle?: string; bullets?: string[]; right?: string[] }): Partial<El>[] {
  const t = content?.title;
  const body = content?.bullets?.join('\n');
  switch (layout) {
    case 'title':
      return [
        { slide, kind: 'text', role: 'title', x: 80, y: 170, w: 800, h: 120, size: 56, bold: true, align: 'center', valign: 'middle', text: t ?? 'Presentation title', z: 2 },
        { slide, kind: 'text', role: 'subtitle', x: 80, y: 300, w: 800, h: 70, size: 24, align: 'center', valign: 'top', text: content?.subtitle ?? 'Subtitle · Your name · Date', z: 3 },
      ];
    case 'section':
      return [
        { slide, kind: 'text', role: 'title', x: 80, y: 200, w: 800, h: 110, size: 54, bold: true, align: 'left', valign: 'middle', text: t ?? 'Section title', z: 2 },
        { slide, kind: 'text', role: 'subtitle', x: 80, y: 310, w: 800, h: 50, size: 22, align: 'left', text: content?.subtitle ?? 'A short description of this part', z: 3 },
      ];
    case 'title-content':
      return [
        { slide, kind: 'text', role: 'title', x: 60, y: 40, w: 840, h: 80, size: 38, bold: true, align: 'left', valign: 'middle', text: t ?? 'Slide title', z: 2 },
        { slide, kind: 'text', role: 'body', x: 60, y: 140, w: 840, h: 340, size: 24, list: true, align: 'left', text: body ?? 'First key point\nSecond key point\nThird key point', z: 3 },
      ];
    case 'two-column':
      return [
        { slide, kind: 'text', role: 'title', x: 60, y: 40, w: 840, h: 80, size: 38, bold: true, align: 'left', valign: 'middle', text: t ?? 'Compare two ideas', z: 2 },
        { slide, kind: 'text', role: 'body', x: 60, y: 140, w: 400, h: 340, size: 22, list: true, text: body ?? 'Left point one\nLeft point two', z: 3 },
        { slide, kind: 'text', role: 'body', x: 500, y: 140, w: 400, h: 340, size: 22, list: true, text: content?.right?.join('\n') ?? 'Right point one\nRight point two', z: 4 },
      ];
    case 'image-text':
      return [
        { slide, kind: 'text', role: 'title', x: 60, y: 40, w: 840, h: 80, size: 38, bold: true, align: 'left', valign: 'middle', text: t ?? 'Picture this', z: 2 },
        { slide, kind: 'image', x: 60, y: 140, w: 420, h: 340, src: null, fit: 'cover', z: 3 },
        { slide, kind: 'text', role: 'body', x: 510, y: 140, w: 390, h: 340, size: 22, list: true, text: body ?? 'Describe the image\nWhy it matters', z: 4 },
      ];
    case 'quote':
      return [
        { slide, kind: 'text', role: 'quote', x: 100, y: 150, w: 760, h: 200, size: 36, italic: true, align: 'center', valign: 'middle', text: t ?? '“The best way to predict the future is to invent it.”', z: 2 },
        { slide, kind: 'text', role: 'caption', x: 100, y: 370, w: 760, h: 50, size: 20, align: 'center', text: content?.subtitle ?? '— Alan Kay', z: 3 },
      ];
    case 'big-number':
      return [
        { slide, kind: 'text', role: 'number', x: 80, y: 120, w: 800, h: 200, size: 130, bold: true, align: 'center', valign: 'middle', text: t ?? '87%', z: 2 },
        { slide, kind: 'text', role: 'caption', x: 80, y: 330, w: 800, h: 80, size: 26, align: 'center', text: content?.subtitle ?? 'of people prefer clear slides', z: 3 },
      ];
    default:
      return [];
  }
}

/** Ops for a new slide (after `afterOrder`) with its layout's elements. */
export function newSlideOps(doc: Doc, layout: LayoutId, afterOrder: string | null, beforeOrder: string | null, content?: Parameters<typeof layoutElements>[2], notes = ''): { ops: Op[]; id: string } {
  const id = uid();
  const ops: Op[] = doc.setFields(`slide:${id}`, { order: keyBetween(afterOrder, beforeOrder), layout, notes } as Attrs);
  for (const el of layoutElements(layout, id, content)) ops.push(...doc.setFields(`el:${uid()}`, el as Attrs));
  return { ops, id };
}

/** Effective text colour of an element on a slide. */
export function textColor(el: El, theme: SlideTheme, titleSlide: boolean): string {
  if (el.color) return el.color;
  if (titleSlide && theme.titleBg) return '#ffffff';
  if (el.role === 'title' || el.role === 'number') return el.role === 'number' ? theme.accent : theme.title;
  return theme.text;
}

export function fontOf(el: El, theme: SlideTheme): string {
  return el.font ?? (el.role === 'title' || el.role === 'number' ? theme.titleFont : theme.bodyFont);
}

/** Objects for a deck from an outline (used by the AI slide generator). */
export function deckFromOutline(outline: { title: string; subtitle: string; slides: { layout: string; title: string; bullets: string[]; notes: string }[] }, theme = 'navy') {
  const objects: { key: string; fields: Record<string, unknown> }[] = [];
  const specs = [{ layout: 'title' as LayoutId, title: outline.title, subtitle: outline.subtitle, bullets: [] as string[], notes: '' }, ...outline.slides.map((s) => ({ ...s, layout: (['title-content', 'two-column', 'quote', 'section'].includes(s.layout) ? s.layout : 'title-content') as LayoutId, subtitle: s.bullets[0] ?? '' }))];
  let prev: string | null = null;
  for (const s of specs) {
    const id = uid();
    prev = keyBetween(prev, null);
    objects.push({ key: `slide:${id}`, fields: { order: prev, layout: s.layout, notes: s.notes } });
    const half = Math.ceil(s.bullets.length / 2);
    const content =
      s.layout === 'two-column'
        ? { title: s.title, bullets: s.bullets.slice(0, half), right: s.bullets.slice(half) }
        : s.layout === 'quote'
          ? { title: s.bullets[0] ? `“${s.bullets[0]}”` : s.title, subtitle: s.bullets[0] ? s.title : '' }
          : { title: s.title, subtitle: s.subtitle, bullets: s.bullets };
    for (const el of layoutElements(s.layout, id, content)) objects.push({ key: `el:${uid()}`, fields: el as Record<string, unknown> });
  }
  return { tokens: [], objects, settings: { theme, footer: '', numbers: true, logo: null } as Record<string, unknown> };
}
