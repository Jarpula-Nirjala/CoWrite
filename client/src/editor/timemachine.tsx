import { useEffect, useMemo, useRef, useState } from 'react';
import { Doc, type Op } from '../../../shared/crdt.ts';
import { formatDate, timeAgo, type Author } from '../api.ts';
import { Icon } from '../components/ui.tsx';
import type { Viewing } from './history.tsx';
import { diffDoc, heatmap, paragraphHistory, revertOps, timeOf, useCheckpoints, type Checkpoint, type Vector } from './team.ts';

type Tab = 'compare' | 'paragraph' | 'people' | 'heat';

const when = (at: number | null) => (at === null ? 'just now' : Date.now() - at < 86_400_000 ? `${new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} (${timeAgo(at)})` : formatDate(at));

/** Features that only a CRDT with full history can offer. */
export function TimeMachinePanel(props: {
  doc: Doc;
  docVersion: number;
  docId: string;
  share: string | null;
  registered: boolean;
  authors: Author[];
  canEdit: boolean;
  /** Token range of the paragraph holding the cursor. */
  block: { start: number; end: number } | null;
  heat: boolean;
  setHeat(on: boolean): void;
  onView(v: Viewing | null): void;
  onApply(ops: Op[]): void;
}) {
  const [tab, setTab] = useState<Tab>('compare');
  const { data } = useCheckpoints(props.docId, props.share, props.registered, Math.floor(props.docVersion / 50));
  const checkpoints = data?.checkpoints ?? [];
  return (
    <div className="history time-machine">
      <div className="tabs full" role="tablist">
        {(
          [
            ['compare', 'Compare'],
            ['paragraph', 'Paragraph'],
            ['people', 'People'],
            ['heat', 'Heatmap'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)} type="button">
            {label}
          </button>
        ))}
      </div>
      {tab === 'compare' && <Compare {...props} checkpoints={checkpoints} />}
      {tab === 'paragraph' && <Paragraph {...props} checkpoints={checkpoints} />}
      {tab === 'people' && <People {...props} checkpoints={checkpoints} />}
      {tab === 'heat' && <Heat {...props} checkpoints={checkpoints} />}
    </div>
  );
}

type Props = Parameters<typeof TimeMachinePanel>[0] & { checkpoints: Checkpoint[] };

// --------------------------------------------------------------- compare

