import { useEffect, useRef, useState, type CSSProperties } from 'react';

type Item = [icon: string, title: string, body: string];
interface Group {
  title: string;
  icon: string;
  color: string;
  items: Item[];
}

export const FEATURE_GROUPS: Group[] = [
  {
    title: 'Beautiful documents',
    icon: '📝',
    color: '#1f3a68',
    items: [
      ['✍️', 'True rich-text editor', 'Real bold, fonts, colours, alignment, lists, tables and checklists, with no Markdown symbols in sight.'],
      ['📓', 'Notebook & diary paper', 'Ruled, college, dotted or grid pages with a margin line, a dated header and handwriting fonts.'],
      ['🗂️', '50 designed templates', 'Diary, resume, proposal, invoice, research paper, pitch deck, retrospective and budget, with live previews.'],
      ['🖼️', 'Images, crop & stock photos', 'Paste, drop, resize, crop and caption, or insert free photos without leaving the page.'],
      ['🔗', 'Embeds & link cards', 'YouTube, Maps, Figma, Gists, Spotify and tweets, plus preview cards for any link.'],
      ['∑', 'Maths, diagrams & code', 'LaTeX equations, Mermaid flowcharts and code highlighted in 30+ languages.'],
      ['🎙️', 'Voice notes & sketches', 'Record audio, draw inline sketches and attach PDFs or any file.'],
      ['⚡', 'Slash commands', 'Type “/” to insert anything, “:” for emoji, “@” to mention someone.'],
      ['🏷️', 'Brand kit', 'Your logo, colours and font, applied to any document or deck in one click.'],
    ],
  },
  {
    title: 'Slides, boards & sheets',
    icon: '📊',
    color: '#b3541e',
    items: [
      ['🎞️', 'Presentation editor', 'Layouts, drag-and-drop text, shapes and images, speaker notes and a full-screen presenter.'],
      ['🎨', '12 slide themes', 'Gradients, decorations, logos and footers. Export to editable PowerPoint or PDF.'],
      ['🧩', 'Infinite whiteboard', 'Pen, sticky notes, shapes, connectors and frames, with everyone’s live cursors.'],
      ['📋', 'Kanban boards', 'Cards with assignees, due dates, labels, checklists and work-in-progress limits.'],
      ['📈', 'Spreadsheets', 'Formulas, formatting, sorting, charts and CSV, built on the same merge engine.'],
    ],
  },
  {
    title: 'Only with a CRDT',
    icon: '🧬',
    color: '#6a1b9a',
    items: [
      ['🕰️', 'Compare any two moments', 'Pick 2 PM yesterday and now: additions in green, deletions in red, like Git.'],
      ['🔍', 'Paragraph history', 'Every edit ever made to one paragraph, including text that was later deleted.'],
      ['↩️', 'Undo one person’s edits', 'Roll back what someone changed since a time, without touching anyone else’s work.'],
      ['🎬', 'Time-lapse replay & video', 'Watch the document being written, keystroke by keystroke, or export it as a video.'],
      ['🌿', 'Branch explorer', 'Fork, see the family tree, compare side by side and merge back with no conflicts.'],
      ['🤫', 'Private drafts', 'Write a section only you can see, then reveal it to everyone in one go.'],
      ['🔒', 'Locked sections', 'Freeze paragraphs so only you and the owner can change them.'],
      ['📡', 'Peer-to-peer sync', 'Browsers sync directly over WebRTC, so editing continues even if the server goes down.'],
      ['🔥', 'Conflict heatmap', 'See where several people edited the same paragraph at the same moment.'],
      ['🛡️', 'End-to-end encryption', 'The server merges ciphertext it cannot read. Works offline too.'],
    ],
  },
  {
    title: 'AI built in',
    icon: '✨',
    color: '#0a7a6b',
    items: [
      ['🤖', 'Live AI co-writer', 'Gemini (free) or Claude joins with its own cursor and types in live. Keep or undo in one click.'],
      ['🪄', 'Document → slides', 'Turn any document into a themed presentation with speaker notes.'],
      ['📷', 'Photos to text', 'Describe images, or turn a whiteboard photo into tidy notes.'],
      ['🌐', 'Live translation', 'A linked copy in another language that follows the original as it changes.'],
      ['🗣️', 'Meeting mode', 'Dictate a meeting; get the summary, decisions and action items written in.'],
      ['🧑‍🏫', 'AI reviewer & tone switcher', 'Editor-style comments, and one-click formal, casual or simpler rewrites.'],
      ['❓', 'Ask your documents', 'Questions answered from everything you have written, with sources.'],
    ],
  },
  {
    title: 'Teams & collaboration',
    icon: '🤝',
    color: '#0a66c2',
    items: [
      ['👀', 'Live cursors & follow mode', 'Named cursors, typing and away status; follow anyone around the page.'],
      ['📞', 'Voice & video calls', 'Call everyone in the document right beside the page you are editing.'],
      ['💬', 'Comments, suggestions & reactions', 'Threads anchored to text, tracked changes and emoji reactions.'],
      ['✅', 'Approvals & e-signature', 'Draft, review, approved, with sign-off notes and a drawn signature.'],
      ['📅', 'Tasks, calendar & reminders', 'Assign checklist items with due dates and see them on a calendar.'],
      ['🏢', 'Workspaces & team templates', 'Shared spaces for teams, with templates everyone can start from.'],
      ['📰', 'Public pages', 'Publish as a blog post with reading time, a progress bar and comments.'],
    ],
  },
  {
    title: 'Made for you',
    icon: '🌙',
    color: '#a8842f',
    items: [
      ['🎨', 'Seven colour themes', 'Light, dark, sepia, ocean, forest, rose and midnight, saved to your account.'],
      ['🔤', 'Dyslexia-friendly mode', 'The OpenDyslexic font with extra spacing for easier reading.'],
      ['🔊', 'Read aloud & reading mode', 'Text-to-speech that highlights each word, and a distraction-free reader.'],
      ['🔥', 'Streaks & goals', 'A daily word goal, writing streaks and a six-month writing calendar.'],
      ['⌨️', 'Focus & command palette', 'Focus mode, voice typing and Ctrl+K to run any action.'],
    ],
  },
];

