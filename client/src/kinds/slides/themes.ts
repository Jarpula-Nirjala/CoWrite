/** Presentation themes: background designs, decoration, fonts and colours. */

export type Deco = 'none' | 'corner' | 'wave' | 'circles' | 'grid' | 'bar' | 'frame' | 'blobs' | 'lines' | 'notebook' | 'diagonal' | 'dots'
  | 'poly' | 'circuit' | 'bars' | 'slab' | 'plus' | 'arch' | 'ledger' | 'halo' | 'mesh' | 'band' | 'stripes' | 'ribbon';

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
  // ---- Professional themes (WPS / Google Slides style)
  {
    id: 'growth',
    name: 'Growth Engine',
    bg: '#ffffff',
    titleBg: 'linear-gradient(120deg, #0b2a5b 0%, #1554b8 100%)',
    title: '#0b2a5b',
    text: '#2b3445',
    accent: '#1f6feb',
    titleFont: "'Segoe UI Semibold', 'Segoe UI', Arial, sans-serif",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'poly',
    decoColor: '#1f6feb',
    solid: 'FFFFFF',
  },
  {
    id: 'techfuture',
    name: 'Tech Future',
    bg: 'radial-gradient(circle at 80% 20%, #13306b 0%, #070d1f 65%)',
    title: '#ffffff',
    text: '#c7d4ef',
    accent: '#3ee0ff',
    titleFont: "'Segoe UI Semibold', 'Segoe UI', Arial, sans-serif",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'circuit',
    decoColor: '#3ee0ff',
    solid: '0A1430',
  },
  {
    id: 'insight',
    name: 'Data Insights',
    bg: '#f5f7fa',
    titleBg: 'linear-gradient(135deg, #0f3d3e 0%, #138a8a 100%)',
    title: '#0f3d3e',
    text: '#33424a',
    accent: '#14a3a3',
    titleFont: "'Segoe UI Semibold', 'Segoe UI', Arial, sans-serif",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'bars',
    decoColor: '#14a3a3',
    solid: 'F5F7FA',
  },
  {
    id: 'brochure',
    name: 'Corporate Brochure',
    bg: '#ffffff',
    titleBg: '#1d2433',
    title: '#1d2433',
    text: '#3a4150',
    accent: '#e2363c',
    titleFont: "'Arial Black', Arial, sans-serif",
    bodyFont: "Arial, 'Helvetica Neue', sans-serif",
    deco: 'slab',
    decoColor: '#e2363c',
    solid: 'FFFFFF',
  },
  {
    id: 'medical',
    name: 'Healthcare',
    bg: 'linear-gradient(180deg, #f2fbfa 0%, #ffffff 60%)',
    titleBg: 'linear-gradient(135deg, #0a7c86 0%, #35b6a8 100%)',
    title: '#0a5e66',
    text: '#2e4447',
    accent: '#18a59a',
    titleFont: "'Segoe UI Semibold', 'Segoe UI', Arial, sans-serif",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'plus',
    decoColor: '#18a59a',
    solid: 'F2FBFA',
  },
  {
    id: 'university',
    name: 'University',
    bg: '#fbf8f2',
    titleBg: 'linear-gradient(135deg, #5b0f1d 0%, #8c1c2e 100%)',
    title: '#6b1424',
    text: '#3b3230',
    accent: '#c59a3d',
    titleFont: "Garamond, 'Times New Roman', serif",
    bodyFont: "Georgia, 'Times New Roman', serif",
    deco: 'arch',
    decoColor: '#c59a3d',
    solid: 'FBF8F2',
  },
  {
    id: 'finance',
    name: 'Financial',
    bg: '#ffffff',
    titleBg: 'linear-gradient(135deg, #0d2b22 0%, #1d5a45 100%)',
    title: '#123b2f',
    text: '#2f3b37',
    accent: '#b8954a',
    titleFont: "Georgia, 'Times New Roman', serif",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'ledger',
    decoColor: '#b8954a',
    solid: 'FFFFFF',
  },
  {
    id: 'care',
    name: 'Warm Care',
    bg: '#fffaf4',
    titleBg: 'linear-gradient(135deg, #d9622b 0%, #f0a04b 100%)',
    title: '#a8461a',
    text: '#4a3a30',
    accent: '#e2793a',
    titleFont: "'Segoe UI Semibold', 'Segoe UI', Arial, sans-serif",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'halo',
    decoColor: '#e2793a',
    solid: 'FFFAF4',
  },
  {
    id: 'innovation',
    name: 'Pioneering Innovation',
    bg: 'linear-gradient(135deg, #f6f4ff 0%, #ffffff 70%)',
    titleBg: 'linear-gradient(125deg, #2a1b6e 0%, #5b3fd6 55%, #2fb3e8 100%)',
    title: '#2a1b6e',
    text: '#3a3656',
    accent: '#6a4cf0',
    titleFont: "'Segoe UI Semibold', 'Segoe UI', Arial, sans-serif",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'mesh',
    decoColor: '#6a4cf0',
    solid: 'F6F4FF',
  },
  {
    id: 'culture',
    name: 'Corporate Culture',
    bg: '#ffffff',
    titleBg: 'linear-gradient(135deg, #142850 0%, #27496d 100%)',
    title: '#142850',
    text: '#384152',
    accent: '#f2994a',
    titleFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'band',
    decoColor: '#f2994a',
    solid: 'FFFFFF',
  },
  {
    id: 'industry',
    name: 'Industry Dynamics',
    bg: '#f3f4f6',
    titleBg: 'linear-gradient(135deg, #20252d 0%, #3b434f 100%)',
    title: '#20252d',
    text: '#3d444f',
    accent: '#f28c28',
    titleFont: "'Arial Black', Arial, sans-serif",
    bodyFont: "Arial, 'Helvetica Neue', sans-serif",
    deco: 'stripes',
    decoColor: '#f28c28',
    solid: 'F3F4F6',
  },
  {
    id: 'kinder',
    name: 'Semester Summary',
    bg: '#fffdf6',
    titleBg: 'linear-gradient(135deg, #2f7d5b 0%, #59b37f 100%)',
    title: '#2f6b50',
    text: '#3c4a42',
    accent: '#f4b63f',
    titleFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'ribbon',
    decoColor: '#f4b63f',
    solid: 'FFFDF6',
  },
  {
    id: 'onyx',
    name: 'Onyx Executive',
    bg: '#16181d',
    title: '#ffffff',
    text: '#c9ccd3',
    accent: '#d4af6a',
    titleFont: "Garamond, 'Times New Roman', serif",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'ledger',
    decoColor: '#d4af6a',
    solid: '16181D',
  },
  {
    id: 'marketing',
    name: 'Marketing Bold',
    bg: '#ffffff',
    titleBg: 'linear-gradient(120deg, #c2185b 0%, #ff6f3c 100%)',
    title: '#b0144f',
    text: '#3a3340',
    accent: '#ff5a5f',
    titleFont: "'Segoe UI Black', 'Arial Black', sans-serif",
    bodyFont: "'Segoe UI', Arial, sans-serif",
    deco: 'poly',
    decoColor: '#ff5a5f',
    solid: 'FFFFFF',
  },
];

