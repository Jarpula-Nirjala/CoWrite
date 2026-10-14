import { useEffect, useMemo, useRef, useState } from 'react';
import type { Role } from '../../../shared/protocol.ts';
import { markdownToTokens } from '../../../shared/rich.ts';
import { api, errorText, timeAgo } from '../api.ts';
import { Icon } from '../components/ui.tsx';
import { StaticDoc } from '../rich/StaticDoc.tsx';
import type { Lock, Workflow } from './team.ts';

const STEPS = [
  { id: 'draft', label: 'Draft' },
  { id: 'review', label: 'In review' },
  { id: 'approved', label: 'Approved' },
] as const;

/** Approval workflow, signature and section locks. */
export function ReviewPanel(props: {
  docId: string;
  share: string | null;
  role: Role | null;
  registered: boolean;
  signedIn: boolean;
  userId: string | null;
  workflow: Workflow | null;
  locks: Lock[];
  /** The paragraphs covered by the selection, if any. */
  selection: { quote: string } | null;
  onLock(): Promise<void>;
  onUnlock(id: string): Promise<void>;
  onJump(lock: Lock): void;
  onSignature(): void;
  onChanged(): void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = props.workflow?.status ?? 'draft';
  const canEdit = props.role === 'owner' || props.role === 'editor';
  const canReview = props.signedIn && props.role !== 'viewer' && props.role !== null;
  const mine = props.workflow?.approvals.find((a) => a.userId === props.userId);

  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      props.onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!props.registered) return <p className="panel-empty muted">Review, approvals and locks are available for documents saved to an account.</p>;

  return (
    <div className="review">
      <h3 className="ai-h">Approval workflow</h3>
      <ol className="stepper">
        {STEPS.map((s, i) => {
          const at = STEPS.findIndex((x) => x.id === (status === 'changes' ? 'review' : status));
          return (
            <li key={s.id} className={`${i < at ? 'done' : ''} ${i === at ? 'current' : ''}`}>
              <span>{i < at ? '✓' : i + 1}</span>
              {s.id === 'review' && status === 'changes' ? 'Changes requested' : s.label}
            </li>
          );
        })}
      </ol>
      {canEdit && (status === 'draft' || status === 'changes' || status === 'approved') && (
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void call(() => api(`/docs/${props.docId}/workflow`, { method: 'POST', share: props.share, body: { status: 'review' } }))} type="button">
          {status === 'draft' ? 'Send for review' : 'Send for review again'}
        </button>
      )}
      {canEdit && status === 'review' && (
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void call(() => api(`/docs/${props.docId}/workflow`, { method: 'POST', share: props.share, body: { status: 'draft' } }))} type="button">
          Back to draft
        </button>
      )}
      {(status === 'review' || status === 'changes') && canReview && (
        <div className="review-box">
          <label className="field">
            <span>Your decision{mine ? ` (you ${mine.decision === 'approved' ? 'approved' : 'requested changes'})` : ''}</span>
            <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the author" maxLength={500} />
          </label>
          <div className="row-actions">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void call(() => api(`/docs/${props.docId}/approve`, { method: 'POST', share: props.share, body: { decision: 'approved', note } }))} type="button">
              ✓ Approve
            </button>
            <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void call(() => api(`/docs/${props.docId}/approve`, { method: 'POST', share: props.share, body: { decision: 'changes', note } }))} type="button">
              Request changes
            </button>
          </div>
        </div>
      )}
      {!!props.workflow?.approvals.length && (
        <ul className="approvals">
          {props.workflow.approvals.map((a) => (
            <li key={a.userId}>
              <span className={`decision ${a.decision}`}>{a.decision === 'approved' ? '✓ Approved' : '✎ Changes'}</span> <strong>{a.name}</strong> <span className="muted small">{timeAgo(a.at)}</span>
              {a.note && <p className="small">{a.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <button className="btn btn-text btn-sm" onClick={props.onSignature} type="button">
          ✍️ Add a signature block
        </button>
      )}
      {error && <p className="error-text small">{error}</p>}

      <h3 className="ai-h">Locked sections</h3>
      <p className="muted small">Freeze paragraphs so only you (and the owner) can change them. Everyone else sees them greyed out with a lock.</p>
      {canEdit && props.signedIn && (
        <button className="btn btn-outline btn-sm" disabled={busy || !props.selection} onClick={() => void call(props.onLock)} type="button" title={props.selection ? undefined : 'Select the paragraphs to lock first'}>
          <Icon name="lock" size={13} /> {props.selection ? 'Lock the selected paragraphs' : 'Select paragraphs to lock'}
        </button>
      )}
      {!props.locks.length && <p className="panel-empty muted">Nothing is locked.</p>}
      <ul className="lock-list">
        {props.locks.map((l) => (
          <li key={l.id}>
            <button className="link-like" onClick={() => props.onJump(l)} type="button">
              <Icon name="lock" size={12} /> “{l.quote.slice(0, 70) || 'Section'}{l.quote.length > 70 ? '…' : ''}”
            </button>
            <span className="muted small">
              {l.createdName} · {timeAgo(l.createdAt)}
            </span>
            {(l.createdBy === props.userId || props.role === 'owner') && (
              <button className="btn btn-text btn-sm" disabled={busy} onClick={() => void call(() => props.onUnlock(l.id))} type="button">
                Unlock
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A private draft: write a section only you can see, then put it into the document. */
export function DraftPanel(props: { docId: string; share: string | null; serverSide: boolean; canEdit: boolean; onPublish(md: string): void }) {
  const localKey = `cowrite:draft:${props.docId}`;
  const [md, setMd] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<'saved' | 'saving' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (props.serverSide) {
      api<{ md: string }>(`/docs/${props.docId}/draft`, { share: props.share })
        .then((r) => setMd(r.md))
        .catch(() => {})
        .finally(() => setLoaded(true));
    } else {
      try {
        setMd(localStorage.getItem(localKey) ?? '');
      } catch {
        // ignore
      }
      setLoaded(true);
    }
  }, [props.docId, props.share, props.serverSide, localKey]);

  const save = (value: string) => {
    setMd(value);
    setSaved('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (props.serverSide) await api(`/docs/${props.docId}/draft`, { method: 'PUT', share: props.share, body: { md: value } }).catch(() => {});
      else
        try {
          localStorage.setItem(localKey, value);
        } catch {
          // ignore
        }
      setSaved('saved');
    }, 700);
  };

  const tokens = useMemo(() => markdownToTokens(md).map((t, i) => ({ id: ['draft', i + 1] as [string, number], ch: t.ch, attrs: t.a ?? {} })), [md]);
  if (!props.canEdit) return <p className="panel-empty muted">You need edit access to write drafts in this document.</p>;
  return (
    <div className="draft">
      <p className="muted small">
        🔒 Only you can see this draft{props.serverSide ? '' : ' (it is stored on this device)'}. Write a section in private, polish it, then reveal it to everyone in one go. Markdown works: # heading, - list, **bold**.
      </p>
      <textarea className="input draft-input" rows={10} value={md} disabled={!loaded} onChange={(e) => save(e.target.value)} placeholder="Write your private section here…" />
      <span className="muted small">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Draft saved' : ''}</span>
      {md.trim() && (
        <>
          <h4>Preview</h4>
          <div className="draft-preview">
            <StaticDoc tokens={tokens} />
          </div>
          <div className="row-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                props.onPublish(md);
                save('');
              }}
              type="button"
            >
              Reveal in the document
            </button>
            <button className="btn btn-text btn-sm danger" onClick={() => window.confirm('Discard this draft?') && save('')} type="button">
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
