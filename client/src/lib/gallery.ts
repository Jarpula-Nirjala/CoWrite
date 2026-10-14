import { markdownToTokens } from '../../../shared/rich.ts';
import type { DocKind } from '../api.ts';
import { keysAfter, uid } from '../kinds/objects.ts';
import { layoutElements, type El } from '../kinds/slides/model.ts';
import type { LayoutId } from '../kinds/slides/themes.ts';
import type { DocSettings } from '../rich/settings.ts';
import type { InitialContent } from './templates.ts';

export type Category = 'Documents' | 'Notes & journals' | 'Presentations' | 'Whiteboards' | 'Boards' | 'Spreadsheets';

export interface GalleryItem {
  id: string;
  name: string;
  description: string;
  category: Category;
  kind: DocKind;
  title: string;
  /** Doc templates: the page look, used for both the preview and the document. */
  settings?: Partial<DocSettings>;
  /** Doc templates: Markdown body (with CoWrite extensions). */
  md?: string;
  build(): InitialContent;
}

const today = () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

function doc(id: string, name: string, description: string, category: Category, title: string, settings: Partial<DocSettings>, md: () => string): GalleryItem {
  return {
    id,
    name,
    description,
    category,
    kind: 'doc',
    title,
    settings,
    get md() {
      return md();
    },
    build: () => ({ tokens: markdownToTokens(md()), settings }),
  };
}

// --------------------------------------------------------------- documents

