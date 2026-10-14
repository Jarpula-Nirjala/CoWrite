import { useAuth } from '../auth.tsx';
import { Playground } from '../components/Playground.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { AUTHOR, PROJECTS, REPO_URL } from '../content.ts';
import { newRoomId } from '../identity.ts';
import { Link, navigate } from '../router.ts';

const FEATURE_GROUPS = [
  {
    title: 'Documents that look designed',
    items: [
      ['True rich-text editor', 'Real bold, fonts, sizes, colours, alignment, lists, tables and checklists, with no Markdown symbols in sight.'],
      ['Notebook & diary paper', 'Ruled, college, dotted or grid pages with a margin line, a dated header and handwriting fonts.'],
      ['50 designed templates', 'Diary, resume, proposal, invoice, research paper, pitch deck, retrospective, budget and many more, with live previews.'],
      ['Page setup & print', 'A4 or Letter, margins, headers, footers, page numbers, page breaks and themed paper.'],
      ['Images, crop & stock photos', 'Paste, drop, resize, crop and caption images, or insert free photos without leaving the page.'],
      ['Embeds & link cards', 'YouTube, Maps, Figma, Gists, Spotify and tweets, plus preview cards for any link.'],
      ['Maths, diagrams & code', 'LaTeX equations, Mermaid flowcharts and code blocks highlighted in 30+ languages.'],
      ['Voice notes, sketches & files', 'Record audio, draw inline sketches and attach PDFs or any file as a card.'],
      ['Slash commands & emoji', 'Type “/” to insert anything, “:” for emoji, “@” to mention, with an icon library.'],
      ['Brand kit', 'Your logo, colours and font saved once, applied to any document or deck in one click.'],
    ],
  },
  {
    title: 'Slides, whiteboards, boards and sheets',
    items: [
      ['Presentation editor', 'Layouts, drag-and-drop text, shapes and images, speaker notes and a full-screen presenter.'],
      ['12 slide themes', 'Gradients, decorations, logos and footers; export to editable PowerPoint or PDF.'],
      ['Infinite whiteboard', 'Pen, highlighter, sticky notes, shapes, connectors and frames, with live cursors.'],
      ['Kanban boards', 'Lists and cards with assignees, due dates, labels, checklists and work-in-progress limits.'],
      ['Spreadsheets', 'Formulas (SUM, AVERAGE, IF, COUNTIF and more), formatting, sorting, charts and CSV.'],
    ],
  },
  {
    title: 'Only possible with a CRDT',
    items: [
      ['Compare any two moments', 'Pick 2 PM yesterday and now: additions in green, deletions in red, like Git.'],
      ['Paragraph history', 'Every edit ever made to one paragraph, including text that was later deleted.'],
      ['Undo one person’s edits', 'Roll back what someone changed since a time, without touching anyone else’s work.'],
      ['Time-lapse replay & video', 'Watch the document being written, or export the replay as a video.'],
      ['Branch explorer', 'Fork, see the family tree, compare side by side and merge back with no conflicts.'],
      ['Private drafts', 'Write a section only you can see, then reveal it to everyone in one go.'],
      ['Locked sections', 'Freeze paragraphs so only you and the owner can change them, enforced by the server.'],
      ['Peer-to-peer sync', 'Browsers sync directly over WebRTC, so editing continues even if the server goes down.'],
      ['Conflict heatmap', 'See where several people edited the same paragraph at the same moment.'],
      ['Solo playback', 'Replay one person’s typing on its own, with everyone else greyed out.'],
      ['End-to-end encryption & offline', 'The server merges ciphertext it cannot read; documents work offline and sync later.'],
    ],
  },
  {
    title: 'AI built in (Claude)',
    items: [
      ['Live AI co-writer', 'Claude joins as a collaborator with its own cursor; keep or undo its writing in one click.'],
      ['Document → slides', 'Turn any document into a themed presentation with speaker notes.'],
      ['Photos to text', 'Describe images, or turn a whiteboard or notebook photo into tidy notes.'],
      ['Live translation', 'A linked copy in another language that re-translates itself as the original changes.'],
      ['Meeting mode', 'Dictate a meeting; get the summary, decisions and action items written in.'],
      ['AI reviewer & tone switcher', 'Editor-style comments on your draft, and one-click formal, casual or simpler rewrites.'],
      ['Ask your documents', 'Ask questions across everything you have written, with links to the sources.'],
    ],
  },
  {
    title: 'Collaboration and teams',
    items: [
      ['Live cursors & follow mode', 'Named cursors, selections, typing and away status; follow anyone around the page.'],
      ['Voice & video calls', 'Call everyone in the document right beside the page you are editing.'],
      ['Comments, suggestions & reactions', 'Threads anchored to text, tracked-change suggestions and emoji reactions.'],
      ['Approval workflow & e-signature', 'Draft, review, approved, with sign-off notes and a drawn signature block.'],
      ['Tasks, calendar & reminders', 'Assign checklist items with due dates; see them on a calendar with reminders.'],
      ['Workspaces & team templates', 'Shared spaces for teams, with templates everyone can start from.'],
      ['Sharing & public pages', 'Invite links with roles and expiry, or publish as a blog post with comments.'],
    ],
  },
  {
    title: 'Personal and accessible',
    items: [
      ['Dark, sepia & dyslexia modes', 'Reading themes and the OpenDyslexic font, saved to your account.'],
      ['Read aloud & reading mode', 'Text-to-speech that highlights each word, and a distraction-free reader.'],
      ['Streaks & goals', 'A daily word goal, writing streaks and a six-month writing calendar.'],
      ['Focus, voice typing & palette', 'Focus and typewriter modes, dictation and a Ctrl+K command palette.'],
      ['Search, folders & export', 'Full-text search, folders, tags, versions, and export to PDF, Word or Markdown.'],
    ],
  },
];

