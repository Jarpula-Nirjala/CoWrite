import { useAuth } from '../auth.tsx';
import { FeatureShowcase } from '../components/FeatureShowcase.tsx';
import { Bento, Comparison, NumbersStrip, ScrollStory } from '../components/HomeExtras.tsx';
import { Playground } from '../components/Playground.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { AUTHOR, PROJECTS, REPO_URL } from '../content.ts';
import { newRoomId } from '../identity.ts';
import { Link, navigate } from '../router.ts';

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

const STACK = ['TypeScript', 'React 19', 'Node.js', 'Express', 'WebSockets', 'PostgreSQL', 'Web Crypto', 'IndexedDB', 'Gemini API', 'Claude API', 'Vite'];

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
                  <dt>50+</dt>
                  <dd>features</dd>
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
              <h2>50+ features, one editor</h2>
              <p className="muted">Documents, slides, whiteboards, boards and spreadsheets on one merge engine built from scratch, with AI where it helps.</p>
            </header>
            <NumbersStrip />
            <FeatureShowcase />
          </div>
        </section>

        <section id="why" className="section section-alt">
          <div className="container">
            <header className="section-head">
              <p className="kicker">Why CoWrite</p>
              <h2>What Google Docs can’t do</h2>
            </header>
            <div className="why-grid">
              <Comparison />
              <Bento />
            </div>
          </div>
        </section>

        <section id="story" className="section">
          <div className="container">
            <header className="section-head">
              <p className="kicker">See it in action</p>
              <h2>From blank page to finished, together</h2>
            </header>
            <ScrollStory />
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

            <div className="project-strip">
              <span className="projects-label">Other projects</span>
              {PROJECTS.map((p) => (
                <a key={p.name} className="project-chip" href={p.url} target="_blank" rel="noreferrer" title={p.summary}>
                  {p.name}
                  <span aria-hidden>↗</span>
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