const DOCS: GalleryItem[] = [
  doc('blank', 'Blank document', 'A clean A4 page.', 'Documents', 'Untitled document', {}, () => ''),
  doc('meeting', 'Meeting notes', 'Agenda, decisions and owners with due dates.', 'Documents', `Meeting notes – ${shortDate()}`, { theme: 'modern', font: 'sans', accent: '#0a66c2' }, () =>
    [
      '# Meeting notes',
      `**Date:** ${shortDate()}  ·  **Facilitator:**  ·  **Note-taker:**`,
      '> [!info] Goal of this meeting: agree on the next milestone and who owns what.',
      '## Attendees',
      '- ',
      '## Agenda',
      '1. Updates since last time (10 min)',
      '2. Open questions (15 min)',
      '3. Decisions and next steps (5 min)',
      '## Discussion',
      '- ',
      '## Decisions',
      '| Decision | Why | Owner |',
      '| --- | --- | --- |',
      '|  |  |  |',
      '## Action items',
      '- [ ] Type @ to assign someone, and add a due date',
      '- [ ] ',
    ].join('\n'),
  ),
  doc('proposal', 'Project proposal', 'Executive summary, plan, budget and sign-off.', 'Documents', 'Project proposal', { theme: 'report', header: 'Project proposal', pageNumbers: true, accent: '#1f3a68' }, () =>
    [
      '->Project proposal<-',
      `->${shortDate()} · Prepared by Your Name<-`,
      '{toc}',
      '{pagebreak}',
      '## Executive summary',
      'One paragraph that a busy reader can act on: what we want to do, why now, and what it costs.',
      '> [!tip] Keep this section under 120 words. Lead with the outcome.',
      '## The problem',
      'Who is affected, how often, and what it costs them today.',
      '## Proposed solution',
      'How the solution works, and why it is better than the alternatives.',
      '## Goals and success metrics',
      '| Goal | Metric | Target |',
      '| --- | --- | --- |',
      '| Faster onboarding | Time to first value | under 5 minutes |',
      '| Happier users | Satisfaction score | 4.5 / 5 |',
      '## Timeline',
      '```mermaid',
      'gantt',
      '  dateFormat YYYY-MM-DD',
      '  section Plan',
      '  Discovery :a1, 2026-11-01, 14d',
      '  Build     :a2, after a1, 30d',
      '  Launch    :a3, after a2, 7d',
      '```',
      '## Budget',
      '| Item | Cost |',
      '| --- | --- |',
      '| People |  |',
      '| Tools |  |',
      '| **Total** |  |',
      '## Risks and mitigations',
      '- **Risk:** … **Mitigation:** …',
      '## Approval',
      '{signature}',
    ].join('\n'),
  ),
  doc('resume', 'Resume', 'Elegant one-page CV with clear sections.', 'Documents', 'Resume', { theme: 'elegant', margins: 'narrow', accent: '#1f3a68' }, () =>
    [
      '-># Your Name<-',
      '->Software Engineer · City, Country · you@email.com · linkedin.com/in/you · github.com/you<-',
      '---',
      '## Summary',
      'Engineer who ships reliable products end to end. Strong in TypeScript, distributed systems and clear writing.',
      '## Experience',
      '### Software Engineer — Company',
      '*Month Year – Present*',
      '- Built a feature used by 20,000 people a week, cutting support tickets by 30%',
      '- Led the migration of … to …, saving ₹X per month',
      '### Intern — Company',
      '*Month Year – Month Year*',
      '- ',
      '## Projects',
      '### CoWrite — real-time collaborative editor',
      '- Wrote a CRDT from scratch; React, WebSockets and Node; deployed on Render',
      '## Education',
      '### B.Tech, Computer Science — Indian Institute of Information Technology, Surat',
      '*Year – Year* · CGPA x.x',
      '## Skills',
      'TypeScript · React · Node.js · PostgreSQL · Python · Git · Docker',
    ].join('\n'),
  ),
  doc('cover-letter', 'Cover letter', 'A formal letter with a signature block.', 'Documents', 'Cover letter', { theme: 'classic', margins: 'wide' }, () =>
    [
      'Your Name',
      'City · you@email.com · +91 00000 00000',
      shortDate(),
      'Hiring Manager',
      'Company name',
      'Dear Hiring Manager,',
      'I am writing to apply for the **Role** position at **Company**. In my last role I … which led to …',
      'What draws me to Company is … I would bring …',
      'Thank you for your time. I would welcome the chance to talk about how I can help the team.',
      'Sincerely,',
      '{signature}',
    ].join('\n'),
  ),
  doc('letterhead', 'Business letter', 'Letterhead with your logo, name and footer.', 'Documents', 'Letter', { theme: 'classic', brandName: 'Your Company', header: 'www.yourcompany.com', footer: 'Your Company · Address · Phone', accent: '#1f3a68' }, () =>
    [shortDate(), 'To,', 'Name', 'Address', '**Subject:** ', 'Dear Sir or Madam,', 'Body of the letter.', 'Yours faithfully,', '{signature}'].join('\n'),
  ),
  doc('research', 'Research paper', 'Academic layout: abstract, sections, references.', 'Documents', 'Research paper', { theme: 'academic', spacing: '2', pageNumbers: true, header: 'Short title' }, () =>
    [
      '-># Title of the paper<-',
      '->Author One¹, Author Two²<-',
      '->¹ Institution · ² Institution<-',
      '## Abstract',
      'State the question, the method, the main result and why it matters, in about 200 words.',
      '**Keywords:** keyword one, keyword two, keyword three',
      '{toc}',
      '## 1. Introduction',
      '## 2. Related work',
      '## 3. Method',
      'Inline maths works too: type $E = mc^2$ or insert an equation block from the / menu.',
      '## 4. Results',
      '| Model | Accuracy | Time |',
      '| --- | --- | --- |',
      '| Baseline |  |  |',
      '| Ours |  |  |',
      '## 5. Discussion',
      '## 6. Conclusion',
      '## References',
      '1. Author, A. (Year). *Title*. Journal, volume(issue), pages.',
    ].join('\n'),
  ),
  doc('prd', 'Product spec (PRD)', 'Problem, users, requirements and launch plan.', 'Documents', 'Product requirements', { theme: 'modern', font: 'sans', accent: '#6a1b9a' }, () =>
    [
      '# Product requirements: Feature name',
      '> [!info] **Status:** Draft · **Owner:** @you · **Target release:** Q1',
      '{toc}',
      '## Problem',
      '## Who it is for',
      '- **Primary:** ',
      '- **Secondary:** ',
      '## Goals',
      '- [ ] Goal one',
      '- [ ] Goal two',
      '## Non-goals',
      '- ',
      '## Requirements',
      '| # | Requirement | Priority | Notes |',
      '| --- | --- | --- | --- |',
      '| 1 |  | Must |  |',
      '| 2 |  | Should |  |',
      '## User flow',
      '```mermaid',
      'flowchart LR',
      '  A[Open app] --> B{Signed in?}',
      '  B -- yes --> C[Dashboard]',
      '  B -- no --> D[Sign in] --> C',
      '```',
      '## Launch checklist',
      '- [ ] Design review',
      '- [ ] Security review',
      '- [ ] Docs and announcement',
    ].join('\n'),
  ),
  doc('weekly', 'Weekly report', 'Wins, metrics, plans and blockers.', 'Documents', `Weekly report – ${shortDate()}`, { theme: 'report', accent: '#2e7d32' }, () =>
    [
      '# Weekly report',
      `**Week of** ${shortDate()}`,
      '{summary}',
      '## ✅ Done this week',
      '- ',
      '## 📈 Metrics',
      '| Metric | This week | Last week | Change |',
      '| --- | --- | --- | --- |',
      '| Active users |  |  |  |',
      '## 🎯 Next week',
      '- [ ] ',
      '## 🚧 Blockers',
      '> [!warn] Nothing blocking right now.',
    ].join('\n'),
  ),
  doc('blog', 'Blog post', 'Hook, sections, pull quote and call to action.', 'Documents', 'Blog post draft', { theme: 'playful', font: 'georgia' }, () =>
    [
      '# A title that makes people click',
      '*A one-sentence hook that promises something useful.*',
      '## Why this matters',
      'Set the scene with a short story.',
      '## The big idea',
      '> The one sentence you want readers to remember.',
      '## How to do it',
      '1. Step one',
      '2. Step two',
      '3. Step three',
      '## Wrapping up',
      '> [!success] **Try it today:** a concrete next step for the reader.',
    ].join('\n'),
  ),
  doc('invoice', 'Invoice', 'Itemised invoice with totals and payment details.', 'Documents', 'Invoice', { theme: 'minimal', font: 'sans', brandName: 'Your Business', footer: 'Thank you for your business!' }, () =>
    [
      '# INVOICE',
      `**Invoice #** 0001 · **Date:** ${shortDate()} · **Due:** 14 days`,
      '| Billed to | From |',
      '| --- | --- |',
      '| Client name, address | Your name, address |',
      '## Items',
      '| Description | Qty | Rate | Amount |',
      '| --- | --- | --- | --- |',
      '| Design work | 10 | ₹1,000 | ₹10,000 |',
      '|  |  |  |  |',
      '| **Total** |  |  | **₹10,000** |',
      '## Payment',
      'Bank · Account · IFSC · UPI ID',
      '{signature}',
    ].join('\n'),
  ),
  doc('itinerary', 'Travel itinerary', 'Day-by-day plan, bookings and packing list.', 'Documents', 'Trip itinerary', { theme: 'playful', paper: 'cream', accent: '#0a8a9a' }, () =>
    [
      '# ✈️ Trip to Destination',
      '**Dates:** … · **Travellers:** …',
      '## Bookings',
      '| What | Details | Confirmation |',
      '| --- | --- | --- |',
      '| Flight |  |  |',
      '| Hotel |  |  |',
      '## Day 1',
      '- Morning: ',
      '- Afternoon: ',
      '- Evening: ',
      '## Day 2',
      '- ',
      '## Packing list',
      '- [ ] Passport / ID',
      '- [ ] Chargers',
      '- [ ] Medicines',
      '> [!tip] Paste a Google Maps link on its own line to embed a map.',
    ].join('\n'),
  ),
  doc('recipe', 'Recipe card', 'Ingredients, steps and notes on warm paper.', 'Documents', 'Recipe', { theme: 'playful', paper: 'kraft', font: 'georgia' }, () =>
    [
      '-># Grandma’s Recipe<-',
      '->Serves 4 · Prep 15 min · Cook 30 min<-',
      '## Ingredients',
      '- [ ] 2 cups …',
      '- [ ] 1 tsp …',
      '## Method',
      '1. ',
      '2. ',
      '3. ',
      '> [!idea] Chef’s tip: …',
    ].join('\n'),
  ),
];

