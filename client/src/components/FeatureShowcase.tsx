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
      ['🤖', 'Live AI co-writer', 'Claude joins with its own cursor and types in live. Keep or undo in one click.'],
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

const DWELL = 3200;

/**
 * Compact animated showcase: pick a category on the left; its features play
 * one after another as cards on the right. A ribbon of every feature scrolls below.
 */
export function FeatureShowcase() {
  const [g, setG] = useState(0);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const group = FEATURE_GROUPS[g];

  useEffect(() => {
    const n = root.current;
    if (!n) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.25 });
    io.observe(n);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (paused || !inView || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => {
      if (i + 1 < group.items.length) setI(i + 1);
      else {
        setG((g + 1) % FEATURE_GROUPS.length);
        setI(0);
      }
    }, DWELL);
    return () => clearTimeout(t);
  }, [g, i, paused, inView, group.items.length]);

  const item = group.items[i];
  const prev = group.items[(i - 1 + group.items.length) % group.items.length];
  const next = group.items[(i + 1) % group.items.length];

  return (
    <div className="showcase" ref={root} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} style={{ '--fc': group.color } as CSSProperties}>
      <div className="showcase-main">
        <nav className="showcase-tabs" aria-label="Feature categories">
          {FEATURE_GROUPS.map((x, k) => (
            <button
              key={x.title}
              className={`showcase-tab ${k === g ? 'active' : ''}`}
              style={{ '--tc': x.color } as CSSProperties}
              onClick={() => {
                setG(k);
                setI(0);
              }}
              type="button"
            >
              <span className="showcase-tab-icon">{x.icon}</span>
              <span className="showcase-tab-text">
                {x.title}
                <small>{x.items.length} features</small>
              </span>
              {k === g && <span className="showcase-progress" key={`${g}-${i}-${paused}`} style={{ width: `${((i + 1) / x.items.length) * 100}%` }} />}
            </button>
          ))}
        </nav>

        <div className="showcase-stage" aria-live="polite">
          <article className="showcase-card ghost left" key={`p-${g}-${i}`} aria-hidden>
            <span className="showcase-icon">{prev[0]}</span>
            <h4>{prev[1]}</h4>
          </article>
          <article className="showcase-card ghost right" key={`n-${g}-${i}`} aria-hidden>
            <span className="showcase-icon">{next[0]}</span>
            <h4>{next[1]}</h4>
          </article>
          <article className="showcase-card front" key={`f-${g}-${i}`}>
            <span className="showcase-icon big">{item[0]}</span>
            <span className="showcase-kicker">
              {group.title} · {i + 1}/{group.items.length}
            </span>
            <h4>{item[1]}</h4>
            <p>{item[2]}</p>
            {!paused && inView && <span className="showcase-timer" key={`t-${g}-${i}`} />}
          </article>
          <div className="showcase-dots">
            {group.items.map((x, k) => (
              <button key={x[1]} className={k === i ? 'on' : ''} onClick={() => setI(k)} aria-label={x[1]} title={x[1]} type="button" />
            ))}
          </div>
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
