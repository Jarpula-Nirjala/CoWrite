import { markdownToTokens } from '../../../shared/rich.ts';
import { keysAfter, uid } from '../kinds/objects.ts';
import type { El } from '../kinds/slides/model.ts';
import { themeById } from '../kinds/slides/themes.ts';
import type { DocSettings } from '../rich/settings.ts';
import type { GalleryItem } from './gallery.ts';

/** Template categories shown as tabs on the Templates page (WPS / Google style). */
export const TEMPLATE_TAGS = ['Featured', 'Work Report', 'Education & Training', 'Marketing & Advertising', 'Company Profile', 'Higher Education'] as const;
export const MORE_TAGS = ['Business Plan', 'HR & Administration', 'Healthcare', 'Product Launch', 'Research & Analysis', 'Technology', 'Nonprofit', 'Personal'] as const;

const img = (name: string) => `/tpl/${name}.jpg`;
const shortDate = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

// ------------------------------------------------------------ slide decks

interface DeckSpec {
  id: string;
  name: string;
  description: string;
  theme: string;
  tags: string[];
  title: string;
  subtitle: string;
  /** Cover photo, photo beside the introduction and the closing backdrop. */
  photos: [string, string, string];
  agenda: string[];
  intro: [string, string[]];
  kpis: [string, [string, string][]];
  steps: [string, [string, string][]];
  compare: [string, [string, string[]], [string, string[]]];
  close: [string, string];
}

type Part = Partial<El>;
const text = (x: number, y: number, w: number, h: number, t: string, o: Part = {}): Part => ({ kind: 'text', x, y, w, h, text: t, size: 22, align: 'left', valign: 'top', ...o });
const shape = (x: number, y: number, w: number, h: number, fill: string, o: Part = {}): Part => ({ kind: 'shape', shape: 'rect', x, y, w, h, fill, ...o });
const photo = (x: number, y: number, w: number, h: number, src: string, o: Part = {}): Part => ({ kind: 'image', x, y, w, h, src, fit: 'cover', ...o });

type SlideOut = { layout: string; notes: string; els: Part[] };
type Theme = ReturnType<typeof themeById>;

/** A second, darker brand colour for cards and steps; light title colours (dark themes) fall back to a deeper accent. */
function second(t: Theme): string {
  const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
  const tl = hex(t.title);
  if (tl && (tl[0] * 299 + tl[1] * 587 + tl[2] * 114) / 1000 < 150) return t.title;
  const a = hex(t.accent) ?? [40, 80, 160];
  return `#${a.map((v) => Math.round(v * 0.55).toString(16).padStart(2, '0')).join('')}`;
}

/** Slide designs shared by the templates and by AI Smart Create. */
const S = {
  cover: (t: Theme, title: string, subtitle: string, pic: string, notes = 'Welcome everyone and set out what this presentation will cover.'): SlideOut => ({
    layout: 'title',
    notes,
    els: [
      photo(560, 0, 400, 540, img(pic)),
      shape(552, 0, 8, 540, t.accent),
      shape(60, 150, 70, 6, t.accent),
      text(60, 170, 470, 170, title, { role: 'title', size: title.length > 40 ? 38 : 44, bold: true, valign: 'bottom' }),
      text(60, 352, 460, 70, subtitle, { role: 'subtitle', size: 20 }),
      text(60, 460, 460, 30, `Presenter name  ·  ${shortDate()}`, { role: 'caption', size: 14, opacity: 0.85 }),
    ],
  }),
  agenda: (t: Theme, items: string[], title = 'Contents', notes = 'Walk through the agenda so people know where we are going.'): SlideOut => {
    const list = items.slice(0, 5);
    const gap = list.length > 4 ? 78 : 96;
    return {
      layout: 'title-content',
      notes,
      els: [
        text(60, 40, 330, 80, title, { role: 'title', size: 40, bold: true, valign: 'middle' }),
        text(60, 140, 300, 200, `What we will cover today, in ${list.length} parts.`, { role: 'body', size: 18 }),
        ...list.flatMap((a, i) => [
          shape(420, 108 + i * gap, 76, gap - 26, t.accent, { shape: 'round', text: `0${i + 1}`, size: 26, bold: true, align: 'center', valign: 'middle', color: '#ffffff' }),
          text(516, 108 + i * gap, 390, gap - 26, a, { role: 'body', size: 22, bold: true, valign: 'middle' }),
          shape(516, 108 + i * gap + gap - 20, 380, 2, t.accent, { opacity: 0.25 }),
        ]),
      ],
    };
  },
  section: (t: Theme, n: number, title: string, line: string, notes = ''): SlideOut => ({
    layout: 'section',
    notes,
    els: [
      text(80, 110, 300, 140, String(n).padStart(2, '0'), { role: 'number', size: 110, bold: true, color: t.titleBg ? '#ffffff' : t.title, opacity: 0.35 }),
      text(80, 260, 800, 100, title, { role: 'title', size: 50, bold: true, valign: 'middle' }),
      text(80, 362, 760, 60, line, { role: 'subtitle', size: 20 }),
    ],
  }),
  bullets: (title: string, items: string[], notes = ''): SlideOut => ({
    layout: 'title-content',
    notes,
    els: [text(60, 40, 840, 80, title, { role: 'title', size: 38, bold: true, valign: 'middle' }), text(60, 145, 840, 340, items.join('\n'), { role: 'body', size: 24, list: true })],
  }),
  imageText: (title: string, items: string[], pic: string, notes = 'Tell the story behind the numbers in one or two sentences.'): SlideOut => ({
    layout: 'image-text',
    notes,
    els: [
      text(60, 40, 840, 80, title, { role: 'title', size: 38, bold: true, valign: 'middle' }),
      photo(60, 145, 400, 330, img(pic)),
      text(495, 150, 410, 320, items.join('\n'), { role: 'body', size: 21, list: true }),
    ],
  }),
  stats: (t: Theme, title: string, kpis: [string, string][], notes = 'Pause on each number and explain what it means for us.'): SlideOut => ({
    layout: 'title-content',
    notes,
    els: [
      text(60, 40, 840, 80, title, { role: 'title', size: 38, bold: true, valign: 'middle' }),
      ...kpis.slice(0, 3).flatMap(([v, c], i) => [
        shape(60 + i * 290, 160, 260, 200, i === 1 ? second(t) : t.accent, { shape: 'round', text: v, size: v.length > 6 ? 40 : 54, bold: true, align: 'center', valign: 'middle', color: '#ffffff' }),
        text(60 + i * 290, 375, 260, 90, c, { role: 'body', size: 18, align: 'center' }),
      ]),
    ],
  }),
  process: (t: Theme, title: string, steps: [string, string][], notes = 'Explain each step and who is responsible for it.'): SlideOut => {
    const list = steps.slice(0, 4);
    const span = 681;
    const stepW = list.length > 1 ? span / (list.length - 1) : 0;
    return {
      layout: 'title-content',
      notes,
      els: [
        text(60, 40, 840, 80, title, { role: 'title', size: 38, bold: true, valign: 'middle' }),
        shape(140, 250, span, 8, t.accent, { shape: 'line', stroke: t.accent, strokeW: 3 }),
        ...list.flatMap(([h, body], i) => {
          const cx = 140 + i * stepW;
          return [
            shape(cx - 34, 220, 68, 68, i % 2 ? second(t) : t.accent, { shape: 'ellipse', text: String(i + 1), size: 26, bold: true, align: 'center', valign: 'middle', color: '#ffffff' }),
            text(cx - 105, 305, 210, 40, h, { role: 'body', size: 20, bold: true, align: 'center' }),
            text(cx - 105, 345, 210, 130, body, { role: 'body', size: 15, align: 'center' }),
          ];
        }),
      ],
    };
  },
  compare: (t: Theme, title: string, left: [string, string[]], right: [string, string[]], notes = 'Compare the two options and recommend one.'): SlideOut => ({
    layout: 'two-column',
    notes,
    els: [
      text(60, 40, 840, 80, title, { role: 'title', size: 38, bold: true, valign: 'middle' }),
      shape(60, 140, 400, 56, t.accent, { shape: 'round', text: left[0], size: 22, bold: true, align: 'center', valign: 'middle', color: '#ffffff' }),
      text(72, 212, 380, 270, left[1].join('\n'), { role: 'body', size: 20, list: true }),
      shape(500, 140, 400, 56, second(t), { shape: 'round', text: right[0], size: 22, bold: true, align: 'center', valign: 'middle', color: '#ffffff' }),
      text(512, 212, 380, 270, right[1].join('\n'), { role: 'body', size: 20, list: true }),
    ],
  }),
  quote: (t: Theme, quote: string, who: string, notes = ''): SlideOut => ({
    layout: 'quote',
    notes,
    els: [
      text(90, 70, 120, 120, '“', { role: 'number', size: 140, bold: true, color: t.accent }),
      text(120, 150, 720, 210, quote, { role: 'quote', size: 34, italic: true, align: 'center', valign: 'middle' }),
      shape(450, 380, 60, 4, t.accent),
      text(120, 395, 720, 50, who, { role: 'caption', size: 20, align: 'center' }),
    ],
  }),
  closing: (title: string, line: string, pic: string, accent: string, notes = 'Thank the audience and invite questions.'): SlideOut => ({
    layout: 'title',
    notes,
    els: [
      photo(0, 0, 960, 540, img(pic)),
      shape(0, 0, 960, 540, '#0b1220', { opacity: 0.55 }),
      shape(450, 190, 60, 5, accent),
      text(80, 210, 800, 110, title, { role: 'title', size: 60, bold: true, align: 'center', valign: 'middle', color: '#ffffff' }),
      text(80, 325, 800, 50, line, { role: 'subtitle', size: 20, align: 'center', color: '#ffffffdd' }),
    ],
  }),
};

