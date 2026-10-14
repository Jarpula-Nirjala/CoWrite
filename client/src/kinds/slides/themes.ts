/** Presentation themes: background designs, decoration, fonts and colours. */

export type Deco = 'none' | 'corner' | 'wave' | 'circles' | 'grid' | 'bar' | 'frame' | 'blobs' | 'lines' | 'notebook' | 'diagonal' | 'dots';

export interface SlideTheme {
  id: string;
  name: string;
  /** CSS background of the slide. */
  bg: string;
  /** Background for title/section slides (bolder). */
  titleBg?: string;
  title: string;
  text: string;
  accent: string;
  titleFont: string;
  bodyFont: string;
  deco: Deco;
  decoColor: string;
  /** Solid fallback for exports. */
  solid: string;
}

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

export const SLIDE_THEMES: SlideTheme[] = [
  {
    id: 'navy',
    name: 'Classic Navy',
    bg: '#ffffff',
    titleBg: 'linear-gradient(135deg, #1f3a68 0%, #2c5490 100%)',
    title: '#1f3a68',
    text: '#2b2f36',
    accent: '#c8a24a',
    titleFont: "'Times New Roman', serif",
    bodyFont: "'Times New Roman', serif",
    deco: 'bar',
    decoColor: '#1f3a68',
    solid: 'FFFFFF',
  },
  {
    id: 'minimal',
    name: 'Minimal White',
    bg: '#fafaf8',
    title: '#111418',
    text: '#3c4043',
    accent: '#111418',
    titleFont: "Georgia, serif",
    bodyFont: "Georgia, serif",
    deco: 'lines',
    decoColor: '#d0d3d8',
    solid: 'FAFAF8',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    bg: 'radial-gradient(circle at 20% 15%, #24324f 0%, #0f1626 60%)',
    title: '#ffffff',
    text: '#c9d3e6',
    accent: '#7aa7ff',
    titleFont: "'Segoe UI', Arial, sans-serif",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'dots',
    decoColor: '#7aa7ff',
    solid: '121A2C',
  },
  {
    id: 'sunset',
    name: 'Sunset Gradient',
    bg: 'linear-gradient(135deg, #ff7e5f 0%, #feb47b 100%)',
    title: '#ffffff',
    text: '#fff8f2',
    accent: '#5a1e3c',
    titleFont: "'Trebuchet MS', sans-serif",
    bodyFont: "'Trebuchet MS', sans-serif",
    deco: 'blobs',
    decoColor: '#ffffff',
    solid: 'FF9A6B',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    bg: 'linear-gradient(180deg, #e6f4fb 0%, #ffffff 70%)',
    titleBg: 'linear-gradient(135deg, #0b5f86 0%, #1aa3c8 100%)',
    title: '#0b4f72',
    text: '#21424f',
    accent: '#1aa3c8',
    titleFont: "'Segoe UI', Arial, sans-serif",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'wave',
    decoColor: '#1aa3c8',
    solid: 'EAF5FB',
  },
  {
    id: 'forest',
    name: 'Forest',
    bg: '#f4f7f1',
    titleBg: 'linear-gradient(135deg, #1e4d2b 0%, #3d7a4a 100%)',
    title: '#1e4d2b',
    text: '#2d3a2f',
    accent: '#8bb174',
    titleFont: "Garamond, Georgia, serif",
    bodyFont: "Georgia, serif",
    deco: 'corner',
    decoColor: '#3d7a4a',
    solid: 'F4F7F1',
  },
  {
    id: 'corporate',
    name: 'Corporate Blue',
    bg: '#ffffff',
    titleBg: '#0a66c2',
    title: '#0a3d73',
    text: '#333a44',
    accent: '#0a66c2',
    titleFont: "Arial, 'Helvetica Neue', sans-serif",
    bodyFont: "Arial, 'Helvetica Neue', sans-serif",
    deco: 'diagonal',
    decoColor: '#0a66c2',
    solid: 'FFFFFF',
  },
  {
    id: 'gold',
    name: 'Elegant Gold',
    bg: '#14120f',
    title: '#e9c46a',
    text: '#e8e2d6',
    accent: '#e9c46a',
    titleFont: "Garamond, 'Times New Roman', serif",
    bodyFont: "Garamond, 'Times New Roman', serif",
    deco: 'frame',
    decoColor: '#e9c46a',
    solid: '14120F',
  },
  {
    id: 'pastel',
    name: 'Pastel',
    bg: 'linear-gradient(135deg, #fdf2f8 0%, #eef6ff 100%)',
    title: '#6b3fa0',
    text: '#4a4458',
    accent: '#f48fb1',
    titleFont: "'Trebuchet MS', sans-serif",
    bodyFont: "'Trebuchet MS', sans-serif",
    deco: 'circles',
    decoColor: '#f48fb1',
    solid: 'F7F1FB',
  },
  {
    id: 'bold',
    name: 'Bold Red',
    bg: '#ffffff',
    titleBg: '#b3261e',
    title: '#b3261e',
    text: '#222222',
    accent: '#b3261e',
    titleFont: "'Arial Black', Arial, sans-serif",
    bodyFont: "Arial, sans-serif",
    deco: 'bar',
    decoColor: '#b3261e',
    solid: 'FFFFFF',
  },
  {
    id: 'tech',
    name: 'Tech Grid',
    bg: `#0d1117 ${svgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><path d='M40 0H0V40' fill='none' stroke='%2321303f' stroke-width='1'/></svg>")}`,
    title: '#58d6a4',
    text: '#d2dae3',
    accent: '#58d6a4',
    titleFont: "'Courier New', ui-monospace, monospace",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'grid',
    decoColor: '#58d6a4',
    solid: '0D1117',
  },
  {
    id: 'notebook',
    name: 'Paper Notebook',
    bg: `#fdf8ec ${svgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='32'><path d='M0 31.5H10' stroke='%23a9c3e6' stroke-width='1'/></svg>")}`,
    title: '#2a4d8f',
    text: '#2b2b2b',
    accent: '#e06666',
    titleFont: "'Caveat', cursive",
    bodyFont: "'Caveat', cursive",
    deco: 'notebook',
    decoColor: '#e06666',
    solid: 'FDF8EC',
  },
];

