import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Glyph } from './Glyph.tsx';

/** True once the element has scrolled into view (stays true). */
function useSeen<T extends Element>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const n = ref.current;
    if (!n || seen) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold });
    io.observe(n);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen] as const;
}

// ---------------------------------------------------------------- numbers

const NUMBERS: [number, string, string][] = [
  [0, '', 'collaboration libraries'],
  [50, '+', 'features'],
  [175, '+', 'automated tests'],
  [5, '', 'editors in one app'],
  [7, '', 'colour themes'],
];

function CountUp({ to, run }: { to: number; run: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run) return;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1200);
      setN(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, run]);
  return <>{n}</>;
}

export function NumbersStrip() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div className="numbers" ref={ref}>
      {NUMBERS.map(([n, suffix, label]) => (
        <div key={label} className="number">
          <strong>
            <CountUp to={n} run={seen} />
            {suffix}
          </strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- comparison

const ROWS: [string, boolean | string, boolean | string][] = [
  ['Real-time editing with live cursors', true, true],
  ['Slides, whiteboard, kanban and sheets in one app', 'Separate apps', true],
  ['Compare any two moments, Git-style', false, true],
  ['Undo one person’s edits only', false, true],
  ['Branch a document and merge it back', false, true],
  ['Keeps syncing peer-to-peer if the server is down', false, true],
  ['End-to-end encryption', false, true],
  ['Free AI on your own Gemini key', false, true],
  ['Flashcards and quizzes from your notes', false, true],
];

export function Comparison() {
  const [ref, seen] = useSeen<HTMLDivElement>(0.2);
  const cell = (v: boolean | string) => (v === true ? <span className="tick">✓</span> : v === false ? <span className="cross">—</span> : <span className="partial">{v}</span>);
  return (
    <div className={`compare-strip ${seen ? 'seen' : ''}`} ref={ref}>
      <div className="cmp-head">
        <span />
        <span>Google Docs</span>
        <span className="us">CoWrite</span>
      </div>
      {ROWS.map(([label, a, b], i) => (
        <div key={label} className="cmp-row" style={{ '--d': `${i * 0.12}s` } as CSSProperties}>
          <span>{label}</span>
          <span>{cell(a)}</span>
          <span className="us">{cell(b)}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ bento

const TILES: { icon: string; title: string; text: string; size: 'wide' | 'tall' | 'big' | '' }[] = [
  { icon: '🧬', title: 'A merge engine written from scratch', text: 'Every character and object has an identity, so edits from anyone, anywhere, in any order, end up identical.', size: 'big' },
  { icon: '🕰️', title: 'Time machine', text: 'Compare moments, replay, undo one person.', size: 'tall' },
  { icon: '📡', title: 'Works without a server', text: 'WebRTC peer-to-peer sync.', size: '' },
  { icon: '✨', title: 'Free AI', text: 'Your own Gemini key, your own quota.', size: '' },
  { icon: '🔒', title: 'Private by design', text: 'End-to-end encryption and section locks.', size: '' },
  { icon: '🎞️', title: 'Five editors', text: 'Documents, slides, whiteboards, kanban boards and spreadsheets, all on one merge engine.', size: 'wide' },
];

export function Bento() {
  const [lit, setLit] = useState(0);
  const [ref, seen] = useSeen<HTMLDivElement>(0.2);
  useEffect(() => {
    if (!seen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setLit((n) => (n + 1) % TILES.length), 1600);
    return () => clearInterval(t);
  }, [seen]);
  return (
    <div className="bento" ref={ref}>
      {TILES.map((t, i) => (
        <article key={t.title} className={`bento-tile ${t.size} ${i === lit ? 'lit' : ''}`} onMouseEnter={() => setLit(i)}>
          <span className="bento-icon">
            <Glyph e={t.icon} size={26} />
          </span>
          <h4>{t.title}</h4>
          <p>{t.text}</p>
        </article>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ scroll story

const STEPS = [
  { title: 'Start from a template', text: 'Pick a diary, a resume or a pitch deck. The page is designed before you type a word.' },
  { title: 'Invite your team', text: 'Everyone types at once with named cursors. Nothing is ever locked or lost.' },
  { title: 'Discuss in place', text: 'Comments, reactions and suggestions stay attached to the words they are about.' },
  { title: 'Let AI help', text: 'The AI joins as a collaborator and writes in live. Keep it or undo it.' },
  { title: 'Look back in time', text: 'Compare any two moments, or replay the whole document being written.' },
];

/** As you scroll the steps, the mock editor beside them changes to show each one. */
export function ScrollStory() {
  const [step, setStep] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    for (const n of refs.current) if (n) io.observe(n);
    return () => io.disconnect();
  }, []);
  return (
    <div className="story">
      <div className="story-steps">
        {STEPS.map((s, i) => (
          <div key={s.title} ref={(n) => void (refs.current[i] = n)} data-step={i} className={`story-step ${i === step ? 'on' : ''}`}>
            <span className="story-n">{i + 1}</span>
            <div>
              <h4>{s.title}</h4>
              <p>{s.text}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="story-stage" aria-hidden>
        <div className={`mock mock-${step}`}>
          <div className="mock-bar">
            <i />
            <i />
            <i />
            <span>Launch plan</span>
            <span className="mock-avatars">
              <b style={{ background: '#e06666' }}>A</b>
              <b style={{ background: '#3d85c6' }}>R</b>
              <b style={{ background: '#6aa84f' }}>M</b>
            </span>
          </div>
          <div className="mock-page">
            <span className="mock-h">Launch plan</span>
            <span className="mock-p">
              We ship <mark className="mock-comment">on Friday</mark> with the new design.
              <span className="mock-cursor r">Ravi</span>
            </span>
            <span className="mock-p">
              Owners: <span className="mock-old">Asha</span> <span className="mock-new">Asha and Meera</span>
              <span className="mock-cursor m">Meera</span>
            </span>
            <span className="mock-ai">
              <Glyph e="✨" size={14} /> Summary: launch Friday, Meera owns QA, Ravi ships the release notes.</span>
            <span className="mock-react">👍 3 🎉 1</span>
            <span className="mock-bubble">Ravi: can we say Thursday?</span>
          </div>
          <div className="mock-slider">
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