// --------------------------------------------------------------- notes & journals

const NOTES: GalleryItem[] = [
  doc('diary', 'Diary', 'Ruled cream pages, a red margin line, handwriting and the date.', 'Notes & journals', `Diary – ${shortDate()}`, { theme: 'notebook', paper: 'cream', lines: 'ruled', marginLine: true, dateHeader: true, font: 'hand' }, () =>
    ['Dear diary,', 'Today was …', '', 'Three things I am grateful for:', '1. ', '2. ', '3. ', 'Something I learned:', 'Tomorrow I want to …'].join('\n'),
  ),
  doc('notebook', 'Ruled notebook', 'Classic blue-lined paper with a margin, like a school notebook.', 'Notes & journals', 'Notebook', { theme: 'notebook', paper: 'white', lines: 'college', marginLine: true, font: 'hand' }, () => ['# Topic', 'Start writing on the lines…'].join('\n')),
  doc('lecture', 'Cornell lecture notes', 'Cues, notes and a summary on college-ruled paper.', 'Notes & journals', `Lecture notes – ${shortDate()}`, { theme: 'notebook', lines: 'college', marginLine: true, font: 'hand', dateHeader: true }, () =>
    [
      '# Course · Lecture title',
      '| Cues / questions | Notes |',
      '| --- | --- |',
      '| What is …? |  |',
      '| Why does …? |  |',
      '## Key terms',
      '- **Term:** definition',
      '## Summary',
      'Three sentences that capture the lecture.',
    ].join('\n'),
  ),
  doc('bullet-journal', 'Bullet journal', 'Dot-grid page with tasks, habits and mood.', 'Notes & journals', `Bullet journal – ${shortDate()}`, { theme: 'notebook', paper: 'white', lines: 'dotted', font: 'hand', dateHeader: true }, () =>
    [
      '## Today',
      '- [ ] Most important task',
      '- [ ] ',
      '- [ ] ',
      '## Habits',
      '| Habit | M | T | W | T | F | S | S |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| 💧 Water |  |  |  |  |  |  |  |',
      '| 📚 Read |  |  |  |  |  |  |  |',
      '| 🏃 Move |  |  |  |  |  |  |  |',
      '## Mood',
      '😀 😐 😔',
      '## Notes',
    ].join('\n'),
  ),
  doc('study-planner', 'Study planner', 'Graph paper with goals, timetable and revision checklist.', 'Notes & journals', 'Study planner', { theme: 'notebook', lines: 'grid', paper: 'white', font: 'sans' }, () =>
    [
      '# Exam study plan',
      '> [!info] Exam on … · Goal: …',
      '## Timetable',
      '| Time | Mon | Tue | Wed | Thu | Fri |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 9–11 |  |  |  |  |  |',
      '| 2–4 |  |  |  |  |  |',
      '## Topics to revise',
      '- [ ] Topic 1',
      '- [ ] Topic 2',
      '## Formulas',
      '$a^2 + b^2 = c^2$',
    ].join('\n'),
  ),
  doc('gratitude', 'Gratitude journal', 'Soft recycled paper and gentle prompts.', 'Notes & journals', 'Gratitude journal', { theme: 'notebook', paper: 'recycled', lines: 'ruled', font: 'hand', dateHeader: true }, () =>
    ['I am grateful for …', 'Someone who made my day better:', 'A small win:', 'An affirmation for tomorrow:'].join('\n'),
  ),
  doc('blueprint', 'Blueprint notes', 'Engineering-style grid on blueprint paper.', 'Notes & journals', 'Design notes', { theme: 'modern', paper: 'blueprint', lines: 'grid', font: 'mono' }, () =>
    ['# System design notes', '## Components', '- ', '## Data flow', '```mermaid', 'flowchart LR', '  Client --> API --> DB', '```', '## Trade-offs', '- '].join('\n'),
  ),
  doc('night', 'Night writing', 'Dark paper that is easy on the eyes after hours.', 'Notes & journals', 'Night notes', { theme: 'minimal', paper: 'night', font: 'georgia' }, () => ['# Late-night thoughts', 'Write freely…'].join('\n')),
];