export const themeById = (id: unknown) => SLIDE_THEMES.find((t) => t.id === id) ?? SLIDE_THEMES[0];

/** Decorative artwork (960×540 viewBox) drawn behind the slide content. */
export function decoSvg(deco: Deco, c: string, isTitle: boolean): string {
  switch (deco) {
    case 'bar':
      return isTitle ? '' : `<rect x="0" y="0" width="960" height="14" fill="${c}"/><rect x="40" y="508" width="120" height="4" fill="${c}"/>`;
    case 'corner':
      return `<path d="M960 0 L960 170 Q 860 60 760 0 Z" fill="${c}" opacity=".18"/><path d="M0 540 L0 400 Q 90 480 210 540 Z" fill="${c}" opacity=".14"/>`;
    case 'wave':
      return `<path d="M0 470 C 200 420 360 520 560 480 S 860 430 960 470 L960 540 L0 540 Z" fill="${c}" opacity=".22"/><path d="M0 500 C 220 470 380 540 600 505 S 860 480 960 500 L960 540 L0 540 Z" fill="${c}" opacity=".35"/>`;
    case 'circles':
      return `<circle cx="880" cy="70" r="110" fill="${c}" opacity=".18"/><circle cx="60" cy="500" r="80" fill="${c}" opacity=".14"/><circle cx="800" cy="480" r="36" fill="${c}" opacity=".2"/>`;
    case 'grid':
      return `<rect x="20" y="20" width="920" height="500" fill="none" stroke="${c}" stroke-opacity=".25" stroke-dasharray="4 6"/><circle cx="40" cy="40" r="5" fill="${c}"/><circle cx="920" cy="500" r="5" fill="${c}"/>`;
    case 'frame':
      return `<rect x="24" y="24" width="912" height="492" fill="none" stroke="${c}" stroke-width="1.5"/><rect x="34" y="34" width="892" height="472" fill="none" stroke="${c}" stroke-width=".6" opacity=".6"/>`;
    case 'blobs':
      return `<path d="M820 -40 C 960 0 1000 140 900 200 C 800 260 720 160 740 80 C 750 20 760 -60 820 -40Z" fill="${c}" opacity=".2"/><path d="M60 560 C -40 520 -20 400 70 390 C 160 380 200 470 170 520 C 150 560 110 580 60 560Z" fill="${c}" opacity=".18"/>`;
    case 'lines':
      return `<line x1="40" y1="500" x2="920" y2="500" stroke="${c}" stroke-width="1"/>`;
    case 'notebook':
      return `<line x1="70" y1="0" x2="70" y2="540" stroke="${c}" stroke-width="2" opacity=".7"/>`;
    case 'diagonal':
      return isTitle ? '' : `<path d="M760 0 L960 0 L960 120 Z" fill="${c}" opacity=".9"/><path d="M700 0 L760 0 L960 120 L960 150 Z" fill="${c}" opacity=".25"/>`;
    case 'dots':
      return Array.from({ length: 6 }, (_, i) => `<circle cx="${860 + (i % 3) * 22}" cy="${40 + Math.floor(i / 3) * 22}" r="4" fill="${c}" opacity=".7"/>`).join('');
    default:
      return '';
  }
}

export const LAYOUTS = [
  { id: 'title', name: 'Title slide' },
  { id: 'title-content', name: 'Title and content' },
  { id: 'two-column', name: 'Two columns' },
  { id: 'image-text', name: 'Image and text' },
  { id: 'section', name: 'Section header' },
  { id: 'quote', name: 'Quote' },
  { id: 'big-number', name: 'Big number' },
  { id: 'blank', name: 'Blank' },
] as const;

export type LayoutId = (typeof LAYOUTS)[number]['id'];