/** A deck's theme: one of the built-in designs, or the custom one AI Smart Create designed for it. */
export const themeById = (id: unknown, custom?: SlideTheme | null) => (id === 'custom' && custom ? custom : (SLIDE_THEMES.find((t) => t.id === id) ?? SLIDE_THEMES[0]));

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
    case 'poly':
      return isTitle
        ? `<path d="M600 0 L960 0 L960 540 L760 540 Z" fill="#ffffff" opacity=".08"/><path d="M760 0 L960 0 L960 300 Z" fill="#ffffff" opacity=".12"/><path d="M0 540 L220 540 L0 380 Z" fill="#ffffff" opacity=".07"/>`
        : `<path d="M820 0 L960 0 L960 150 Z" fill="${c}"/><path d="M700 0 L820 0 L960 150 L960 210 Z" fill="${c}" opacity=".25"/><path d="M0 540 L0 470 L90 540 Z" fill="${c}" opacity=".8"/><rect x="60" y="118" width="70" height="5" rx="2" fill="${c}"/>`;
    case 'circuit': {
      const nodes = [
        [700, 60],
        [820, 60],
        [820, 140],
        [900, 140],
        [760, 220],
      ];
      return `<g stroke="${c}" stroke-opacity=".35" fill="none" stroke-width="1.5"><path d="M640 0 V60 H820 V140 H960"/><path d="M760 0 V220 H960"/><path d="M0 470 H120 L160 430 H300"/><path d="M0 500 H200"/></g>${nodes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${c}"/>`).join('')}<circle cx="300" cy="430" r="4" fill="${c}"/><circle cx="880" cy="440" r="140" fill="${c}" opacity=".05"/>`;
    }
    case 'bars':
      return isTitle
        ? `${[0, 1, 2, 3, 4].map((i) => `<rect x="${720 + i * 44}" y="${380 - i * 50}" width="30" height="${160 + i * 50}" rx="4" fill="#ffffff" opacity="${0.08 + i * 0.03}"/>`).join('')}`
        : `<rect x="0" y="0" width="12" height="540" fill="${c}"/>${[0, 1, 2].map((i) => `<rect x="${888 + i * 18}" y="${470 - i * 22}" width="10" height="${50 + i * 22}" rx="2" fill="${c}" opacity="${0.35 + i * 0.25}"/>`).join('')}`;
    case 'slab':
      return isTitle
        ? `<path d="M960 0 L960 540 L640 540 Z" fill="${c}" opacity=".95"/><path d="M560 330 L560 540 L470 540 Z" fill="${c}"/><path d="M560 300 L560 330 L450 540 L430 540 Z" fill="#ffffff" opacity=".85"/>`
        : `<path d="M880 0 L960 0 L960 540 L820 540 Z" fill="${c}"/><rect x="60" y="118" width="54" height="6" fill="${c}"/>`;
    case 'plus':
      return `${[
        [880, 70, 1],
        [920, 130, 0.6],
        [60, 480, 0.8],
      ]
        .map(([x, y, k]) => `<path d="M${x - 8 * k} ${y - 24 * k} h${16 * k} v${16 * k} h${16 * k} v${16 * k} h${-16 * k} v${16 * k} h${-16 * k} v${-16 * k} h${-16 * k} v${-16 * k} h${16 * k} Z" fill="${isTitle ? '#ffffff' : c}" opacity="${isTitle ? 0.25 : 0.3}"/>`)
        .join('')}<circle cx="930" cy="510" r="120" fill="${isTitle ? '#ffffff' : c}" opacity=".06"/>`;
    case 'arch':
      return isTitle
        ? `<rect x="30" y="30" width="900" height="480" fill="none" stroke="${c}" stroke-width="2"/><path d="M380 30 A100 100 0 0 0 580 30" fill="none" stroke="${c}" stroke-width="2"/><circle cx="480" cy="62" r="6" fill="${c}"/>`
        : `<rect x="0" y="0" width="960" height="8" fill="${c}"/><line x1="60" y1="122" x2="900" y2="122" stroke="${c}" stroke-width="1.5"/><line x1="60" y1="510" x2="900" y2="510" stroke="${c}" stroke-opacity=".5"/>`;
    case 'ledger':
      return `<line x1="40" y1="34" x2="920" y2="34" stroke="${c}" stroke-width="1.2"/><line x1="40" y1="40" x2="920" y2="40" stroke="${c}" stroke-width=".5"/><line x1="40" y1="500" x2="920" y2="500" stroke="${c}" stroke-width=".5"/><line x1="40" y1="506" x2="920" y2="506" stroke="${c}" stroke-width="1.2"/><path d="M40 34 v12 M920 34 v12 M40 506 v-12 M920 506 v-12" stroke="${c}"/>`;
    case 'halo':
      return `<circle cx="900" cy="80" r="150" fill="none" stroke="${isTitle ? '#ffffff' : c}" stroke-opacity=".3" stroke-width="22"/><circle cx="900" cy="80" r="90" fill="${isTitle ? '#ffffff' : c}" opacity=".12"/><circle cx="40" cy="520" r="70" fill="${isTitle ? '#ffffff' : c}" opacity=".12"/>`;
    case 'mesh':
      return `<g fill="${isTitle ? '#ffffff' : c}"><path d="M960 0 L960 260 L740 0 Z" opacity=".10"/><path d="M960 120 L960 420 L800 260 Z" opacity=".08"/><path d="M740 0 L860 0 L800 130 Z" opacity=".14"/><path d="M0 540 L260 540 L120 420 Z" opacity=".07"/></g><g stroke="${isTitle ? '#ffffff' : c}" stroke-opacity=".25"><line x1="740" y1="0" x2="960" y2="260"/><line x1="800" y1="260" x2="960" y2="120"/><line x1="800" y1="130" x2="960" y2="420"/></g>`;
    case 'band':
      return isTitle
        ? `<rect x="0" y="0" width="22" height="540" fill="${c}"/><rect x="40" y="0" width="6" height="540" fill="${c}" opacity=".5"/>`
        : `<rect x="0" y="0" width="300" height="540" fill="${c}" opacity=".07"/><rect x="0" y="0" width="10" height="540" fill="${c}"/><rect x="60" y="118" width="60" height="5" fill="${c}"/>`;
    case 'stripes':
      return `${[0, 1, 2, 3].map((i) => `<path d="M${830 + i * 34} 0 L${860 + i * 34} 0 L${760 + i * 34} 540 L${730 + i * 34} 540 Z" fill="${isTitle ? '#ffffff' : c}" opacity="${0.06 + i * 0.05}"/>`).join('')}<rect x="60" y="${isTitle ? 400 : 118}" width="80" height="6" fill="${c}"/>`;
    case 'ribbon':
      return `<path d="M0 0 L180 0 L0 120 Z" fill="${c}" opacity=".9"/><path d="M180 0 L240 0 L0 160 L0 120 Z" fill="${isTitle ? '#ffffff' : c}" opacity=".35"/><circle cx="900" cy="490" r="70" fill="${c}" opacity=".25"/><circle cx="830" cy="520" r="34" fill="${isTitle ? '#ffffff' : c}" opacity=".3"/>`;
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