// --------------------------------------------------------------- presentations

type SlideSpec = { layout: LayoutId; title?: string; subtitle?: string; bullets?: string[]; right?: string[]; notes?: string; extra?: Partial<El>[]; bg?: string };

function deck(id: string, name: string, description: string, theme: string, title: string, slides: SlideSpec[], footer = ''): GalleryItem {
  return {
    id,
    name,
    description,
    category: 'Presentations',
    kind: 'slides',
    title,
    build() {
      const orders = keysAfter(null, slides.length);
      const objects: InitialContent['objects'] = [];
      slides.forEach((s, i) => {
        const sid = uid();
        objects.push({ key: `slide:${sid}`, fields: { order: orders[i], layout: s.layout, notes: s.notes ?? '', ...(s.bg ? { bg: s.bg } : {}) } });
        for (const el of [...layoutElements(s.layout, sid, s), ...(s.extra ?? []).map((e) => ({ ...e, slide: sid }))]) objects.push({ key: `el:${uid()}`, fields: el as Record<string, unknown> });
      });
      return { tokens: [], objects, settings: { theme, footer, numbers: true, logo: null } as unknown as Partial<DocSettings> };
    },
  };
}

const DECKS: GalleryItem[] = [
  deck('deck-blank', 'Blank presentation', 'Title slide in the Classic Navy theme.', 'navy', 'Untitled presentation', [{ layout: 'title' }]),
  deck(
    'pitch',
    'Startup pitch deck',
    'Problem, solution, market, traction and the ask.',
    'navy',
    'Pitch deck',
    [
      { layout: 'title', title: 'Company name', subtitle: 'One line that explains what you do', notes: 'Introduce yourself and the company in 20 seconds.' },
      { layout: 'title-content', title: 'The problem', bullets: ['Who has the problem', 'How painful it is today', 'Why existing tools fail'] },
      { layout: 'image-text', title: 'Our solution', bullets: ['What we built', 'The moment of delight', 'Why it is 10× better'] },
      { layout: 'big-number', title: '₹4,200 Cr', subtitle: 'addressable market in India by 2028' },
      { layout: 'two-column', title: 'Business model', bullets: ['Free for individuals', 'Team plan ₹199 / seat'], right: ['Enterprise with SSO', 'Usage-based AI add-on'] },
      { layout: 'title-content', title: 'Traction', bullets: ['1,200 weekly active users', '35% month-on-month growth', '4 paying pilot customers'] },
      { layout: 'quote', title: '“This replaced three tools for our team.”', subtitle: '— Early customer' },
      { layout: 'section', title: 'The ask', subtitle: 'Raising ₹1.5 Cr to reach 10,000 users' },
    ],
    'Confidential',
  ),
  deck(
    'class',
    'Class presentation',
    'Friendly pastel slides for school or college.',
    'pastel',
    'Class presentation',
    [
      { layout: 'title', title: 'Topic of the presentation', subtitle: 'Group members · Class · Date' },
      { layout: 'title-content', title: 'What we will cover', bullets: ['Background', 'Key ideas', 'Examples', 'Conclusion'] },
      { layout: 'image-text', title: 'Key idea', bullets: ['Explain it simply', 'Use an example'] },
      { layout: 'two-column', title: 'Pros and cons', bullets: ['Advantage one', 'Advantage two'], right: ['Limitation one', 'Limitation two'] },
      { layout: 'title-content', title: 'Conclusion', bullets: ['What we learned', 'Questions?'] },
    ],
  ),
  deck(
    'update',
    'Project status update',
    'Corporate blue slides for weekly or monthly reviews.',
    'corporate',
    'Project update',
    [
      { layout: 'title', title: 'Project update', subtitle: 'Month · Team name' },
      { layout: 'big-number', title: '82%', subtitle: 'of milestones on track' },
      { layout: 'two-column', title: 'Highlights and risks', bullets: ['Shipped …', 'Hired …'], right: ['Risk: …', 'Mitigation: …'] },
      { layout: 'title-content', title: 'Next steps', bullets: ['…', '…', '…'] },
    ],
  ),
  deck(
    'portfolio',
    'Portfolio showcase',
    'Dark, image-led slides for showing your work.',
    'midnight',
    'Portfolio',
    [
      { layout: 'title', title: 'Your Name', subtitle: 'Designer · Developer · Storyteller' },
      { layout: 'image-text', title: 'Project one', bullets: ['The brief', 'What I did', 'The result'] },
      { layout: 'image-text', title: 'Project two', bullets: ['The brief', 'What I did', 'The result'] },
      { layout: 'quote', title: '“Design is how it works.”', subtitle: '— Steve Jobs' },
      { layout: 'section', title: 'Let’s work together', subtitle: 'you@email.com' },
    ],
  ),
  deck(
    'tech-talk',
    'Tech talk',
    'Terminal-green on a dark grid, for engineering talks.',
    'tech',
    'Tech talk',
    [
      { layout: 'title', title: 'Building a CRDT from scratch', subtitle: 'Your Name · Meetup' },
      { layout: 'title-content', title: 'Why real-time is hard', bullets: ['Concurrent edits', 'Offline clients', 'No central lock'] },
      { layout: 'two-column', title: 'OT vs CRDT', bullets: ['Needs a server to transform', 'Hard to get right'], right: ['Merges anywhere', 'Mathematically convergent'] },
      { layout: 'big-number', title: '0', subtitle: 'conflicts to resolve by hand' },
      { layout: 'section', title: 'Questions?', subtitle: 'github.com/you' },
    ],
  ),
  deck(
    'event',
    'Wedding & events',
    'Elegant black and gold for invitations and celebrations.',
    'gold',
    'Celebration',
    [
      { layout: 'title', title: 'Anika & Rohan', subtitle: 'Saturday, 12 December · Jaipur' },
      { layout: 'title-content', title: 'Schedule', bullets: ['Mehendi · 11 am', 'Sangeet · 7 pm', 'Wedding · next day, 6 pm'] },
      { layout: 'quote', title: '“Together is a wonderful place to be.”', subtitle: '' },
    ],
  ),
  deck(
    'lesson',
    'Notebook lesson',
    'Handwritten slides on lined paper for teaching.',
    'notebook',
    'Lesson',
    [
      { layout: 'title', title: 'Today’s lesson', subtitle: 'Subject · Chapter' },
      { layout: 'title-content', title: 'Learning goals', bullets: ['Understand …', 'Practise …', 'Apply …'] },
      { layout: 'two-column', title: 'Example', bullets: ['Question'], right: ['Answer'] },
    ],
  ),
  deck(
    'nature',
    'Nature & sustainability',
    'Forest greens for environmental and NGO decks.',
    'forest',
    'Sustainability report',
    [
      { layout: 'title', title: 'Our sustainability journey', subtitle: 'Annual report' },
      { layout: 'big-number', title: '40%', subtitle: 'less carbon than last year' },
      { layout: 'image-text', title: 'Community projects', bullets: ['Tree planting', 'Clean water', 'Education'] },
    ],
  ),
  deck(
    'sunset',
    'Creative sunset',
    'Warm gradient slides for marketing and storytelling.',
    'sunset',
    'Campaign',
    [
      { layout: 'title', title: 'Summer campaign', subtitle: 'Creative brief' },
      { layout: 'title-content', title: 'Audience', bullets: ['18–30 year olds', 'Mobile first', 'Love short videos'] },
      { layout: 'quote', title: '“Make it feel like the first day of holidays.”', subtitle: '— Brand director' },
    ],
  ),
];