function deckObjects(themeId: string, slides: SlideOut[]) {
  const orders = keysAfter(null, slides.length);
  const objects: { key: string; fields: Record<string, unknown> }[] = [];
  slides.forEach((s, i) => {
    const sid = uid();
    objects.push({ key: `slide:${sid}`, fields: { order: orders[i], layout: s.layout, notes: s.notes } });
    s.els.forEach((el, z) => objects.push({ key: `el:${uid()}`, fields: { ...el, slide: sid, z: z + 1 } as Record<string, unknown> }));
  });
  return { tokens: [], objects, settings: { theme: themeId, footer: '', numbers: true, logo: null } as unknown as Partial<DocSettings> };
}

/** Builds a professional eight-slide deck: cover, agenda, section, story, numbers, process, comparison, close. */
function proDeck(d: DeckSpec): GalleryItem {
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    category: 'Presentations',
    kind: 'slides',
    title: d.name,
    tags: d.tags,
    cover: img(d.photos[0]),
    build() {
      const t = themeById(d.theme);
      return deckObjects(d.theme, [
        S.cover(t, d.title, d.subtitle, d.photos[0]),
        S.agenda(t, d.agenda),
        S.section(t, 1, d.agenda[0], d.intro[1][0] ?? ''),
        S.imageText(d.intro[0], d.intro[1], d.photos[1]),
        S.stats(t, d.kpis[0], d.kpis[1]),
        S.process(t, d.steps[0], d.steps[1]),
        S.compare(t, d.compare[0], d.compare[1], d.compare[2]),
        S.closing(d.close[0], d.close[1], d.photos[2], t.accent),
      ]);
    },
  };
}

export interface AiOutline {
  title: string;
  subtitle: string;
  theme: string;
  cover: string;
  slides: { layout: string; title: string; bullets: string[]; notes: string; photo: string }[];
}

const pair = (s: string): [string, string] => {
  const [a, ...b] = s.split('|');
  return [a.trim(), b.join('|').trim()];
};

/** Turns an AI Smart Create outline into designed slides. */
export function aiDeck(o: AiOutline) {
  const t = themeById(o.theme);
  let section = 0;
  const slides: SlideOut[] = [S.cover(t, o.title, o.subtitle, o.cover)];
  for (const s of o.slides) {
    const b = s.bullets.filter((x) => x.trim());
    switch (s.layout) {
      case 'agenda':
        slides.push(S.agenda(t, b, s.title || 'Contents', s.notes));
        break;
      case 'image-text':
        slides.push(S.imageText(s.title, b, s.photo, s.notes));
        break;
      case 'stats':
        slides.push(S.stats(t, s.title, b.slice(0, 3).map(pair), s.notes));
        break;
      case 'process':
        slides.push(S.process(t, s.title, b.slice(0, 4).map(pair), s.notes));
        break;
      case 'two-column': {
        const half = Math.ceil(b.length / 2);
        const l = b.slice(0, half);
        const r = b.slice(half);
        slides.push(S.compare(t, s.title, [l[0] ?? '', l.slice(1)], [r[0] ?? '', r.slice(1)], s.notes));
        break;
      }
      case 'quote':
        slides.push(S.quote(t, b[0] ? `“${b[0].replace(/^[“"]|[”"]$/g, '')}”` : s.title, b[0] ? `— ${s.title}` : '', s.notes));
        break;
      case 'section':
        slides.push(S.section(t, ++section, s.title, b[0] ?? '', s.notes));
        break;
      case 'closing':
        slides.push(S.closing(s.title, b[0] ?? '', s.photo, t.accent, s.notes));
        break;
      default:
        slides.push(S.bullets(s.title, b, s.notes));
    }
  }
  return deckObjects(o.theme, slides);
}