const FEATURE_COUNT = FEATURE_GROUPS.reduce((n, g) => n + g.items.length, 0);

const STEPS = [
  {
    title: 'Every character has an identity',
    body: 'Each inserted character is stamped with a unique id: its author’s site id and a Lamport clock. Positions are named by id (“after bob:12”), never by a fragile index.',
  },
  {
    title: 'One rule orders concurrent typing',
    body: 'An insert is placed after its origin, skipping neighbours with a greater id. Because ids are totally ordered, every replica reaches the same decision, and words typed at the same spot never interleave.',
  },
  {
    title: 'Deletions leave tombstones',
    body: 'Deleted characters are hidden rather than removed, so an edit made concurrently next to a deleted character still finds its place.',
  },
  {
    title: 'State vectors make syncing cheap',
    body: 'Each replica records the latest clock it has seen from every author. On reconnect it receives exactly the operations it missed, and nothing more.',
  },
];

const STACK = ['TypeScript', 'React 19', 'Node.js', 'Express', 'WebSockets', 'PostgreSQL', 'Web Crypto', 'IndexedDB', 'Claude API', 'Vite'];

export function Home() {
  const { user } = useAuth();
  const startGuest = () => navigate(`/d/${newRoomId()}`);

  return (
    <div className="page">
      <SiteHeader />

      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div className="hero-copy">
              <p className="kicker">Real-time collaborative writing</p>
              <h1>Write together. Merge without conflicts.</h1>
              <p className="lede">
                CoWrite is a collaborative document editor in the spirit of Google Docs, with comments, suggestions, version history, an AI co-writer and end-to-end encryption. Its merge engine is a conflict-free
                replicated data type implemented from first principles, with no collaboration libraries, so every edit
                arrives intact, even across slow networks and offline sessions.
              </p>
              <div className="hero-actions">
                {user ? (
                  <Link className="btn btn-primary btn-lg" to="/documents">
                    Go to my documents
                  </Link>
                ) : (
                  <Link className="btn btn-primary btn-lg" to="/signup">
                    Create a free account
                  </Link>
                )}
                <button className="btn btn-outline btn-lg" onClick={startGuest} type="button">
                  Try without signing in
                </button>
              </div>
              <dl className="hero-stats">
                <div>
                  <dt>0</dt>
                  <dd>collaboration libraries</dd>
                </div>
                <div>
                  <dt>24</dt>
                  <dd>collaboration features</dd>
                </div>
                <div>
                  <dt>RGA</dt>
                  <dd>sequence CRDT engine</dd>
                </div>
              </dl>
            </div>
            <figure className="hero-figure" aria-label="Illustration of a shared document with two collaborators">
              <div className="mock-window">
                <div className="mock-bar">
                  <span className="mock-title">Quarterly Report</span>
                  <span className="mock-people">
                    <span className="avatar" style={{ background: '#b4442c' }}>
                      AR
                    </span>
                    <span className="avatar" style={{ background: '#2f5d8a' }}>
                      SK
                    </span>
                  </span>
                </div>
                <div className="mock-page">
                  <p className="mock-h">Quarterly Report</p>
                  <p>
                    Revenue grew steadily across all regions
                    <span className="remote-caret" style={{ ['--peer' as string]: '#b4442c' }}>
                      <span className="remote-caret-label">Aarav</span>
                    </span>
                    , led by strong adoption in the education sector.
                  </p>
                  <p>
                    <mark style={{ background: '#2f5d8a22' }}>Next quarter we will focus on</mark>
                    <span className="remote-caret" style={{ ['--peer' as string]: '#2f5d8a' }}>
                      <span className="remote-caret-label">Sana</span>
                    </span>{' '}
                    reliability and offline support.
                  </p>
                  <p className="mock-line" />
                  <p className="mock-line short" />
                </div>
              </div>
            </figure>
          </div>
        </section>

        <section id="features" className="section">
          <div className="container">
            <header className="section-head">
              <p className="kicker">Features</p>
              <h2>{FEATURE_COUNT} features, one editor</h2>
              <p className="muted">Documents, slides, whiteboards, boards and spreadsheets on one merge engine built from scratch, with AI where it helps.</p>
            </header>
            {FEATURE_GROUPS.map((g) => (
              <div key={g.title} className="feature-group">
                <h3 className="feature-group-title">{g.title}</h3>
                <div className="feature-grid">
                  {g.items.map(([title, body]) => (
                    <article key={title} className="feature">
                      <h4>{title}</h4>
                      <p>{body}</p>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="playground" className="section section-alt">
          <div className="container">
            <header className="section-head">
              <p className="kicker">Live demonstration</p>
              <h2>Try to break it</h2>
              <p className="muted">
                Three simulated collaborators share one document over a deliberately unreliable network. Increase the
                latency, take someone offline, type in several panes at once, and watch every copy converge.
              </p>
            </header>
            <Playground />
          </div>
        </section>

        <section id="how" className="section">
          <div className="container">
            <header className="section-head">
              <p className="kicker">How it works</p>
              <h2>The engineering behind the merge</h2>
              <p className="muted">
                The complete algorithm is about three hundred lines of TypeScript, shared by the browser and the server.
              </p>
            </header>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="step">
                  <span className="step-num">{i + 1}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="arch">
              <h3>System architecture</h3>
              <pre className="arch-diagram">{`Browser (React)                      Node.js server
┌───────────────────────┐   ops    ┌─────────────────────────┐
│ textarea ─diff─► Doc  │ ───────► │ Room: Doc replica       │
│   ▲              │    │ ◄─────── │  • relays ops & cursors │
│   └─ anchors ◄───┘    │ ack/ops  │  • state-vector catch-up│
│ outbox (offline queue)│   (ws)   │  • snapshots, accounts  │
└───────────────────────┘          └─────────────────────────┘`}</pre>
            </div>
          </div>
        </section>

        <section id="about" className="section section-alt">
          <div className="container">
            <header className="section-head">
              <p className="kicker">About</p>
              <h2>About CoWrite</h2>
            </header>
            <div className="about-project">
              <div>
                <p>
                  CoWrite began as a question: how do collaborative editors let many people type into the same sentence at
                  the same moment without locking the document or losing anyone’s work? Instead of using an existing
                  library, I implemented the answer, a Replicated Growable Array (RGA), and built a complete product
                  around it: a WebSocket sync server, presence, offline support, accounts and a document dashboard.
                </p>
                <p>
                  The engine is verified by randomised fuzz tests that run up to four replicas through thousands of
                  concurrent edits, delivered out of order, partially and twice, and check that every copy converges to
                  identical text.
                </p>
              </div>
              <aside className="stack-card">
                <h4>Technology</h4>
                <ul className="tag-list">
                  {STACK.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <a className="btn btn-outline" href={REPO_URL} target="_blank" rel="noreferrer">
                  View source on GitHub
                </a>
              </aside>
            </div>

            <h2 className="about-me-title">About Me</h2>
            <div className="about-me">
              <div className="profile-card">
                <div className="monogram" aria-hidden="true">
                  {AUTHOR.initials}
                </div>
                <h3>{AUTHOR.name}</h3>
                <p className="profile-role">{AUTHOR.role}</p>
                <p className="muted small">{AUTHOR.location}</p>
                <div className="profile-links">
                  <a className="btn btn-primary" href={`mailto:${AUTHOR.email}`}>
                    Email me
                  </a>
                  <a className="btn btn-outline" href={AUTHOR.linkedin} target="_blank" rel="noreferrer">
                    LinkedIn
                  </a>
                  <a className="btn btn-outline" href={AUTHOR.github} target="_blank" rel="noreferrer">
                    GitHub
                  </a>
                </div>
              </div>
              <div className="profile-body">
                {AUTHOR.bio.map((p) => (
                  <p key={p.slice(0, 24)}>{p}</p>
                ))}
                <h4>Skills</h4>
                <ul className="tag-list">
                  {AUTHOR.skills.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>

            <h3 className="projects-title">Selected projects</h3>
            <div className="project-grid">
              {PROJECTS.map((p) => (
                <a key={p.name} className="project" href={p.url} target="_blank" rel="noreferrer">
                  <h4>{p.name}</h4>
                  <p>{p.summary}</p>
                  <span className="project-tags">{p.tags.join(' · ')}</span>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="section">
          <div className="container">
            <div className="contact">
              <div>
                <p className="kicker">Contact</p>
                <h2>Let’s talk</h2>
                <p className="muted">
                  I am open to software engineering roles and internships. For questions about CoWrite, feedback, or
                  opportunities, I would be glad to hear from you.
                </p>
              </div>
              <div className="contact-actions">
                <a className="btn btn-primary btn-lg" href={`mailto:${AUTHOR.email}?subject=Regarding%20CoWrite`}>
                  {AUTHOR.email}
                </a>
                <a className="btn btn-outline btn-lg" href={AUTHOR.linkedin} target="_blank" rel="noreferrer">
                  Connect on LinkedIn
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