// --------------------------------------------------------------- whiteboards

type Obj = { key: string; fields: Record<string, unknown> };
const sticky = (x: number, y: number, text: string, fill = '#fff3a3', z = 2): Obj => ({ key: `item:${uid()}`, fields: { kind: 'sticky', x, y, w: 180, h: 180, z, fill, text, size: 18 } });
const frame = (x: number, y: number, w: number, h: number, text: string): Obj => ({ key: `item:${uid()}`, fields: { kind: 'frame', x, y, w, h, z: -1, text, size: 22 } });
const text = (x: number, y: number, t: string, size = 32): Obj => ({ key: `item:${uid()}`, fields: { kind: 'text', x, y, w: 700, h: size * 1.6, z: 3, text: t, size, color: '#1b1f24' } });

function board(id: string, name: string, description: string, title: string, items: () => Obj[], bg = 'dots'): GalleryItem {
  return {
    id,
    name,
    description,
    category: 'Whiteboards',
    kind: 'board',
    title,
    build: () => ({ tokens: [], objects: items(), settings: { bg } as unknown as Partial<DocSettings> }),
  };
}

const BOARDS: GalleryItem[] = [
  board('board-blank', 'Blank whiteboard', 'An infinite canvas with a dot grid.', 'Whiteboard', () => []),
  board('brainstorm', 'Brainstorm', 'A big question and colourful sticky notes.', 'Brainstorm', () => [
    text(0, -110, '💡 How might we …?', 40),
    sticky(0, 0, 'Idea'),
    sticky(210, 0, 'Idea', '#ffd1dc'),
    sticky(420, 0, 'Idea', '#c8f2c2'),
    sticky(630, 0, 'Idea', '#cfe6ff'),
    sticky(105, 210, 'Wild idea', '#e3d4ff'),
    sticky(315, 210, 'Build on it', '#ffd9b0'),
  ]),
  board('retro', 'Retrospective', 'Went well, to improve and actions.', 'Sprint retrospective', () => [
    frame(0, 0, 420, 560, '😀 Went well'),
    frame(460, 0, 420, 560, '🤔 To improve'),
    frame(920, 0, 420, 560, '🚀 Actions'),
    sticky(30, 40, 'Shipped on time', '#c8f2c2'),
    sticky(490, 40, 'Too many meetings', '#ffd1dc'),
    sticky(950, 40, 'Try async stand-ups', '#cfe6ff'),
  ]),
  board('swot', 'SWOT analysis', 'Strengths, weaknesses, opportunities, threats.', 'SWOT analysis', () => [
    frame(0, 0, 520, 380, 'Strengths'),
    frame(560, 0, 520, 380, 'Weaknesses'),
    frame(0, 440, 520, 380, 'Opportunities'),
    frame(560, 440, 520, 380, 'Threats'),
    sticky(30, 40, 'Strong team', '#c8f2c2'),
    sticky(590, 40, 'Small budget', '#ffd1dc'),
    sticky(30, 480, 'New market', '#cfe6ff'),
    sticky(590, 480, 'Competitor X', '#ffd9b0'),
  ]),
  board('mindmap', 'Mind map', 'A central idea with connected branches.', 'Mind map', () => {
    const center = { key: `item:${uid()}`, fields: { kind: 'ellipse', x: 360, y: 230, w: 240, h: 120, z: 2, text: 'Central idea', size: 22, color: '#1f3a68', fill: '#eef2f8' } };
    const branches = [
      [40, 40, 'Branch one'],
      [680, 40, 'Branch two'],
      [40, 440, 'Branch three'],
      [680, 440, 'Branch four'],
    ].map(([x, y, t]) => ({ key: `item:${uid()}`, fields: { kind: 'rect', x, y, w: 200, h: 90, z: 2, text: t, size: 18, color: '#0a66c2', fill: '#ffffff' } }));
    const arrows = branches.map((b) => ({ key: `item:${uid()}`, fields: { kind: 'arrow', x: 0, y: 0, x2: 0, y2: 0, w: 0, h: 0, z: 1, from: center.key.slice(5), to: b.key.slice(5), color: '#6b7785', width: 2, text: '' } }));
    return [center, ...branches, ...arrows];
  }),
  board('flowchart', 'Flowchart', 'Start, steps, a decision and the end.', 'Flowchart', () => {
    const mk = (kind: string, x: number, y: number, t: string, fill = '#ffffff') => ({ key: `item:${uid()}`, fields: { kind, x, y, w: 200, h: 90, z: 2, text: t, size: 18, color: '#1b1f24', fill } });
    const a = mk('ellipse', 0, 0, 'Start', '#c8f2c2');
    const b = mk('rect', 0, 160, 'Do something');
    const c = mk('diamond', 0, 320, 'OK?', '#fff3a3');
    const d = mk('rect', 300, 320, 'Fix it');
    const e = mk('ellipse', 0, 480, 'End', '#ffd1dc');
    const link = (x: Obj, y: Obj, label = '') => ({ key: `item:${uid()}`, fields: { kind: 'arrow', x: 0, y: 0, x2: 0, y2: 0, w: 0, h: 0, z: 1, from: x.key.slice(5), to: y.key.slice(5), color: '#1b1f24', width: 2, text: label } });
    return [a, b, c, d, e, link(a, b), link(b, c), link(c, e, 'yes'), link(c, d, 'no'), link(d, b)];
  }),
  board('journey', 'User journey map', 'Stages from discovery to loyalty.', 'User journey', () =>
    ['Discover', 'Sign up', 'First use', 'Habit', 'Recommend'].flatMap((s, i) => [frame(i * 300, 0, 280, 520, s), sticky(i * 300 + 50, 50, 'What they do'), sticky(i * 300 + 50, 260, 'How they feel', '#ffd1dc')]),
  ),
  board('weekly-planner', 'Weekly planner', 'Seven day columns on ruled paper.', 'Weekly planner', () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => frame(i * 240, 0, 220, 600, d)), 'lines'),
];