const DECK_SPECS: DeckSpec[] = [
  {
    id: 'pro-growth',
    name: 'Growth Engine Performance Review',
    description: 'Quarterly results, KPIs and next-quarter plan in a crisp corporate blue.',
    theme: 'growth',
    tags: ['Featured', 'Work Report', 'Business Plan'],
    title: 'Growth Engine Performance Review',
    subtitle: 'Q3 results, lessons learned and the plan for Q4',
    photos: ['office', 'finance', 'skyline'],
    agenda: ['Quarter at a glance', 'Key metrics', 'What worked and what did not', 'Plan for next quarter'],
    intro: ['Quarter at a glance', ['Revenue grew faster than plan for the third quarter running', 'Two new channels now drive a quarter of sign-ups', 'Churn is down after the onboarding redesign', 'Hiring is on track for the new growth team']],
    kpis: ['Key metrics', [['+38%', 'revenue growth, quarter on quarter'], ['4.2×', 'return on marketing spend'], ['92%', 'customer retention']]],
    steps: ['Plan for next quarter', [['Focus', 'Double down on the two best channels'], ['Build', 'Ship self-serve onboarding'], ['Expand', 'Launch in two new cities'], ['Measure', 'Weekly growth review with owners']]],
    compare: ['What worked and what did not', ['Worked', ['Referral programme', 'Partner webinars', 'Faster onboarding']], ['Needs work', ['Paid social cost per lead', 'Enterprise sales cycle', 'Reporting delays']]],
    close: ['Thank you', 'Questions and discussion'],
  },
  {
    id: 'pro-tech-integration',
    name: 'Technology Integration',
    description: 'Dark, glowing tech design for IT roadmaps and system integration plans.',
    theme: 'techfuture',
    tags: ['Featured', 'Technology', 'Work Report'],
    title: 'Technology Integration Roadmap',
    subtitle: 'Connecting our systems for a faster, safer business',
    photos: ['circuit', 'laptop', 'skyline'],
    agenda: ['Current landscape', 'Integration architecture', 'Roll-out plan', 'Risks and governance'],
    intro: ['Current landscape', ['Twelve tools with overlapping data', 'Manual exports between teams', 'Security reviews take weeks', 'An opportunity to automate end to end']],
    kpis: ['Expected impact', [['-60%', 'manual data entry'], ['3 wks', 'faster to launch a new service'], ['99.9%', 'target availability']]],
    steps: ['Roll-out plan', [['Assess', 'Map systems and data owners'], ['Connect', 'Shared APIs and single sign-on'], ['Migrate', 'Move data in safe batches'], ['Optimise', 'Monitor, tune and retire old tools']]],
    compare: ['Build or buy?', ['Build in-house', ['Full control', 'Fits our process', 'Slower to start']], ['Buy a platform', ['Faster to launch', 'Vendor support', 'Licence costs']]],
    close: ['Let’s build it together', 'it-team@company.com'],
  },
  {
    id: 'pro-data-insights',
    name: 'Data Insights Business Analysis',
    description: 'Teal analytics design for dashboards, findings and recommendations.',
    theme: 'insight',
    tags: ['Featured', 'Research & Analysis', 'Work Report'],
    title: 'Data Insights: Business Analysis',
    subtitle: 'What the numbers tell us and what we should do next',
    photos: ['finance', 'calculator', 'architecture'],
    agenda: ['Questions we asked', 'Key findings', 'Customer segments', 'Recommendations'],
    intro: ['Questions we asked', ['Which customers grow fastest?', 'Where do we lose people in the funnel?', 'Which products are most profitable?', 'What will next year look like?']],
    kpis: ['Key findings', [['27%', 'of customers create 80% of revenue'], ['2.3×', 'higher lifetime value from annual plans'], ['18 days', 'average time to first purchase']]],
    steps: ['How we analysed the data', [['Collect', 'Sales, product and support data'], ['Clean', 'Remove duplicates and fill gaps'], ['Model', 'Segments and forecasts'], ['Share', 'Dashboards for every team']]],
    compare: ['Recommendations', ['Do now', ['Promote annual plans', 'Fix the checkout step', 'Weekly KPI dashboard']], ['Next quarter', ['Loyalty programme', 'Price test for premium', 'Predict churn early']]],
    close: ['Thank you', 'Data & Analytics team'],
  },
  {
    id: 'pro-product-experience',
    name: 'Product Experience',
    description: 'Violet gradient design for product reviews, UX research and launches.',
    theme: 'innovation',
    tags: ['Featured', 'Product Launch', 'Marketing & Advertising'],
    title: 'Product Experience Review',
    subtitle: 'How customers use our product, and how we make it better',
    photos: ['apps', 'laptop', 'idea'],
    agenda: ['Who our users are', 'The journey today', 'Pain points', 'Experience roadmap'],
    intro: ['Who our users are', ['Busy professionals on mobile', 'Teams of 5 to 50 people', 'Value speed over features', 'Expect it to “just work”']],
    kpis: ['Experience scorecard', [['4.6★', 'app store rating'], ['71', 'net promoter score'], ['2 min', 'time to first success']]],
    steps: ['Experience roadmap', [['Discover', 'Interview 30 customers'], ['Design', 'Prototype the new flow'], ['Test', 'A/B test with 10% of users'], ['Launch', 'Roll out with in-app tips']]],
    compare: ['Before and after', ['Today', ['Six steps to sign up', 'Settings are hard to find', 'No offline mode']], ['Next release', ['Two-step sign-up', 'Smart search for settings', 'Works offline']]],
    close: ['Thank you', 'product@company.com'],
  },
  {
    id: 'pro-teaching-research',
    name: 'Teaching and Research',
    description: 'Academic maroon and gold for faculty reviews, theses and seminars.',
    theme: 'university',
    tags: ['Higher Education', 'Education & Training', 'Research & Analysis'],
    title: 'Teaching and Research Report',
    subtitle: 'Department of Computer Science · Academic year 2025–26',
    photos: ['lecture', 'books', 'graduates'],
    agenda: ['Teaching highlights', 'Research output', 'Student outcomes', 'Goals for next year'],
    intro: ['Teaching highlights', ['Three new elective courses launched', 'Flipped classroom in all first-year labs', 'Student feedback up from 4.1 to 4.5', 'Industry guest lectures every month']],
    kpis: ['Research output', [['42', 'papers in peer-reviewed journals'], ['₹3.8 Cr', 'in research grants'], ['9', 'patents filed']]],
    steps: ['Research process', [['Question', 'Find a problem worth solving'], ['Method', 'Design the study and get approval'], ['Results', 'Collect and analyse data'], ['Publish', 'Peer review and open access']]],
    compare: ['Goals for next year', ['Teaching', ['Project-based learning', 'More lab hours', 'Mentoring for every student']], ['Research', ['Two new research labs', 'International partnerships', 'Open-source datasets']]],
    close: ['Thank you', 'Questions and discussion'],
  },
  {
    id: 'pro-user-research',
    name: 'User Research & Product Marketing',
    description: 'Bold magenta-to-orange design for research findings and go-to-market plans.',
    theme: 'marketing',
    tags: ['Marketing & Advertising', 'Research & Analysis', 'Product Launch'],
    title: 'User Research & Product Marketing',
    subtitle: 'From customer insight to a launch plan that lands',
    photos: ['team-top', 'meeting', 'marketing'],
    agenda: ['Research goals', 'What customers told us', 'Positioning', 'Go-to-market plan'],
    intro: ['What customers told us', ['“I need it to work on my phone”', '“Setting up took too long”', '“My team loves the templates”', '“Price is fair if it saves time”']],
    kpis: ['Research in numbers', [['36', 'customer interviews'], ['1,240', 'survey responses'], ['5', 'clear personas']]],
    steps: ['Go-to-market plan', [['Tease', 'Waitlist and sneak peeks'], ['Launch', 'Press, webinar and email'], ['Grow', 'Referral rewards and partners'], ['Learn', 'Track activation weekly']]],
    compare: ['Positioning', ['For teams', ['Real-time collaboration', 'Shared templates', 'Admin controls']], ['For individuals', ['Free forever plan', 'AI writing help', 'Works offline']]],
    close: ['Let’s launch', 'marketing@company.com'],
  },
  {
    id: 'pro-oral-health',
    name: 'Oral Health Knowledge',
    description: 'Clean medical teal for health education and patient awareness talks.',
    theme: 'medical',
    tags: ['Healthcare', 'Education & Training'],
    title: 'Oral Health Knowledge',
    subtitle: 'Simple habits for healthy teeth and gums',
    photos: ['dental', 'stethoscope', 'doctors'],
    agenda: ['Why oral health matters', 'Daily care routine', 'Common problems', 'When to see a dentist'],
    intro: ['Why oral health matters', ['Gum disease is linked to heart disease and diabetes', 'Most tooth decay can be prevented', 'Healthy teeth help you eat, speak and smile', 'Habits learned early last a lifetime']],
    kpis: ['Did you know?', [['2×', 'brushing a day for two minutes'], ['6 mo', 'between dental check-ups'], ['3 mo', 'before replacing your toothbrush']]],
    steps: ['Daily care routine', [['Brush', 'Twice a day with fluoride toothpaste'], ['Floss', 'Once a day between every tooth'], ['Rinse', 'Water after meals and sweets'], ['Check', 'Visit the dentist every six months']]],
    compare: ['Healthy versus risky habits', ['Healthy', ['Water and milk', 'Fresh fruit and vegetables', 'Sugar-free gum']], ['Risky', ['Sugary drinks', 'Smoking and tobacco', 'Skipping check-ups']]],
    close: ['Smile with confidence', 'Book your check-up today'],
  },
  {
    id: 'pro-financial-statements',
    name: 'Financial Statements',
    description: 'Deep green and gold for annual accounts, budgets and investor updates.',
    theme: 'finance',
    tags: ['Work Report', 'Business Plan', 'Research & Analysis'],
    title: 'Financial Statements FY 2025–26',
    subtitle: 'Income, balance sheet and cash flow at a glance',
    photos: ['calculator', 'finance', 'skyline'],
    agenda: ['Income statement', 'Balance sheet', 'Cash flow', 'Outlook'],
    intro: ['Highlights of the year', ['Revenue up 24% to ₹48.6 Cr', 'Operating margin improved to 18%', 'Debt reduced by ₹6 Cr', 'Dividend proposed at ₹4 per share']],
    kpis: ['Key figures', [['₹48.6 Cr', 'revenue'], ['18%', 'operating margin'], ['₹9.2 Cr', 'free cash flow']]],
    steps: ['How cash moved', [['Operations', 'Cash generated by the business'], ['Investing', 'New plant and software'], ['Financing', 'Loan repayments and dividends'], ['Closing', 'Net cash at year end']]],
    compare: ['Outlook', ['Opportunities', ['Export markets', 'New product line', 'Lower input costs']], ['Risks', ['Currency swings', 'Interest rates', 'Supplier concentration']]],
    close: ['Thank you', 'Finance department'],
  },
  {
    id: 'pro-elderly-care',
    name: 'Smart Elderly Care',
    description: 'Warm, reassuring design for care services, NGOs and social projects.',
    theme: 'care',
    tags: ['Healthcare', 'Nonprofit', 'Company Profile'],
    title: 'Smart Elderly Care',
    subtitle: 'Technology and kindness for independent living',
    photos: ['elder', 'doctors', 'forest'],
    agenda: ['The challenge', 'Our care model', 'Smart home services', 'Impact so far'],
    intro: ['The challenge', ['People are living longer, often alone', 'Families live far away', 'Falls and missed medicine are common', 'Care must feel human, not clinical']],
    kpis: ['Impact so far', [['1,200', 'seniors supported'], ['38%', 'fewer hospital visits'], ['24/7', 'help at the press of a button']]],
    steps: ['Our care model', [['Assess', 'Home visit and health check'], ['Equip', 'Sensors, alerts and simple tablets'], ['Connect', 'Daily calls and family updates'], ['Respond', 'Nurses on call around the clock']]],
    compare: ['Traditional versus smart care', ['Traditional', ['Scheduled visits only', 'Paper records', 'Family kept in the dark']], ['Smart care', ['Alerts when help is needed', 'Shared digital records', 'Family app with updates']]],
    close: ['Care that never sleeps', 'hello@carefoundation.org'],
  },
  {
    id: 'pro-corporate-brochure',
    name: 'Corporate Brochure',
    description: 'Strong red and charcoal company profile with photo-led slides.',
    theme: 'brochure',
    tags: ['Featured', 'Company Profile', 'Marketing & Advertising'],
    title: 'Company Profile',
    subtitle: 'Who we are, what we do and why clients choose us',
    photos: ['architecture', 'teamwork', 'skyline'],
    agenda: ['About us', 'Services', 'Our numbers', 'Clients and partners'],
    intro: ['About us', ['Founded in 2012 in Hyderabad', 'A team of 240 specialists', 'Offices in four countries', 'Trusted by leading brands']],
    kpis: ['Our numbers', [['12 yrs', 'of experience'], ['500+', 'projects delivered'], ['98%', 'client satisfaction']]],
    steps: ['How we work', [['Listen', 'Understand your goals'], ['Plan', 'A clear proposal and budget'], ['Deliver', 'Agile teams and weekly demos'], ['Support', 'We stay with you after launch']]],
    compare: ['Services', ['Consulting', ['Strategy', 'Process design', 'Change management']], ['Delivery', ['Software', 'Data & AI', 'Managed services']]],
    close: ['Let’s work together', 'www.company.com · +91 00000 00000'],
  },
  {
    id: 'pro-kindergarten',
    name: 'Kindergarten Semester Summary',
    description: 'Fresh green and sunny yellow for school reports and parent meetings.',
    theme: 'kinder',
    tags: ['Education & Training'],
    title: 'Semester Summary',
    subtitle: 'Sunflower Class · Kindergarten · Term 1',
    photos: ['classroom', 'books', 'forest'],
    agenda: ['Our class this term', 'Learning highlights', 'Events and trips', 'Next term'],
    intro: ['Our class this term', ['24 curious learners', 'New reading corner and garden', 'Daily outdoor play', 'Weekly show-and-tell']],
    kpis: ['Term in numbers', [['120', 'books read together'], ['8', 'class projects'], ['96%', 'attendance']]],
    steps: ['Learning highlights', [['Language', 'Phonics and storytelling'], ['Numbers', 'Counting to 100 with games'], ['Science', 'Growing our own plants'], ['Art', 'Painting and clay modelling']]],
    compare: ['Events and next term', ['This term', ['Sports day', 'Farm visit', 'Diwali celebration']], ['Next term', ['Science fair', 'Museum trip', 'Annual day show']]],
    close: ['Thank you, parents!', 'Class teacher · school@email.com'],
  },
  {
    id: 'pro-sales',
    name: 'Dream Forward Sales Report',
    description: 'Navy and orange sales review with pipeline, wins and targets.',
    theme: 'culture',
    tags: ['Work Report', 'Marketing & Advertising'],
    title: 'Dream Forward: Sales Report',
    subtitle: 'Annual sales review and targets for the year ahead',
    photos: ['meeting', 'finance', 'skyline'],
    agenda: ['Year in review', 'Top wins', 'Pipeline', 'Targets'],
    intro: ['Year in review', ['Beat the annual target by 12%', 'Three new enterprise clients', 'Average deal size up 20%', 'Sales cycle shortened by 9 days']],
    kpis: ['Sales in numbers', [['₹22 Cr', 'total bookings'], ['112%', 'of target achieved'], ['31%', 'win rate']]],
    steps: ['Sales process', [['Prospect', 'Find the right accounts'], ['Qualify', 'Budget, need and timing'], ['Propose', 'Tailored demo and quote'], ['Close', 'Contract and smooth handover']]],
    compare: ['Targets for next year', ['Grow', ['₹30 Cr bookings', 'Two new regions', 'Partner channel']], ['Improve', ['Faster quotes', 'Better CRM hygiene', 'Coaching for new reps']]],
    close: ['Onwards and upwards', 'Sales team'],
  },
  {
    id: 'pro-tech-future',
    name: 'Tech Future',
    description: 'Futuristic dark design for AI, innovation and technology trend talks.',
    theme: 'techfuture',
    tags: ['Technology', 'Research & Analysis'],
    title: 'The Future of Technology',
    subtitle: 'Five trends that will shape the next decade',
    photos: ['circuit', 'apps', 'mountain'],
    agenda: ['Artificial intelligence', 'Edge and cloud', 'Security', 'What it means for us'],
    intro: ['Artificial intelligence everywhere', ['Assistants in every app', 'AI that sees, hears and writes', 'New jobs and new skills', 'Responsible use matters more than ever']],
    kpis: ['By the numbers', [['80%', 'of apps will include AI features'], ['75 bn', 'connected devices'], ['3×', 'growth in edge computing']]],
    steps: ['How to prepare', [['Learn', 'Build AI literacy in every team'], ['Pilot', 'Start small with clear goals'], ['Secure', 'Protect data by design'], ['Scale', 'Roll out what works']]],
    compare: ['Opportunities and challenges', ['Opportunities', ['New products', 'Higher productivity', 'Better decisions']], ['Challenges', ['Privacy', 'Skills gap', 'Energy use']]],
    close: ['The future is now', 'Thank you'],
  },
  {
    id: 'pro-graduation',
    name: 'University Graduation',
    description: 'Formal maroon and gold for convocation, alumni and thesis defence.',
    theme: 'university',
    tags: ['Higher Education', 'Education & Training'],
    title: 'Graduation Ceremony 2026',
    subtitle: 'Celebrating the achievements of our graduating class',
    photos: ['graduates', 'lecture', 'graduates'],
    agenda: ['Welcome', 'Class of 2026', 'Awards and honours', 'Looking ahead'],
    intro: ['Class of 2026', ['1,150 graduates across 14 programmes', 'Students from 18 states and 6 countries', 'Over 300 internships completed', 'A record number of startups founded']],
    kpis: ['Achievements', [['92%', 'placed or in higher studies'], ['64', 'gold medals'], ['21', 'student startups']]],
    steps: ['The journey', [['Admission', 'A new beginning'], ['Learning', 'Classes, labs and projects'], ['Growing', 'Clubs, sports and friendships'], ['Graduating', 'Ready for the world']]],
    compare: ['Looking ahead', ['Careers', ['Industry roles', 'Public service', 'Entrepreneurship']], ['Further study', ['Masters and PhD', 'Research fellowships', 'Study abroad']]],
    close: ['Congratulations, graduates!', 'Office of the Registrar'],
  },
  {
    id: 'pro-pioneering',
    name: 'Pioneering Innovation',
    description: 'Gradient mesh design for innovation strategy and R&D showcases.',
    theme: 'innovation',
    tags: ['Featured', 'Technology', 'Business Plan'],
    title: 'Pioneering Innovation',
    subtitle: 'Our innovation strategy for 2026 and beyond',
    photos: ['idea', 'teamwork', 'mountain'],
    agenda: ['Why innovate now', 'Innovation portfolio', 'How ideas become products', 'Investment and returns'],
    intro: ['Why innovate now', ['Customer needs are changing fast', 'New competitors move quickly', 'Technology costs keep falling', 'Our people have great ideas']],
    kpis: ['Innovation portfolio', [['36', 'ideas in the pipeline'], ['7', 'pilots running'], ['3', 'products launched this year']]],
    steps: ['From idea to product', [['Spark', 'Open idea challenges'], ['Shape', 'Two-week design sprints'], ['Pilot', 'Test with real customers'], ['Scale', 'Fund the winners']]],
    compare: ['Investment and returns', ['Investment', ['5% of revenue in R&D', 'Innovation lab', 'University partnerships']], ['Returns', ['New revenue streams', 'Faster time to market', 'Talent attraction']]],
    close: ['Let’s build what’s next', 'innovation@company.com'],
  },
  {
    id: 'pro-promotion-album',
    name: 'Corporate Promotion Album',
    description: 'Photo-led brochure slides to promote your company, people and culture.',
    theme: 'brochure',
    tags: ['Company Profile', 'Marketing & Advertising'],
    title: 'Corporate Promotion Album',
    subtitle: 'Our people, our places, our work',
    photos: ['skyline', 'office', 'architecture'],
    agenda: ['Our story', 'Our people', 'Our work', 'Our future'],
    intro: ['Our story', ['Started by three friends in a garage', 'Grown to a team of 400', 'Serving customers in 30 countries', 'Still guided by the same values']],
    kpis: ['A year in pictures', [['14', 'new offices opened'], ['60k', 'hours of volunteering'], ['25', 'industry awards']]],
    steps: ['Our values', [['Customers first', 'Every decision starts with them'], ['Ownership', 'We do what we say'], ['Curiosity', 'We keep learning'], ['Together', 'We win as one team']]],
    compare: ['Life at the company', ['Work', ['Flexible hours', 'Learning budget', 'Modern offices']], ['Life', ['Health cover for family', 'Clubs and sports', 'Volunteer days']]],
    close: ['Join our story', 'careers.company.com'],
  },
  {
    id: 'pro-industry',
    name: 'Industry Dynamics',
    description: 'Industrial charcoal and orange for market reviews and manufacturing.',
    theme: 'industry',
    tags: ['Research & Analysis', 'Work Report'],
    title: 'Industry Dynamics 2026',
    subtitle: 'Market trends, competitors and opportunities',
    photos: ['factory', 'finance', 'skyline'],
    agenda: ['Market overview', 'Key trends', 'Competitive landscape', 'Opportunities'],
    intro: ['Market overview', ['Market growing 11% a year', 'Shift from imports to local production', 'Automation lowering unit costs', 'New rules on emissions and safety']],
    kpis: ['Market in numbers', [['₹1.2 L Cr', 'market size'], ['11%', 'annual growth'], ['42%', 'share held by top 5 players']]],
    steps: ['Value chain', [['Raw materials', 'Steel, polymers and chips'], ['Production', 'Plants and automation'], ['Distribution', 'Dealers and online'], ['Service', 'Maintenance and parts']]],
    compare: ['Competitive landscape', ['Strengths', ['Cost leadership', 'Strong dealer network', 'Fast delivery']], ['Threats', ['New low-cost entrants', 'Raw material prices', 'Talent shortage']]],
    close: ['Thank you', 'Strategy team'],
  },
  {
    id: 'pro-culture',
    name: 'Corporate Culture',
    description: 'Navy and warm orange for values, onboarding and HR presentations.',
    theme: 'culture',
    tags: ['HR & Administration', 'Company Profile'],
    title: 'Our Corporate Culture',
    subtitle: 'The values and habits that make us who we are',
    photos: ['teamwork', 'office', 'mountain'],
    agenda: ['Mission and vision', 'Our values', 'How we work', 'Growing together'],
    intro: ['Mission and vision', ['Mission: make work simpler for everyone', 'Vision: the most trusted tools in India', 'We hire for attitude and train for skill', 'Diversity makes us stronger']],
    kpis: ['Culture in numbers', [['4.7★', 'employee rating'], ['48%', 'women in leadership'], ['90%', 'would recommend us to a friend']]],
    steps: ['Our values', [['Respect', 'Listen first, disagree kindly'], ['Integrity', 'Do the right thing'], ['Excellence', 'Raise the bar together'], ['Joy', 'Celebrate the wins']]],
    compare: ['How we work', ['We do', ['Share context openly', 'Give feedback often', 'Own our mistakes']], ['We avoid', ['Blame', 'Silos', 'Meetings without agendas']]],
    close: ['Welcome to the team', 'people@company.com'],
  },
  {
    id: 'pro-tech-brochure',
    name: 'Technology Product Brochure',
    description: 'Sleek executive dark-and-gold slides for a flagship product.',
    theme: 'onyx',
    tags: ['Product Launch', 'Technology', 'Marketing & Advertising'],
    title: 'Introducing Nova',
    subtitle: 'The smart workspace for modern teams',
    photos: ['laptop', 'apps', 'architecture'],
    agenda: ['Meet Nova', 'Key features', 'Plans and pricing', 'Get started'],
    intro: ['Meet Nova', ['Docs, chat and tasks in one place', 'AI that writes, sums up and translates', 'Secure by design', 'Works on every device']],
    kpis: ['Why teams switch', [['2 hrs', 'saved per person each week'], ['5 min', 'to set up'], ['99.99%', 'uptime']]],
    steps: ['Get started', [['Sign up', 'Free for small teams'], ['Invite', 'Bring your team in one click'], ['Import', 'Move files from other tools'], ['Grow', 'Upgrade when you need more']]],
    compare: ['Plans and pricing', ['Starter', ['Free forever', 'Up to 10 people', 'Core features']], ['Business', ['₹199 per person a month', 'Admin and security', 'Priority support']]],
    close: ['Start your free trial', 'nova.example.com'],
  },
  {
    id: 'pro-business-plan',
    name: 'Startup Business Plan',
    description: 'Investor-ready plan: problem, market, model, traction and the ask.',
    theme: 'growth',
    tags: ['Business Plan', 'Featured'],
    title: 'Business Plan',
    subtitle: 'Seed round · Investor presentation',
    photos: ['idea', 'meeting', 'skyline'],
    agenda: ['Problem and solution', 'Market', 'Business model', 'The ask'],
    intro: ['Problem and solution', ['Small shops lose 20% of sales to stock-outs', 'Our app predicts what to reorder', 'Works with any phone, in any language', 'Pays for itself in the first month']],
    kpis: ['Traction', [['3,400', 'shops using the app'], ['42%', 'month-on-month growth'], ['₹18 L', 'monthly recurring revenue']]],
    steps: ['Milestones', [['Now', 'Product-market fit in 2 cities'], ['6 months', 'Expand to 10 cities'], ['12 months', 'Launch supplier marketplace'], ['24 months', 'Break even']]],
    compare: ['Business model', ['Revenue', ['₹499 monthly subscription', 'Marketplace commission', 'Premium analytics']], ['Use of funds', ['45% product', '35% growth', '20% operations']]],
    close: ['Raising ₹3 Cr', 'founder@startup.com'],
  },
  {
    id: 'pro-hr-onboarding',
    name: 'HR Onboarding',
    description: 'A welcoming first-week guide for new employees.',
    theme: 'care',
    tags: ['HR & Administration'],
    title: 'Welcome Aboard',
    subtitle: 'Your first week at the company',
    photos: ['team-top', 'office', 'forest'],
    agenda: ['Who we are', 'Your first week', 'Policies and benefits', 'Who to ask'],
    intro: ['Who we are', ['A team of 400 across 5 cities', 'We build tools people love', 'Open, friendly and fast-moving', 'You were hired because you are great']],
    kpis: ['Good to know', [['24', 'days of paid leave'], ['₹50k', 'learning budget a year'], ['100%', 'health cover for family']]],
    steps: ['Your first week', [['Day 1', 'Laptop, accounts and lunch with the team'], ['Day 2', 'Meet your buddy and manager'], ['Day 3–4', 'Product training'], ['Day 5', 'Your first small task']]],
    compare: ['Policies and benefits', ['Policies', ['Hybrid work', 'Code of conduct', 'Leave and holidays']], ['Benefits', ['Health insurance', 'Wellness allowance', 'Employee stock options']]],
    close: ['We’re glad you’re here', 'people@company.com'],
  },
  {
    id: 'pro-hospital',
    name: 'Hospital Annual Review',
    description: 'Healthcare performance review with patient outcomes and services.',
    theme: 'medical',
    tags: ['Healthcare', 'Work Report'],
    title: 'Hospital Annual Review',
    subtitle: 'Patient care, outcomes and plans for the year ahead',
    photos: ['doctors', 'stethoscope', 'architecture'],
    agenda: ['Year highlights', 'Patient outcomes', 'New services', 'Plans ahead'],
    intro: ['Year highlights', ['New cardiac care wing opened', 'Telemedicine for rural patients', 'Waiting times cut by a third', 'Two national quality awards']],
    kpis: ['Patient outcomes', [['86k', 'patients treated'], ['4.8★', 'patient satisfaction'], ['-32%', 'average waiting time']]],
    steps: ['Patient journey', [['Book', 'Online, phone or walk-in'], ['Consult', 'Specialist within 48 hours'], ['Treat', 'Coordinated care team'], ['Follow up', 'Tele-consults at home']]],
    compare: ['Plans ahead', ['Services', ['Cancer care centre', 'Paediatric ICU', 'Mobile clinics']], ['People', ['Hire 120 nurses', 'Training academy', 'Staff wellbeing']]],
    close: ['Caring for every life', 'www.hospital.org'],
  },
];