function Compare(props: Props) {
  const points = useMemo(() => [{ at: 0, vector: {} as Vector }, ...props.checkpoints], [props.checkpoints]);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(-1);
  const [stats, setStats] = useState<{ added: number; removed: number } | null>(null);
  const toIndex = to < 0 ? points.length : to;
  const label = (i: number) => (i >= points.length ? 'Now' : i === 0 ? 'Empty document' : when(points[i].at));
  const vec = (i: number) => (i >= points.length ? props.doc.vector : points[i].vector);

  const show = (a: number, b: number) => {
    const r = diffDoc(props.doc, vec(a), vec(b));
    setStats({ added: r.added, removed: r.removed });
    props.onView({ title: `Changes from ${label(a)} to ${label(b)}`, doc: r.doc });
  };
  useEffect(() => () => props.onView(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const quick = (ms: number) => {
    const t = Date.now() - ms;
    let i = points.findIndex((p, k) => k > 0 && p.at >= t);
    if (i < 0) i = points.length - 1;
    setFrom(Math.max(0, i - 1));
    setTo(-1);
    show(Math.max(0, i - 1), points.length);
  };

  if (!props.registered) return <p className="panel-empty muted">Comparing moments needs a saved document. Sign in and create one to use it.</p>;
  return (
    <div className="compare">
      <p className="muted small">Pick any two moments. Text added in between is green; text removed is red and struck through, like a Git diff for prose.</p>
      <div className="row-actions wrap">
        <button className="btn btn-outline btn-sm" onClick={() => quick(3600_000)} type="button">
          Last hour
        </button>
        <button className="btn btn-outline btn-sm" onClick={() => quick(86_400_000)} type="button">
          Last 24 hours
        </button>
        <button className="btn btn-outline btn-sm" onClick={() => quick(7 * 86_400_000)} type="button">
          Last week
        </button>
      </div>
      <label className="field">
        <span>From: {label(from)}</span>
        <input type="range" min={0} max={points.length} value={from} onChange={(e) => setFrom(Math.min(Number(e.target.value), toIndex))} />
      </label>
      <label className="field">
        <span>To: {label(toIndex)}</span>
        <input type="range" min={0} max={points.length} value={toIndex} onChange={(e) => setTo(Math.max(Number(e.target.value), from))} />
      </label>
      <button className="btn btn-primary btn-sm" onClick={() => show(from, toIndex)} type="button">
        Show changes
      </button>
      {stats && (
        <p className="small">
          <span className="diff-add">+{stats.added}</span> characters added, <span className="diff-del">−{stats.removed}</span> removed.
        </p>
      )}
      {points.length <= 1 && <p className="small muted">Moments are recorded once a minute while people edit. Keep writing and come back.</p>}
    </div>
  );
}

// ------------------------------------------------------------- paragraph

function Paragraph(props: Props) {
  const events = useMemo(() => (props.block ? paragraphHistory(props.doc, props.block.start, props.block.end) : []), [props.doc, props.block, props.docVersion]);
  const name = (site: string) => props.authors.find((a) => a.site === site)?.name ?? (site === 'server' ? 'Server' : 'Someone');
  const color = (site: string) => props.authors.find((a) => a.site === site)?.color ?? '#9aa0a6';
  if (!props.block) return <p className="panel-empty muted">Click inside a paragraph to see every edit ever made to it.</p>;
  return (
    <div>
      <p className="muted small">Every change ever made to the paragraph at your cursor, newest first, including text that was later deleted.</p>
      {!events.length && <p className="panel-empty muted">No edits recorded for this paragraph.</p>}
      <ol className="para-history">
        {events.map((e, i) => (
          <li key={i}>
            <span className="dot" style={{ background: color(e.site) }} />
            <div>
              <strong>{name(e.site)}</strong> <span className="muted small">{e.kind === 'typed' ? 'typed' : e.kind === 'deleted' ? 'deleted' : 'changed the formatting'}</span>
              {e.text && <div className={`para-snippet ${e.kind}`}>{e.text.length > 160 ? `${e.text.slice(0, 160)}…` : e.text}</div>}
              <span className="muted small">{when(timeOf(props.checkpoints, e.site, e.clock))}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ----------------------------------------------------------------- people

function People(props: Props) {
  // A person can have several sites (devices, sessions): group them by name.
  const people = useMemo(() => {
    const items = props.doc.rawItems();
    const counts = new Map<string, number>();
    for (const it of items) if (!it.del) counts.set(it.id[0], (counts.get(it.id[0]) ?? 0) + 1);
    const byName = new Map<string, { name: string; color: string; sites: string[]; chars: number }>();
    for (const [site, n] of counts) {
      const a = props.authors.find((x) => x.site === site);
      const key = a?.userId ?? a?.name ?? site;
      const p = byName.get(key) ?? { name: a?.name ?? (site === 'server' ? 'Server' : 'Unknown'), color: a?.color ?? '#9aa0a6', sites: [], chars: 0 };
      p.sites.push(site);
      p.chars += n;
      byName.set(key, p);
    }
    return [...byName.values()].sort((x, y) => y.chars - x.chars);
  }, [props.doc, props.authors, props.docVersion]);
  const [who, setWho] = useState<number | null>(null);
  const [since, setSince] = useState(3600_000);
  const [msg, setMsg] = useState<string | null>(null);
  const total = people.reduce((n, p) => n + p.chars, 0) || 1;
  const person = who === null ? null : people[who];

  const sinceVector = (): Vector => {
    if (since === 0) return {};
    const t = Date.now() - since;
    const cp = [...props.checkpoints].reverse().find((c) => c.at <= t);
    return cp?.vector ?? {};
  };
  const preview = useMemo(() => {
    if (!person) return null;
    const v = sinceVector();
    let ins = 0;
    let del = 0;
    for (const s of person.sites) {
      const e = props.doc.editsBy(s, v);
      ins += e.inserted.length;
      del += e.deleted.filter((t) => (v[t.id[0]] ?? 0) >= t.id[1]).length;
    }
    return { ins, del };
  }, [person, since, props.checkpoints, props.docVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <p className="muted small">Who wrote what. Undo one person’s edits since a moment without touching anyone else’s, or watch only their typing.</p>
      <ul className="people-bars">
        {people.map((p, i) => (
          <li key={p.name + i}>
            <button className={`person-row ${who === i ? 'active' : ''}`} onClick={() => setWho(who === i ? null : i)} type="button">
              <span className="dot" style={{ background: p.color }} />
              <span className="person-name">{p.name}</span>
              <span className="muted small">{Math.round((p.chars / total) * 100)}%</span>
              <span className="bar">
                <span style={{ width: `${(p.chars / total) * 100}%`, background: p.color }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {person && (
        <div className="person-actions">
          <AuthorPlayback doc={props.doc} sites={person.sites} name={person.name} authors={props.authors} onView={props.onView} />
          {props.canEdit && (
            <div className="field">
              <span>Undo {person.name}’s edits made in the</span>
              <div className="row-actions">
                <select className="input" value={since} onChange={(e) => setSince(Number(e.target.value))} aria-label="Since">
                  <option value={600_000}>last 10 minutes</option>
                  <option value={3600_000}>last hour</option>
                  <option value={86_400_000}>last day</option>
                  <option value={7 * 86_400_000}>last week</option>
                  <option value={0}>whole history</option>
                </select>
                <button
                  className="btn btn-outline btn-sm danger"
                  disabled={!preview || preview.ins + preview.del === 0}
                  onClick={() => {
                    if (!window.confirm(`Remove ${preview!.ins} characters ${person.name} typed and restore ${preview!.del} they deleted? Everyone else’s edits stay.`)) return;
                    const r = revertOps(props.doc, person.sites, sinceVector());
                    props.onApply(r.ops);
                    setMsg(`Removed ${r.removed} characters and restored ${r.restored}. Use Undo (Ctrl+Z) to bring them back.`);
                  }}
                  type="button"
                >
                  Undo their edits
                </button>
              </div>
              {preview && (
                <span className="small muted">
                  {preview.ins} characters typed and {preview.del} deleted in that time.
                </span>
              )}
            </div>
          )}
          {msg && <p className="notice small">{msg}</p>}
        </div>
      )}
    </div>
  );
}

/** Replays the whole history but advances only on one person's edits, greying everyone else. */
function AuthorPlayback({ doc, sites, name, authors, onView }: { doc: Doc; sites: string[]; name: string; authors: Author[]; onView(v: Viewing | null): void }) {
  const history = useMemo(() => doc.history(), [doc]);
  const steps = useMemo(() => history.flatMap((op, i) => (sites.includes(op.id[0]) ? [i + 1] : [])), [history, sites]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const replay = useRef<{ doc: Doc; at: number }>({ doc: new Doc('solo'), at: 0 });
  const colors = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of authors) m.set(a.site, sites.includes(a.site) ? a.color : '#c4c7cc');
    m.set('server', '#c4c7cc');
    return m;
  }, [authors, sites]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setStep((s) => (s >= steps.length ? (setPlaying(false), s) : s + 1)), 35);
    return () => clearInterval(t);
  }, [playing, steps.length]);

  useEffect(() => {
    if (!playing && step === 0) return;
    const target = step === 0 ? 0 : steps[step - 1];
    let r = replay.current;
    if (target < r.at) r = replay.current = { doc: new Doc('solo'), at: 0 };
    if (target > r.at) {
      r.doc.apply(history.slice(r.at, target));
      r.at = target;
    }
    onView({ title: `${name}’s typing · ${step} of ${steps.length} edits`, doc: r.doc, colors });
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="field">
      <span>Watch only {name}’s typing</span>
      <div className="row-actions">
        <button className="btn btn-primary btn-sm" onClick={() => (step >= steps.length && setStep(0), setPlaying(!playing))} disabled={!steps.length} type="button">
          <Icon name={playing ? 'pause' : 'play'} size={14} /> {playing ? 'Pause' : 'Play'}
        </button>
        <input type="range" min={0} max={steps.length} value={step} onChange={(e) => (setPlaying(false), setStep(Number(e.target.value)))} aria-label="Playback position" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- heat

function Heat(props: Props) {
  const spots = useMemo(() => heatmap(props.doc), [props.doc, props.docVersion]);
  const text = props.doc.text();
  return (
    <div>
      <p className="muted small">Paragraphs that several people edited at about the same moment glow orange. The CRDT merged all of them without conflicts; the heatmap shows where it worked hardest.</p>
      <label className="check-row">
        <input type="checkbox" checked={props.heat} onChange={(e) => props.setHeat(e.target.checked)} /> Show heatmap on the page
      </label>
      {!spots.length && <p className="panel-empty muted">No simultaneous edits yet. Open the document in two windows and type in the same paragraph to see it.</p>}
      <ol className="heat-list">
        {[...spots]
          .sort((a, b) => b.score - a.score)
          .slice(0, 12)
          .map((s, i) => (
            <li key={i}>
              <span className="heat-dot" style={{ opacity: Math.min(1, 0.3 + s.score / 40) }} />
              <span className="small">
                “{text.slice(s.from, Math.min(s.to, s.from + 60)).replace(/\n/g, ' ').trim()}…” · {s.sites} people · {s.score} overlapping edits
              </span>
            </li>
          ))}
      </ol>
    </div>
  );
}
