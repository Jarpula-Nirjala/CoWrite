import { useEffect, useMemo, useRef, useState } from 'react';
import { Doc, type Op, type Snapshot, type Token } from '../../../shared/crdt.ts';
import type { OpCipher } from '../../../shared/sync-client.ts';
import { api, errorText, formatDate, timeAgo, type DocDetails, type Version } from '../api.ts';
import { Icon } from '../components/ui.tsx';
import { Link } from '../router.ts';
import { recordReplay } from './timeline.ts';

export interface Viewing {
  title: string;
  doc: Doc;
  /** Present when the view can be restored into the live document. */
  restore?: () => void;
  /** Colour text by author (site → colour). */
  colors?: Map<string, string>;
  /** Side-by-side comparison: a second document shown on the right. */
  side?: { doc: Doc; leftTitle: string; rightTitle: string };
}

type Tab = 'versions' | 'replay' | 'branches';

export function HistoryPanel(props: {
  doc: Doc;
  docVersion: number;
  docId: string;
  share: string | null;
  cipher: OpCipher | null;
  meta: DocDetails | null;
  versions: Version[];
  canEdit: boolean;
  signedIn: boolean;
  online: boolean;
  onSaveVersion(name: string): Promise<void>;
  onDeleteVersion(id: string): Promise<void>;
  onView(v: Viewing | null): void;
  onRestore(tokens: Token[]): void;
  onFork(): Promise<void>;
  title?: string;
  colors?: Map<string, string>;
}) {
  const [tab, setTab] = useState<Tab>('versions');
  return (
    <div className="history">
      <div className="tabs full" role="tablist">
        {(['versions', 'replay', 'branches'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)} type="button">
            {t === 'versions' ? 'Versions' : t === 'replay' ? 'Replay' : 'Branches'}
          </button>
        ))}
      </div>
      {tab === 'versions' && <Versions {...props} />}
      {tab === 'replay' && <Replay {...props} />}
      {tab === 'branches' && <Branches {...props} />}
    </div>
  );
}

// ---------------------------------------------------------------- versions