export const FEATURE_COUNT = FEATURE_GROUPS.reduce((n, g) => n + g.items.length, 0);

/** One photo per feature, in the same order as the cards (free-to-use CC0 photos, see /features/credits.json). */
const IMAGES = [
  'rich-text', 'diary', 'templates', 'images', 'embeds', 'maths', 'voice', 'slash', 'brand',
  'presentation', 'slide-themes', 'whiteboard', 'kanban', 'spreadsheets',
  'compare', 'para-history', 'undo', 'timelapse', 'branch', 'drafts', 'locks', 'p2p', 'heatmap', 'encryption',
  'ai-cowriter', 'doc-slides', 'photos-text', 'translation', 'meeting', 'reviewer', 'ask',
  'cursors', 'calls', 'comments', 'approvals', 'tasks', 'workspaces', 'public',
  'themes', 'dyslexia', 'read-aloud', 'streaks', 'focus',
];

/** Every card in order, with its category. */
const CARDS = FEATURE_GROUPS.flatMap((g, gi) => g.items.map(([icon, title, body]) => ({ icon, title, body, gi })));

const DWELL = 3000;

/**
 * A carousel that plays by itself: the cards slide past one after another,
 * each with a photo and a colourful background in its category's colour.
 */
export function FeatureShowcase() {
  const [i, setI] = useState(0);
  const [inView, setInView] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(1100);
  const card = CARDS[i];
  const group = FEATURE_GROUPS[card.gi];

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setStageW(e.contentRect.width));
    if (stage.current) ro.observe(stage.current);
    const vis = () => setInView(!document.hidden);
    vis();
    document.addEventListener('visibilitychange', vis);
    return () => {
      ro.disconnect();
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  // Advances on its own, one card after another (resting only while the browser tab is hidden).
  useEffect(() => {
    if (!inView || document.documentElement.hasAttribute('data-reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => setI((n) => (n + 1) % CARDS.length), DWELL);
    return () => clearTimeout(t);
  }, [i, inView]);

  const CW = Math.min(380, stageW * 0.78);
  const GAP = 22;
  const offset = stageW / 2 - CW / 2 - i * (CW + GAP);
  const first = (gi: number) => CARDS.findIndex((c) => c.gi === gi);

  return (
    <div className="showcase" ref={root} style={{ '--fc': group.color } as CSSProperties}>
      <nav className="showcase-chips" aria-label="Feature categories">
        {FEATURE_GROUPS.map((x, k) => {
          const start = first(k);
          const inGroup = card.gi === k;
          return (
            <button key={x.title} className={`showcase-chip ${inGroup ? 'active' : ''}`} style={{ '--tc': x.color } as CSSProperties} onClick={() => setI(start)} type="button">
              <span>{x.icon}</span> {x.title}
              {inGroup && <span className="chip-progress" style={{ width: `${((i - start + 1) / x.items.length) * 100}%` }} />}
            </button>
          );
        })}
      </nav>

      <div className="carousel" ref={stage} aria-live="polite">
        <div className="carousel-track" style={{ transform: `translateX(${offset}px)` }}>
          {CARDS.map((c, k) => {
            const g = FEATURE_GROUPS[c.gi];
            const near = Math.abs(k - i) <= 3;
            return (
              <article
                key={c.title}
                className={`fcard ${k === i ? 'active' : ''}`}
                style={{ '--gc': g.color, width: CW } as CSSProperties}
                aria-hidden={k !== i}
                onClick={() => setI(k)}
              >
                <div className="fcard-photo">
                  {near && <img src={`/features/${IMAGES[k]}.jpg`} alt="" loading="lazy" draggable={false} />}
                  <span className="fcard-badge">
                    {g.icon} {g.title}
                  </span>
                </div>
                <div className="fcard-body">
                  <span className="fcard-icon">{c.icon}</span>
                  <span className="fcard-count">
                    {k - first(c.gi) + 1} / {g.items.length}
                  </span>
                  <h4>{c.title}</h4>
                  <p>{c.body}</p>
                </div>
                {k === i && inView && <span className="fcard-timer" key={`t${i}`} />}
              </article>
            );
          })}
        </div>
      </div>

      <div className="ribbon" aria-hidden>
        {[0, 1].map((row) => (
          <div key={row} className={`ribbon-track ${row ? 'reverse' : ''}`}>
            {[0, 1].map((copy) => (
              <span key={copy} className="ribbon-set">
                {FEATURE_GROUPS.flatMap((x, gi) => x.items.filter((_, k) => k % 2 === row).map((it) => ({ it, gi }))).map(({ it, gi }) => (
                  <span key={it[1]} className="ribbon-chip" style={{ '--tc': FEATURE_GROUPS[gi].color } as CSSProperties}>
                    {it[0]} {it[1]}
                  </span>
                ))}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