// --------------------------------------------------------------- kanban

function kanban(id: string, name: string, description: string, title: string, cols: [string, string, string[]][]): GalleryItem {
  return {
    id,
    name,
    description,
    category: 'Boards',
    kind: 'kanban',
    title,
    build() {
      const objects: Obj[] = [];
      const orders = keysAfter(null, cols.length);
      cols.forEach(([t, color, cards], i) => {
        const cid = uid();
        objects.push({ key: `col:${cid}`, fields: { order: orders[i], title: t, color } });
        keysAfter(null, cards.length).forEach((o, j) => objects.push({ key: `card:${uid()}`, fields: { col: cid, order: o, title: cards[j], labels: [], checklist: [] } }));
      });
      return { tokens: [], objects };
    },
  };
}

const KANBANS: GalleryItem[] = [
  kanban('kanban-basic', 'Simple task board', 'To do, doing, done.', 'Task board', [
    ['To do', '#6b7785', ['Drag me to “Doing”', 'Click a card to add a due date and assignee']],
    ['Doing', '#0a66c2', []],
    ['Done', '#2e7d32', []],
  ]),
  kanban('kanban-project', 'Project tracker', 'Backlog to release with review.', 'Project tracker', [
    ['Backlog', '#6b7785', ['Research competitors', 'Write user stories']],
    ['Ready', '#c8a24a', ['Design sign-in page']],
    ['In progress', '#0a66c2', ['Build the API']],
    ['Review', '#6a1b9a', []],
    ['Released', '#2e7d32', []],
  ]),
  kanban('kanban-content', 'Content calendar', 'Ideas, drafting, editing, published.', 'Content calendar', [
    ['Ideas', '#ef6c00', ['10 tips for …', 'Behind the scenes']],
    ['Writing', '#0a66c2', []],
    ['Editing', '#6a1b9a', []],
    ['Published', '#2e7d32', []],
  ]),
  kanban('kanban-hiring', 'Hiring pipeline', 'Applied to hired.', 'Hiring pipeline', [
    ['Applied', '#6b7785', ['Candidate A', 'Candidate B']],
    ['Screen', '#c8a24a', []],
    ['Interview', '#0a66c2', []],
    ['Offer', '#6a1b9a', []],
    ['Hired', '#2e7d32', []],
  ]),
  kanban('kanban-bugs', 'Bug tracker', 'Reported, triaged, fixing, verified.', 'Bug tracker', [
    ['Reported', '#c62828', ['Login button misaligned on mobile']],
    ['Triaged', '#ef6c00', []],
    ['Fixing', '#0a66c2', []],
    ['Verified', '#2e7d32', []],
  ]),
];

