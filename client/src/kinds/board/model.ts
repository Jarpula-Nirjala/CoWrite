export type ItemKind = 'pen' | 'sticky' | 'rect' | 'ellipse' | 'diamond' | 'text' | 'arrow' | 'image' | 'frame';

export interface Item {
  kind: ItemKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  color?: string;
  fill?: string | null;
  text?: string;
  size?: number;
  /** Pen points relative to (x, y): [x0, y0, x1, y1, …]. */
  pts?: number[];
  width?: number;
  highlighter?: boolean;
  /** Arrow ends: bound items or free points. */
  from?: string | null;
  to?: string | null;
  x2?: number;
  y2?: number;
  dashed?: boolean;
  src?: string | null;
}

export interface BoardSettings {
  bg: 'dots' | 'grid' | 'plain' | 'lines';
}

export const STICKY_COLORS = ['#fff3a3', '#ffd1dc', '#c8f2c2', '#cfe6ff', '#e3d4ff', '#ffd9b0'];
export const INK = ['#1b1f24', '#1f3a68', '#0a66c2', '#2e7d32', '#c62828', '#ef6c00', '#6a1b9a', '#ffffff'];

export function strokePath(pts: number[]): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M${pts[0]} ${pts[1]} l0.01 0`;
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 2; i < pts.length - 2; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2;
    const my = (pts[i + 1] + pts[i + 3]) / 2;
    d += ` Q${pts[i]} ${pts[i + 1]} ${mx} ${my}`;
  }
  return `${d} L${pts[pts.length - 2]} ${pts[pts.length - 1]}`;
}

const measure = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

/** Wraps text to lines that fit `width` at `size` px (used by both screen and export). */
export function wrapText(text: string, width: number, size: number, font = "'Segoe UI', Arial, sans-serif"): string[] {
  if (!measure) return text.split('\n');
  measure.font = `${size}px ${font}`;
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (measure.measureText(next).width > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export const center = (i: Item) => ({ x: i.x + i.w / 2, y: i.y + i.h / 2 });

/** Point where the segment from the item's centre towards (tx, ty) leaves its box. */
export function edgePoint(i: Item, tx: number, ty: number) {
  const c = center(i);
  const dx = tx - c.x;
  const dy = ty - c.y;
  if (!dx && !dy) return c;
  const k = Math.min(Math.abs(i.w / 2 / (dx || 1e-9)), Math.abs(i.h / 2 / (dy || 1e-9)));
  return { x: c.x + dx * k, y: c.y + dy * k };
}

/** End points of an arrow, following the items it connects. */
export function arrowEnds(a: Item, items: Map<string, Item>) {
  const fromItem = a.from ? items.get(a.from) : undefined;
  const toItem = a.to ? items.get(a.to) : undefined;
  let p1 = fromItem ? center(fromItem) : { x: a.x, y: a.y };
  let p2 = toItem ? center(toItem) : { x: a.x2 ?? a.x, y: a.y2 ?? a.y };
  if (fromItem) p1 = edgePoint(fromItem, p2.x, p2.y);
  if (toItem) p2 = edgePoint(toItem, p1.x, p1.y);
  return { p1, p2 };
}

export function bounds(i: Item, items: Map<string, Item>) {
  if (i.kind !== 'arrow') return { x: i.x, y: i.y, w: i.w, h: i.h };
  const { p1, p2 } = arrowEnds(i, items);
  return { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) };
}
