import type { CSSProperties } from 'react';
import type { Attrs, Doc } from '../../../shared/crdt.ts';

/** Page setup and look of a document, stored in the CRDT so everyone sees the same page. */
export interface DocSettings {
  page: 'a4' | 'letter' | 'wide' | 'full';
  margins: 'narrow' | 'normal' | 'wide';
  paper: 'white' | 'cream' | 'recycled' | 'blueprint' | 'kraft' | 'night';
  lines: 'none' | 'ruled' | 'college' | 'grid' | 'dotted';
  marginLine: boolean;
  dateHeader: boolean;
  theme: 'classic' | 'modern' | 'elegant' | 'academic' | 'playful' | 'minimal' | 'notebook' | 'report' | 'paperback' | 'luxe' | 'mla' | 'simple' | 'executive';
  font: string;
  spacing: '1' | '1.15' | '1.5' | '2';
  header: string;
  footer: string;
  pageNumbers: boolean;
  pageGuides: boolean;
  logo: string | null;
  accent: string | null;
  brandName: string;
}

export const DEFAULT_SETTINGS: DocSettings = {
  page: 'a4',
  margins: 'normal',
  paper: 'white',
  lines: 'none',
  marginLine: false,
  dateHeader: false,
  theme: 'classic',
  font: 'serif',
  spacing: '1.15',
  header: '',
  footer: '',
  pageNumbers: false,
  pageGuides: false,
  logo: null,
  accent: null,
  brandName: '',
};

export const SETTINGS_KEY = 'settings';

export function readSettings(doc: Doc): DocSettings {
  const s = (doc.getObject(SETTINGS_KEY) ?? {}) as Partial<DocSettings>;
  return { ...DEFAULT_SETTINGS, ...s };
}

export function settingsOps(doc: Doc, patch: Partial<DocSettings>) {
  return doc.setFields(SETTINGS_KEY, patch as Attrs);
}

export const THEMES: { id: DocSettings['theme']; name: string; description: string }[] = [
  { id: 'classic', name: 'Classic', description: 'Times New Roman, navy headings' },
  { id: 'modern', name: 'Modern', description: 'Clean sans-serif with a teal accent' },
  { id: 'elegant', name: 'Elegant', description: 'Garamond with gold details' },
  { id: 'academic', name: 'Academic', description: 'Centred title, formal and sober' },
  { id: 'playful', name: 'Playful', description: 'Rounded, colourful headings' },
  { id: 'minimal', name: 'Minimal', description: 'Quiet greys and generous space' },
  { id: 'notebook', name: 'Notebook', description: 'Handwriting on ruled paper' },
  { id: 'report', name: 'Report', description: 'Bold sans headings with rules' },
  { id: 'paperback', name: 'Paperback', description: 'Book-style serif with small caps' },
  { id: 'luxe', name: 'Luxe', description: 'Large display serif and gold rules' },
  { id: 'mla', name: 'MLA', description: 'Times 12 pt, double spaced, plain headings' },
  { id: 'simple', name: 'Simple', description: 'Google-style blue headings' },
  { id: 'executive', name: 'Executive', description: 'Navy title band and crisp sans text' },
];

export const PAPERS: { id: DocSettings['paper']; name: string }[] = [
  { id: 'white', name: 'White' },
  { id: 'cream', name: 'Cream' },
  { id: 'recycled', name: 'Recycled' },
  { id: 'blueprint', name: 'Blueprint' },
  { id: 'kraft', name: 'Kraft' },
  { id: 'night', name: 'Night' },
];

const PAGE_WIDTH = { a4: 794, letter: 816, wide: 1040, full: 0 };
const MARGIN = { narrow: 40, normal: 72, wide: 112 };
const PAGE_HEIGHT = { a4: 1123, letter: 1056, wide: 1123, full: 1123 };

/** Classes and CSS variables for the paper element. */
export function paperProps(s: DocSettings): { className: string; style: CSSProperties } {
  const lineH = Number(s.spacing) * 1.6;
  return {
    className: [
      'paper-sheet',
      `theme-${s.theme}`,
      `paper-${s.paper}`,
      `lines-${s.lines}`,
      s.marginLine ? 'with-margin-line' : '',
      s.pageGuides ? 'with-page-guides' : '',
      s.page === 'full' ? 'page-full' : '',
    ]
      .filter(Boolean)
      .join(' '),
    style: {
      '--page-w': PAGE_WIDTH[s.page] ? `${PAGE_WIDTH[s.page]}px` : '100%',
      '--page-h': `${PAGE_HEIGHT[s.page]}px`,
      '--page-pad': `${MARGIN[s.margins]}px`,
      '--line-h': lineH,
      '--accent': s.accent ?? undefined,
    } as CSSProperties,
  };
}

/** @page rules so printing (and "Save as PDF") follows the page setup. */
export function printCss(s: DocSettings, title: string): string {
  const size = s.page === 'letter' ? 'letter' : 'A4';
  const m = { narrow: '12mm', normal: '20mm', wide: '30mm' }[s.margins];
  const esc = (t: string) => t.replace(/["\\]/g, '\\$&').replace(/\n/g, ' ');
  return `@page { size: ${size}; margin: ${m};
    ${s.header || title ? `@top-center { content: "${esc(s.header || '')}"; font: italic 9pt 'Times New Roman'; color: #6a707a; }` : ''}
    ${s.footer ? `@bottom-left { content: "${esc(s.footer)}"; font: italic 9pt 'Times New Roman'; color: #6a707a; }` : ''}
    ${s.pageNumbers ? `@bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9pt 'Times New Roman'; color: #6a707a; }` : ''}
  }`;
}