// --------------------------------------------------------------- sheets

function sheet(id: string, name: string, description: string, title: string, rows: string[][], extra: (o: Obj[]) => void = () => {}): GalleryItem {
  return {
    id,
    name,
    description,
    category: 'Spreadsheets',
    kind: 'sheet',
    title,
    build() {
      const objects: Obj[] = [];
      const col = (c: number) => String.fromCharCode(65 + c);
      rows.forEach((row, r) =>
        row.forEach((v, c) => {
          if (v === '') return;
          const bold = r === 0;
          objects.push({ key: `cell:${col(c)}${r + 1}`, fields: { v, ...(bold ? { b: true, bg: '#1f3a68', color: '#ffffff' } : {}) } });
        }),
      );
      extra(objects);
      return { tokens: [], objects };
    },
  };
}

const SHEETS: GalleryItem[] = [
  sheet('sheet-blank', 'Blank spreadsheet', 'Formulas, formatting, charts and CSV.', 'Spreadsheet', []),
  sheet(
    'budget',
    'Monthly budget',
    'Income, expenses and what is left, with a chart.',
    'Monthly budget',
    [
      ['Category', 'Planned', 'Actual', 'Difference'],
      ['Rent', '15000', '15000', '=B2-C2'],
      ['Groceries', '6000', '6800', '=B3-C3'],
      ['Transport', '2500', '2100', '=B4-C4'],
      ['Eating out', '3000', '4200', '=B5-C5'],
      ['Savings', '8000', '8000', '=B6-C6'],
      ['Total', '=SUM(B2:B6)', '=SUM(C2:C6)', '=B7-C7'],
    ],
    (o) => {
      for (const r of ['B', 'C', 'D']) for (let i = 2; i <= 7; i++) {
        const cell = o.find((x) => x.key === `cell:${r}${i}`);
        if (cell) cell.fields.fmt = 'inr';
      }
      o.find((x) => x.key === 'cell:A7')!.fields.b = true;
      o.push({ key: `chart:${uid()}`, fields: { range: 'A1:C6', type: 'bar', title: 'Planned vs actual', order: '1' } });
    },
  ),
  sheet(
    'grades',
    'Grade tracker',
    'Marks, averages and pass/fail with IF formulas.',
    'Grade tracker',
    [
      ['Student', 'Maths', 'Science', 'English', 'Average', 'Result'],
      ['Asha', '88', '92', '79', '=AVERAGE(B2:D2)', '=IF(E2>=40,"Pass","Fail")'],
      ['Ravi', '67', '74', '81', '=AVERAGE(B3:D3)', '=IF(E3>=40,"Pass","Fail")'],
      ['Meera', '95', '89', '91', '=AVERAGE(B4:D4)', '=IF(E4>=40,"Pass","Fail")'],
      ['Class average', '=AVERAGE(B2:B4)', '=AVERAGE(C2:C4)', '=AVERAGE(D2:D4)', '=AVERAGE(E2:E4)', ''],
    ],
    (o) => o.push({ key: `chart:${uid()}`, fields: { range: 'A1:D4', type: 'bar', title: 'Marks by subject', order: '1' } }),
  ),
  sheet('split', 'Trip expense split', 'Who paid what and who owes whom.', 'Trip expenses', [
    ['Item', 'Paid by', 'Amount'],
    ['Hotel', 'Asha', '12000'],
    ['Train', 'Ravi', '4500'],
    ['Food', 'Meera', '3600'],
    ['Total', '', '=SUM(C2:C4)'],
    ['Each pays', '', '=ROUND(C5/3,0)'],
  ]),
  sheet(
    'sales',
    'Sales tracker',
    'Monthly revenue with growth and a line chart.',
    'Sales tracker',
    [
      ['Month', 'Revenue', 'Growth'],
      ['Jan', '42000', ''],
      ['Feb', '46500', '=B3/B2-1'],
      ['Mar', '51000', '=B4/B3-1'],
      ['Apr', '49800', '=B5/B4-1'],
      ['May', '58200', '=B6/B5-1'],
      ['Jun', '63900', '=B7/B6-1'],
    ],
    (o) => {
      for (let i = 3; i <= 7; i++) o.find((x) => x.key === `cell:C${i}`)!.fields.fmt = 'pct';
      o.push({ key: `chart:${uid()}`, fields: { range: 'A1:B7', type: 'line', title: 'Revenue', order: '1' } });
    },
  ),
  sheet('habits', 'Habit tracker', 'Tick off habits and see your streak.', 'Habit tracker', [
    ['Habit', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Done'],
    ['Read 20 min', 'TRUE', 'TRUE', 'FALSE', '', '', '', '', '=COUNTIF(B2:H2,TRUE)'],
    ['Exercise', 'TRUE', 'FALSE', 'TRUE', '', '', '', '', '=COUNTIF(B3:H3,TRUE)'],
    ['No sugar', 'FALSE', 'TRUE', 'TRUE', '', '', '', '', '=COUNTIF(B4:H4,TRUE)'],
  ]),
];

export const GALLERY: GalleryItem[] = [...DOCS, ...NOTES, ...DECKS, ...BOARDS, ...KANBANS, ...SHEETS];
export const CATEGORIES: Category[] = ['Documents', 'Notes & journals', 'Presentations', 'Whiteboards', 'Boards', 'Spreadsheets'];
export const BLANKS: Record<DocKind, string> = { doc: 'blank', slides: 'deck-blank', board: 'board-blank', kanban: 'kanban-basic', sheet: 'sheet-blank' };
export { today };