function Versions(props: Parameters<typeof HistoryPanel>[0]) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = async (v: Version) => {
    try {
      const r = await api<{ name: string; snapshot: Snapshot }>(`/docs/${props.docId}/versions/${v.id}`, { share: props.share });
      const ops = props.cipher ? await props.cipher.decryptOps(r.snapshot.ops) : r.snapshot.ops;
      const doc = new Doc('preview');
      doc.apply(ops);
      props.onView({
        title: `Version: ${v.name}`,
        doc,
        restore: props.canEdit
          ? () => {
              props.onRestore(doc.tokens());
              props.onView(null);
            }
          : undefined,
      });
    } catch (e) {
      setError(errorText(e, (e as Error).message));
    }
  };

  return (
    <div>
      {props.canEdit && (
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await props.onSaveVersion(name);
              setName('');
              setError(null);
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this version, e.g. First draft" maxLength={80} aria-label="Version name" />
          <button className="btn btn-primary btn-sm" disabled={busy || !props.online} type="submit">
            Save
          </button>
        </form>
      )}
      {error && <p className="error-text small">{error}</p>}
      {!props.versions.length && <p className="panel-empty muted">No saved versions yet. Save one before big changes so you can always go back.</p>}
      <ul className="version-list">
        {props.versions.map((v) => (
          <li key={v.id}>
            <div>
              <strong>{v.name}</strong>
              <span className="muted small">
                {v.authorName} · {timeAgo(v.createdAt)} · {v.size.toLocaleString()} characters
              </span>
            </div>
            <div className="row-actions">
              <button className="btn btn-text btn-sm" onClick={() => void preview(v)} type="button">
                View
              </button>
              {props.canEdit && (
                <button className="btn btn-text btn-sm danger" onClick={() => void props.onDeleteVersion(v.id)} type="button" aria-label={`Delete ${v.name}`}>
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ replay

/**
 * Time travel: every character and deletion carries a Lamport clock, and
 * Lamport order is causal, so replaying the history op by op rebuilds the
 * document exactly as it grew – including concurrent typing.
 */
function Replay(props: Parameters<typeof HistoryPanel>[0]) {
  const history = useMemo<Op[]>(() => props.doc.history(), [props.doc, props.docVersion]);
  const [step, setStep] = useState(history.length);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const replay = useRef<{ doc: Doc; at: number }>({ doc: new Doc('replay'), at: 0 });

  const frame = (target: number) => {
    let r = replay.current;
    if (target < r.at) r = replay.current = { doc: new Doc('replay'), at: 0 };
    if (target > r.at) {
      r.doc.apply(history.slice(r.at, target));
      r.at = target;
    }
    return r.doc;
  };

  useEffect(() => {
    const doc = frame(step);
    props.onView({
      title: `Replay · step ${step.toLocaleString()} of ${history.length.toLocaleString()}`,
      doc,
      restore:
        props.canEdit && step < history.length
          ? () => {
              props.onRestore(doc.tokens());
              props.onView(null);
            }
          : undefined,
    });
    // Only the slider drives the view: new edits arriving must not pull the
    // user back into replay after they returned to the live document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => () => props.onView(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setStep((s) => {
        const next = Math.min(history.length, s + speed);
        if (next >= history.length) setPlaying(false);
        return next;
      });
    }, 40);
    return () => clearInterval(t);
  }, [playing, speed, history.length]);

  return (
    <div className="replay">
      <p className="muted small">Watch the document being written, keystroke by keystroke, by everyone who worked on it.</p>
      <input
        type="range"
        className="replay-slider"
        min={0}
        max={history.length}
        value={step}
        onChange={(e) => {
          setPlaying(false);
          setStep(Number(e.target.value));
        }}
        aria-label="Replay position"
      />
      <div className="row-between">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => {
            if (step >= history.length) setStep(0);
            setPlaying(!playing);
          }}
          type="button"
        >
          <Icon name={playing ? 'pause' : 'play'} size={14} /> {playing ? 'Pause' : 'Play'}
        </button>
        <label className="small">
          Speed{' '}
          <select className="input select-sm" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            <option value={1}>1×</option>
            <option value={4}>4×</option>
            <option value={16}>16×</option>
            <option value={64}>64×</option>
          </select>
        </label>
      </div>
      <p className="small muted">
        Step {step.toLocaleString()} of {history.length.toLocaleString()} operations.
      </p>
      <VideoExport history={history} title={props.title ?? 'Document'} colors={props.colors ?? new Map()} />
    </div>
  );
}

/** Records the replay as a video file (WebM) you can share. */
function VideoExport({ history, title, colors }: { history: Op[]; title: string; colors: Map<string, string> }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(20);
  const supported = typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  if (!supported) return null;
  return (
    <div className="video-export">
      <h4>Time-lapse video</h4>
      <p className="small muted">Export the replay as a video, each person’s text in their colour.</p>
      <div className="row-actions">
        <select className="input select-sm" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="Video length" disabled={progress !== null}>
          <option value={10}>10 seconds</option>
          <option value={20}>20 seconds</option>
          <option value={40}>40 seconds</option>
        </select>
        <button
          className="btn btn-outline btn-sm"
          disabled={progress !== null || !history.length}
          onClick={async () => {
            setProgress(0);
            try {
              const blob = await recordReplay(history, title, colors, { seconds, onProgress: setProgress });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'replay'} - replay.webm`;
              a.click();
            } finally {
              setProgress(null);
            }
          }}
          type="button"
        >
          <Icon name="download" size={14} /> {progress === null ? 'Export video' : `Recording… ${Math.round(progress * 100)}%`}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- branches

function Branches(props: Parameters<typeof HistoryPanel>[0]) {
  const { meta } = props;
  const [preview, setPreview] = useState<{ parentTitle: string; toParent: { inserts: number; deletes: number }; fromParent: { inserts: number; deletes: number } } | null>(null);
  const [forks, setForks] = useState<{ id: string; title: string; ownerName: string; updatedAt: number }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hash = window.location.hash;

  useEffect(() => {
    if (!meta) return;
    if (meta.parentId) {
      api<typeof preview>(`/docs/${props.docId}/merge-preview`, { share: props.share }).then(setPreview, () => setPreview(null));
    }
    api<{ forks: typeof forks }>(`/docs/${props.docId}/forks`, { share: props.share }).then((r) => setForks(r.forks), () => {});
  }, [meta, props.docId, props.share, props.docVersion]);

  const act = async (path: 'merge' | 'pull') => {
    setBusy(true);
    try {
      const r = await api<{ applied: { inserts: number; deletes: number } }>(`/docs/${props.docId}/${path}`, { method: 'POST', share: props.share });
      const n = r.applied.inserts + r.applied.deletes;
      setMessage(n ? `Done: ${r.applied.inserts} insertions and ${r.applied.deletes} deletions ${path === 'merge' ? 'merged into the original' : 'pulled from the original'}.` : 'Already up to date.');
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!meta) return <p className="panel-empty muted">Branching is available for documents saved to an account. Sign in and create a document to fork and merge.</p>;

  return (
    <div className="branches">
      <p className="muted small">
        Fork this document to make your own copy, rewrite it freely, then merge it back. Both copies share the same character ids, so the merge engine combines them
        automatically, like Git for prose but with no merge conflicts.
      </p>
      {props.signedIn && (
        <button className="btn btn-outline btn-sm" disabled={busy || !props.online} onClick={() => void props.onFork()} type="button">
          <Icon name="branch" size={14} /> Fork this document
        </button>
      )}
      {meta.parentId && (
        <section className="merge-box">
          <h4>This is a fork</h4>
          <p className="small">
            Forked from{' '}
            <Link to={`/d/${meta.parentId}${hash}`}>{meta.parentTitle ?? 'the original document'}</Link>.
          </p>
          {preview && (
            <ul className="small">
              <li>
                Your changes not yet in the original: <strong>{preview.toParent.inserts}</strong> insertions, <strong>{preview.toParent.deletes}</strong> deletions
              </li>
              <li>
                New changes in the original: <strong>{preview.fromParent.inserts}</strong> insertions, <strong>{preview.fromParent.deletes}</strong> deletions
              </li>
            </ul>
          )}
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act('merge')} type="button">
              Merge into original
            </button>
            <button className="btn btn-outline btn-sm" disabled={busy || !props.canEdit} onClick={() => void act('pull')} type="button">
              Pull latest from original
            </button>
          </div>
        </section>
      )}
      {message && <p className="small notice">{message}</p>}
      {meta.parentId && (
        <button
          className="btn btn-outline btn-sm"
          onClick={async () => {
            try {
              const r = await api<{ parentTitle: string; items: { ch: string; attrs: Record<string, unknown>; p: boolean; f: boolean }[] }>(`/docs/${props.docId}/fork-compare`, { share: props.share });
              const left = new Doc('left');
              const right = new Doc('right');
              left.insertTokens(
                0,
                r.items.filter((x) => x.p).map((x) => ({ ch: x.ch, a: !x.f && x.ch !== '\n' ? { ...x.attrs, bg: '#fbd5d2', s: true, color: '#9b1c1c' } : x.attrs })),
              );
              right.insertTokens(
                0,
                r.items.filter((x) => x.f).map((x) => ({ ch: x.ch, a: !x.p && x.ch !== '\n' ? { ...x.attrs, bg: '#c9f2d2' } : x.attrs })),
              );
              props.onView({ title: 'Compare with the original', doc: left, side: { doc: right, leftTitle: `Original: ${r.parentTitle}`, rightTitle: 'This fork' } });
            } catch (e) {
              setMessage(errorText(e));
            }
          }}
          type="button"
        >
          Compare side by side
        </button>
      )}
      <BranchTree docId={props.docId} share={props.share} version={props.docVersion} />
      {forks.length > 0 && (
        <section>
          <h4>Forks of this document</h4>
          <ul className="version-list">
            {forks.map((f) => (
              <li key={f.id}>
                <div>
                  <Link to={`/d/${f.id}${hash}`}>{f.title}</Link>
                  <span className="muted small">
                    {f.ownerName} · {formatDate(f.updatedAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface TreeNode {
  id: string;
  parentId: string | null;
  title: string;
  ownerName: string;
  updatedAt: number;
  canOpen: boolean;
}

/** The family tree of this document and all its forks. */
function BranchTree({ docId, share, version }: { docId: string; share: string | null; version: number }) {
  const [data, setData] = useState<{ current: string; nodes: TreeNode[] } | null>(null);
  useEffect(() => {
    api<{ current: string; nodes: TreeNode[] }>(`/docs/${docId}/tree`, { share }).then(setData, () => setData(null));
  }, [docId, share, Math.floor(version / 200)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data || data.nodes.length < 2) return null;
  const children = new Map<string | null, TreeNode[]>();
  const ids = new Set(data.nodes.map((n) => n.id));
  for (const n of data.nodes) {
    const parent = n.parentId && ids.has(n.parentId) ? n.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), n]);
  }
  const hash = window.location.hash;
  const render = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) ?? []).map((n) => (
      <li key={n.id} className={n.id === data.current ? 'current' : ''}>
        <span className="tree-node" style={{ paddingLeft: depth * 16 }}>
          <span className="tree-branch">{depth ? '└' : '●'}</span>
          {n.canOpen ? <Link to={`/d/${n.id}${hash}`}>{n.title}</Link> : <span className="muted">{n.title}</span>}
          <span className="muted small">
            {n.ownerName} · {timeAgo(n.updatedAt)}
          </span>
        </span>
        {children.has(n.id) && <ul>{render(n.id, depth + 1)}</ul>}
      </li>
    ));
  return (
    <section className="branch-tree">
      <h4>Branch explorer</h4>
      <ul>{render(null, 0)}</ul>
    </section>
  );
}