// ------------------------------------------------------------- documents

function proDoc(id: string, name: string, description: string, tags: string[], title: string, settings: Partial<DocSettings>, md: () => string, cover?: string): GalleryItem {
  return {
    id,
    name,
    description,
    category: 'Documents',
    kind: 'doc',
    title,
    settings,
    tags,
    cover,
    get md() {
      return md();
    },
    build: () => ({ tokens: markdownToTokens(md()), settings }),
  };
}

const DOC_SPECS: GalleryItem[] = [
  proDoc('gdoc-paperback', 'Essay · Paperback', 'Book-style essay with a large serif title and small-caps headings.', ['Featured', 'Education & Training', 'Personal'], 'Essay', { theme: 'paperback', font: 'garamond', spacing: '1.5', margins: 'wide' }, () =>
    [
      '# The Title of Your Essay',
      '*A subtitle that sets out your argument in one line*',
      `Your Name · ${shortDate()}`,
      '## Introduction',
      'Open with a question, a striking fact or a short story that draws the reader in. End the paragraph with your thesis: the one claim the rest of the essay will prove.',
      '## First argument',
      'State the point clearly in the first sentence. Support it with evidence, a quotation or an example, and explain why the evidence matters.',
      '> “A well-chosen quotation can carry the weight of a whole paragraph.”',
      '## Second argument',
      'Build on the first argument. Show how the two ideas connect and why together they make your thesis convincing.',
      '## Counter-argument',
      'Acknowledge the strongest objection to your view, then explain why your argument still holds.',
      '## Conclusion',
      'Return to your thesis in new words, sum up what the reader has learned and leave them with something to think about.',
    ].join('\n'),
  ),
  proDoc('gdoc-report-simple', 'Report · Simple', 'Clean Google-style report with blue headings and a summary table.', ['Featured', 'Work Report'], 'Report', { theme: 'simple', font: 'sans', accent: '#1a73e8' }, () =>
    [
      `${shortDate()}`,
      '# Report Title',
      '*Prepared for: Team or client · Prepared by: Your Name*',
      '## Overview',
      'Summarise the purpose of the report and its main finding in two or three sentences.',
      '## Background',
      'What led to this report? Give the reader just enough context to understand the findings.',
      '## Findings',
      '| Area | Result | Status |',
      '| --- | --- | --- |',
      '| Sales | 12% above target | On track |',
      '| Customer support | Response time 4 h | Needs work |',
      '| Hiring | 8 of 10 roles filled | On track |',
      '## Recommendations',
      '1. The most important action, with an owner',
      '2. The next action',
      '3. A longer-term change to consider',
      '## Next steps',
      '- [ ] Share the report with stakeholders',
      '- [ ] Agree owners and dates',
    ].join('\n'),
  ),
  proDoc('gdoc-report-luxe', 'Report · Luxe', 'Elegant cover photo, display serif title and gold section labels.', ['Featured', 'Company Profile', 'Business Plan'], 'Annual report', { theme: 'luxe', font: 'georgia', accent: '#b08d57', margins: 'wide' }, () =>
    [
      `![Cover](${img('architecture')})`,
      '# Annual Report 2026',
      '*Building something that lasts*',
      '## Letter from the founder',
      'This year we grew in the ways that matter most: in the trust of our customers, in the strength of our team and in the quality of our work. Here is what we achieved, and where we are going next.',
      '## The year in numbers',
      '| Measure | 2025 | 2026 |',
      '| --- | --- | --- |',
      '| Revenue | ₹31 Cr | ₹42 Cr |',
      '| Customers | 1,800 | 2,650 |',
      '| Team | 160 | 210 |',
      '## Highlights',
      '- Opened our flagship studio in Bengaluru',
      '- Launched two new product lines',
      '- Became carbon neutral across all offices',
      '## Looking ahead',
      'Our priorities for next year are simple: delight our customers, grow responsibly and invest in our people.',
    ].join('\n'),
    img('architecture'),
  ),
  proDoc('gdoc-mla', 'Report · MLA', 'MLA-formatted paper: Times 12 pt, double spaced, heading block and works cited.', ['Higher Education', 'Education & Training'], 'MLA paper', { theme: 'mla', font: 'serif', spacing: '2', margins: 'normal', header: 'Lastname 1' }, () =>
    [
      'Your Name',
      'Professor Name',
      'Course Name and Number',
      shortDate(),
      '# Title of Your Paper',
      'Begin your introduction here. In MLA style, every paragraph is indented half an inch and the whole paper is double spaced in a 12-point serif font. Your introduction should end with a clear thesis statement.',
      'Each body paragraph opens with a topic sentence, presents evidence with an in-text citation (Author 23), and explains how that evidence supports your thesis.',
      'Your conclusion restates the thesis in fresh words and explains why your argument matters beyond this paper.',
      '{pagebreak}',
      '->Works Cited<-',
      'Lastname, Firstname. *Title of Book*. Publisher, 2024.',
      'Lastname, Firstname. “Title of Article.” *Journal Name*, vol. 12, no. 3, 2023, pp. 45–67.',
    ].join('\n'),
  ),
  proDoc('gdoc-book-report', 'Book report', 'Structured book report with summary, characters, themes and rating.', ['Education & Training', 'Personal'], 'Book report', { theme: 'paperback', font: 'georgia', accent: '#7a3e2b' }, () =>
    [
      '# Book Report',
      `*Title of the book* by Author Name · Reported by Your Name · ${shortDate()}`,
      `![Books](${img('books')})`,
      '## About the book',
      '| Genre | Pages | Published |',
      '| --- | --- | --- |',
      '| Fiction | 320 | 2019 |',
      '## Summary',
      'Describe the story in your own words: the setting, the main conflict and how it is resolved. Avoid giving away the ending if your readers have not read it.',
      '## Main characters',
      '- **Character one:** who they are and what they want',
      '- **Character two:** how they change through the story',
      '## Themes',
      'What big ideas does the book explore? Friendship, courage, identity? Give one example from the text for each.',
      '## My opinion',
      'What did you enjoy? What would you change? Who would you recommend it to?',
      '**Rating:** ★★★★☆',
    ].join('\n'),
    img('books'),
  ),
  proDoc('gdoc-class-notes', 'Class notes', 'Tidy lecture notes with key terms, a summary and review questions.', ['Education & Training', 'Higher Education', 'Personal'], 'Class notes', { theme: 'simple', font: 'sans', accent: '#0b8043' }, () =>
    [
      `# Class Notes`,
      `**Course:** Subject 101 · **Topic:** Lecture title · **Date:** ${shortDate()}`,
      '> [!info] Learning objective: by the end of this class I can explain … and apply it to …',
      '## Key terms',
      '| Term | Meaning |',
      '| --- | --- |',
      '| Term one | A short definition in your own words |',
      '| Term two | A short definition |',
      '## Notes',
      '- Main idea one',
      '  - Supporting detail or example',
      '- Main idea two',
      '## Summary',
      'Three sentences that capture what this class was about.',
      '## Questions to review',
      '- [ ] What is the difference between … and …?',
      '- [ ] Solve one practice problem',
    ].join('\n'),
  ),
  proDoc('gdoc-lab-report', 'Science lab report', 'Aim, method, results table and conclusion for practical work.', ['Education & Training', 'Higher Education', 'Research & Analysis'], 'Lab report', { theme: 'academic', font: 'serif', accent: '#1f3a68' }, () =>
    [
      '# Lab Report: Title of the Experiment',
      `Your Name · Lab partner · ${shortDate()}`,
      '## Aim',
      'What question does this experiment answer?',
      '## Hypothesis',
      'If … then … because …',
      '## Materials',
      '- Item one\n- Item two',
      '## Method',
      '1. First step\n2. Second step\n3. Record the measurement',
      '## Results',
      '| Trial | Measurement | Notes |',
      '| --- | --- | --- |',
      '| 1 |  |  |',
      '| 2 |  |  |',
      '## Discussion',
      'Explain the results, sources of error and how the experiment could be improved.',
      '## Conclusion',
      'Was the hypothesis supported?',
    ].join('\n'),
  ),
  proDoc('gdoc-business-letter', 'Business letter', 'Executive letterhead with a navy title band.', ['Company Profile', 'HR & Administration'], 'Business letter', { theme: 'executive', font: 'sans', accent: '#d4a64a', margins: 'wide' }, () =>
    [
      '# Company Name',
      '123 Business Road, City 500001 · +91 00000 00000 · hello@company.com',
      shortDate(),
      'Recipient Name\nTitle\nCompany\nAddress',
      'Dear Recipient Name,',
      'Open with the purpose of your letter in one sentence. Then give the details the reader needs: what, when, why and what you would like them to do.',
      'Close with a clear next step and a thank-you.',
      'Sincerely,',
      '{signature}',
      'Your Name\nYour Title',
    ].join('\n'),
  ),
  proDoc('gdoc-project-plan', 'Project plan', 'Executive project plan with scope, milestones, RACI and risks.', ['Business Plan', 'Work Report', 'Featured'], 'Project plan', { theme: 'executive', font: 'sans', accent: '#d4a64a', pageNumbers: true }, () =>
    [
      '# Project Plan',
      `**Project:** Name · **Owner:** Your Name · **Last updated:** ${shortDate()}`,
      '## Objective',
      'One sentence describing the outcome this project will deliver and why it matters.',
      '## Scope',
      '| In scope | Out of scope |',
      '| --- | --- |',
      '| Item | Item |',
      '## Milestones',
      '| Milestone | Date | Owner | Status |',
      '| --- | --- | --- | --- |',
      '| Kick-off |  |  | Done |',
      '| Design complete |  |  | In progress |',
      '| Launch |  |  | Not started |',
      '## Roles (RACI)',
      '| Task | Responsible | Accountable | Consulted | Informed |',
      '| --- | --- | --- | --- | --- |',
      '|  |  |  |  |  |',
      '## Risks',
      '- **Risk:** … **Impact:** High **Mitigation:** …',
    ].join('\n'),
  ),
  proDoc('gdoc-newsletter', 'Newsletter', 'Company newsletter with a cover photo and short stories.', ['Marketing & Advertising', 'HR & Administration', 'Nonprofit'], 'Newsletter', { theme: 'luxe', font: 'georgia', accent: '#c2185b' }, () =>
    [
      `![Cover](${img('teamwork')})`,
      '# The Monthly Brief',
      `*Issue 12 · ${shortDate()}*`,
      '## In this issue',
      '- Big news from the product team\n- Meet our new colleagues\n- Dates for your calendar',
      '## Big news',
      'Two or three short paragraphs with the most important story of the month.',
      '## People',
      'Welcome the new joiners and celebrate work anniversaries.',
      '## Dates for your calendar',
      '| Date | Event |',
      '| --- | --- |',
      '| 15th | Town hall |',
      '| 22nd | Volunteer day |',
    ].join('\n'),
    img('teamwork'),
  ),
];

export const PRO_DECKS: GalleryItem[] = DECK_SPECS.map(proDeck);
export const PRO_DOCS: GalleryItem[] = DOC_SPECS;
