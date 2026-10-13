import { newRoomId } from '../identity.ts';
import { Playground } from '../components/Playground.tsx';
import { Brand } from '../components/Brand.tsx';
import { navigate } from '../router.ts';

const REPO_URL = 'https://github.com/Jarpula-Nirjala/CoWrite';

const STEPS = [
  {
    title: 'Every character gets an identity',
    body: 'Each insert is stamped with a unique id: the author’s site id plus a Lamport clock. The id never changes, so a position can be named as “after character bob:12” instead of a fragile number like 37.',
  },
  {
    title: 'One rule orders concurrent typing',
    body: 'An insert lands after its origin, skipping any neighbours with a greater id. Ids are totally ordered, so every replica makes the same choice, and words typed at the same spot never interleave.',
  },
  {
    title: 'Deletes leave tombstones',
    body: 'A deleted character is hidden, not removed. Someone who typed after it concurrently still finds their anchor, so no edit is lost, whichever order the messages arrive in.',
  },
  {
    title: 'State vectors make offline cheap',
    body: 'Each replica tracks the highest clock it has seen from every author. On reconnect it sends that vector and gets back exactly the operations it missed. Edits made offline replay the same way.',
  },
];

export function Landing() {
  const start = () => navigate(`/d/${newRoomId()}`);

  return (
    <div className="landing">
      <header className="topbar">
        <Brand />
        <nav className="topnav">
          <a href="#playground">Playground</a>
          <a href="#how">How it works</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </header>

      <section className="hero">
        <p className="eyebrow">Real-time collaborative editor</p>
        <h1>Write together. Merge without conflicts.</h1>
        <p className="lede">
          CoWrite is a Google-Docs-style editor built on a sequence CRDT written from scratch, with no Yjs and no
          Automerge. Edits merge correctly under latency, reordering and offline work, and every replica ends up with the
          same text.
        </p>
        <div className="hero-actions">
          <button className="btn primary" onClick={start} type="button">
            Start a live document
          </button>
          <a className="btn" href="#playground">
            Try the playground
          </a>
        </div>
        <ul className="facts">
          <li>
            <strong>RGA</strong> sequence CRDT
          </li>
          <li>
            <strong>0</strong> CRDT dependencies
          </li>
          <li>
            <strong>Offline</strong> edits sync on reconnect
          </li>
          <li>
            <strong>Live</strong> cursors &amp; presence
          </li>
        </ul>
      </section>

      <section id="playground" className="section">
        <div className="section-head">
          <h2>Break it yourself</h2>
          <p className="muted">
            Three replicas run in this page and talk through a simulated network. Turn up the latency, take someone
            offline, type in several panes at once, then watch them converge.
          </p>
        </div>
        <Playground />
      </section>

      <section id="how" className="section">
        <div className="section-head">
          <h2>How it works</h2>
          <p className="muted">The whole merge algorithm fits in about 300 lines of TypeScript, shared by browser and server.</p>
        </div>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="step">
              <span className="step-num">{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="arch">
          <h3>Architecture</h3>
          <pre className="arch-diagram">{`Browser (React)                      Node server
┌───────────────────────┐   ops    ┌─────────────────────────┐
│ textarea ─diff─► Doc  │ ───────► │ Room: Doc replica       │
│   ▲              │    │ ◄─────── │  • relays ops & cursors │
│   └─ anchors ◄───┘    │ ack/ops  │  • state-vector catch-up│
│ outbox (offline queue)│   (ws)   │  • JSON snapshots       │
└───────────────────────┘          └─────────────────────────┘`}</pre>
        </div>
        <div className="cta">
          <h3>See it with real people</h3>
          <p className="muted">Open a document, share the link, and edit together from different devices.</p>
          <button className="btn primary" onClick={start} type="button">
            Start a live document
          </button>
        </div>
      </section>

      <footer className="footer muted small">
        CoWrite · React, WebSockets, Node · CRDT built from scratch ·{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          source
        </a>
      </footer>
    </div>
  );
}
