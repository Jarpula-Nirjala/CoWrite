import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Doc } from '../../../shared/crdt.ts';
import type { ChatMessage } from '../../../shared/protocol.ts';
import type { SyncClient } from '../../../shared/sync-client.ts';
import { timeAgo, type Author, type Comment, type Person, type Suggestion } from '../api.ts';
import { Avatar, Icon } from '../components/ui.tsx';
import { easeLabel, textStats } from '../lib/text.ts';

// ------------------------------------------------------------- mentions

/** A textarea that suggests @usernames from the document's people. */
export function MentionInput({
  value,
  onChange,
  onSubmit,
  people,
  placeholder,
  label,
  rows = 2,
}: {
  value: string;
  onChange(v: string): void;
  onSubmit(): void;
  people: Person[];
  placeholder: string;
  label: string;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const matches = query === null ? [] : people.filter((p) => p.username.startsWith(query.toLowerCase()) || p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5);

  const detect = (v: string, caret: number) => {
    const m = /(?:^|\s)@([a-z0-9-]{0,30})$/i.exec(v.slice(0, caret));
    setQuery(m ? m[1] : null);
    setIndex(0);
  };
  const pick = (p: Person) => {
    const el = ref.current!;
    const caret = el.selectionEnd;
    const before = value.slice(0, caret).replace(/@([a-z0-9-]{0,30})$/i, `@${p.username} `);
    onChange(before + value.slice(caret));
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') return (e.preventDefault(), setIndex((index + 1) % matches.length));
      if (e.key === 'ArrowUp') return (e.preventDefault(), setIndex((index - 1 + matches.length) % matches.length));
      if (e.key === 'Enter' || e.key === 'Tab') return (e.preventDefault(), pick(matches[index]));
      if (e.key === 'Escape') return setQuery(null);
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };
  return (
    <div className="mention-wrap">
      <textarea
        ref={ref}
        className="input"
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionEnd);
        }}
        onKeyDown={onKey}
      />
      {matches.length > 0 && (
        <ul className="mention-list" role="listbox">
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === index}>
              <button type="button" onMouseDown={(e) => (e.preventDefault(), pick(p))} className={i === index ? 'active' : ''}>
                <Avatar name={p.name} src={p.avatar} size={22} /> {p.name} <span className="muted small">@{p.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const mentionsIn = (text: string, people: Person[]) => {
  const names = new Set(people.map((p) => p.username));
  return [...text.matchAll(/@([a-z0-9-]{3,30})/gi)].map((m) => m[1].toLowerCase()).filter((u) => names.has(u));
};

const Empty = ({ children }: { children: ReactNode }) => <p className="panel-empty muted">{children}</p>;

// --------------------------------------------------------------- outline

export function OutlinePanel({ headings, onJump }: { headings: { level: number; text: string; at: number }[]; onJump(at: number): void }) {
  if (!headings.length) return <Empty>Headings you add appear here as a clickable table of contents. Use the style menu, Ctrl+Alt+1–3, or type “# ”.</Empty>;
  return (
    <nav className="outline" aria-label="Document outline">
      {headings.map((h) => (
        <button key={h.at} className={`outline-item level-${h.level}`} onClick={() => onJump(h.at)} type="button">
          {h.text || 'Untitled heading'}
        </button>
      ))}
    </nav>
  );
}

// -------------------------------------------------------------- comments

export function CommentsPanel(props: {
  comments: Comment[];
  activeId: string | null;
  setActive(id: string | null): void;
  canComment: boolean;
  selectionQuote: string;
  people: Person[];
  userId: string | null;
  isOwner: boolean;
  positions: Map<string, number>;
  onAdd(body: string, mentions: string[]): Promise<void>;
  onReply(parentId: string, body: string, mentions: string[]): Promise<void>;
  onResolve(id: string, resolved: boolean): void;
  onDelete(id: string): void;
  onJump(id: string): void;
}) {
  const { comments, activeId, setActive, canComment, selectionQuote, people } = props;
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roots = comments
    .filter((c) => !c.parentId && (showResolved || !c.resolved))
    .sort((a, b) => (props.positions.get(a.id) ?? 1e9) - (props.positions.get(b.id) ?? 1e9));
  const replies = (id: string) => comments.filter((c) => c.parentId === id);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft.trim()) return;
    try {
      await props.onAdd(draft.trim(), mentionsIn(draft, people));
      setDraft('');
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="comments">
      {canComment && (
        <form className="comment-new" onSubmit={submit}>
          {selectionQuote ? (
            <blockquote className="quote">“{selectionQuote.slice(0, 160)}{selectionQuote.length > 160 ? '…' : ''}”</blockquote>
          ) : (
            <p className="muted small">Select text in the document to comment on it.</p>
          )}
          <MentionInput value={draft} onChange={setDraft} onSubmit={() => void submit()} people={people} placeholder="Add a comment… use @ to mention" label="New comment" />
          {error && <p className="error-text small">{error}</p>}
          <button className="btn btn-primary btn-sm" disabled={!selectionQuote || !draft.trim()} type="submit">
            Comment
          </button>
        </form>
      )}
      <label className="check small">
        <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved
      </label>
      {!roots.length && <Empty>No comments yet.</Empty>}
      {roots.map((c) => (
        <article
          key={c.id}
          className={`comment ${c.id === activeId ? 'active' : ''} ${c.resolved ? 'resolved' : ''}`}
          onClick={() => {
            setActive(c.id);
            props.onJump(c.id);
          }}
        >
          <header>
            <span className="dot" style={{ background: c.color }} />
            <strong>{c.authorName}</strong>
            <span className="muted small">{timeAgo(c.createdAt)}</span>
          </header>
          {c.quote && <blockquote className="quote">“{c.quote.slice(0, 120)}{c.quote.length > 120 ? '…' : ''}”</blockquote>}
          {props.positions.get(c.id) === undefined && !c.resolved && <p className="muted small">The commented text was deleted.</p>}
          <p className="comment-body">{c.body}</p>
          {replies(c.id).map((r) => (
            <div key={r.id} className="reply">
              <strong>{r.authorName}</strong> <span className="muted small">{timeAgo(r.createdAt)}</span>
              <p className="comment-body">{r.body}</p>
              {(r.authorId === props.userId || props.isOwner) && r.authorId !== null && (
                <button className="link-button small" onClick={() => props.onDelete(r.id)} type="button">
                  Delete
                </button>
              )}
            </div>
          ))}
          {canComment && c.id === activeId && (
            <div className="reply-box" onClick={(e) => e.stopPropagation()}>
              <MentionInput
                value={reply[c.id] ?? ''}
                onChange={(v) => setReply({ ...reply, [c.id]: v })}
                onSubmit={async () => {
                  const body = (reply[c.id] ?? '').trim();
                  if (!body) return;
                  await props.onReply(c.id, body, mentionsIn(body, people));
                  setReply({ ...reply, [c.id]: '' });
                }}
                people={people}
                placeholder="Reply…"
                label="Reply"
                rows={1}
              />
            </div>
          )}
          {canComment && (
            <footer onClick={(e) => e.stopPropagation()}>
              <button className="link-button small" onClick={() => props.onResolve(c.id, !c.resolved)} type="button">
                {c.resolved ? 'Reopen' : 'Resolve'}
              </button>
              {((c.authorId !== null && c.authorId === props.userId) || props.isOwner) && (
                <button className="link-button small danger" onClick={() => props.onDelete(c.id)} type="button">
                  Delete
                </button>
              )}
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}

// ----------------------------------------------------------- suggestions

export function SuggestionsPanel(props: {
  suggestions: Suggestion[];
  doc: Doc;
  canSuggest: boolean;
  canResolve: boolean;
  suggestMode: boolean;
  setSuggestMode(v: boolean): void;
  onResolve(s: Suggestion, accept: boolean): void;
  onJump(s: Suggestion): void;
}) {
  const { suggestions, doc } = props;
  const preview = (s: Suggestion) => {
    const ranges = doc.rangesOf(new Set(s.keys));
    const text = doc.text();
    return ranges.map((r) => text.slice(r.from, r.to)).join(' … ');
  };
  const visible = suggestions.filter((s) => s.status === 'open').map((s) => ({ s, text: preview(s) })).filter((x) => x.text);
  return (
    <div className="suggestions">
      {props.canSuggest && (
        <label className="switch block">
          <input type="checkbox" checked={props.suggestMode} onChange={(e) => props.setSuggestMode(e.target.checked)} />
          <span>Suggesting mode {props.suggestMode ? 'on' : 'off'}</span>
        </label>
      )}
      <p className="muted small">
        In suggesting mode your insertions are underlined and deletions are struck through until {props.canResolve ? 'someone with edit access' : 'an editor'} accepts or
        rejects them.
      </p>
      {!visible.length && <Empty>No open suggestions.</Empty>}
      {visible.map(({ s, text }) => (
        <article key={s.id} className="suggestion" onClick={() => props.onJump(s)}>
          <header>
            <span className="dot" style={{ background: s.color }} />
            <strong>{s.authorName}</strong>
            <span className="muted small">{s.kind === 'insert' ? 'suggested adding' : 'suggested deleting'}</span>
          </header>
          <p className={s.kind === 'insert' ? 'sugg-ins-text' : 'sugg-del-text'}>{text.slice(0, 200)}</p>
          {props.canResolve && !s.id.startsWith('local-') && (
            <footer onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-primary btn-sm" onClick={() => props.onResolve(s, true)} type="button">
                Accept
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => props.onResolve(s, false)} type="button">
                Reject
              </button>
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ chat

export function ChatPanel({ messages, onSend, canChat, people, myName }: { messages: ChatMessage[]; onSend(body: string): void; canChat: boolean; people: Person[]; myName: string }) {
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);
  const send = () => {
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft('');
  };
  return (
    <div className="chat">
      <div className="chat-list" ref={list}>
        {!messages.length && <Empty>Say hello. Messages are visible to everyone in this document.</Empty>}
        {messages.map((m) => (
          <div key={m.id} className={m.authorName === myName ? 'chat-msg mine' : 'chat-msg'}>
            <span className="chat-meta">
              <span className="dot" style={{ background: m.color }} />
              <strong>{m.authorName}</strong> <span className="muted small">{timeAgo(m.createdAt)}</span>
            </span>
            <p>{m.body}</p>
          </div>
        ))}
      </div>
      {canChat ? (
        <MentionInput value={draft} onChange={setDraft} onSubmit={send} people={people} placeholder="Message… (Enter to send)" label="Chat message" />
      ) : (
        <p className="muted small">Chat is available while you are online.</p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- stats

export function StatsPanel(props: {
  text: string;
  doc: Doc;
  authors: Author[];
  goal: number | null;
  canSetGoal: boolean;
  onSetGoal(goal: number | null): void;
  sessionStartWords: number;
}) {
  const s = useMemo(() => textStats(props.text), [props.text]);
  const [goalDraft, setGoalDraft] = useState(String(props.goal ?? ''));
  useEffect(() => setGoalDraft(String(props.goal ?? '')), [props.goal]);
  const byAuthor = useMemo(() => {
    const names = new Map(props.authors.map((a) => [a.site, a]));
    const totals = new Map<string, { name: string; color: string; chars: number }>();
    for (const run of props.doc.runs()) {
      const a = names.get(run.site);
      const key = a?.userId ?? a?.name ?? run.site;
      const t = totals.get(key) ?? { name: a?.name ?? (run.site === 'seed' ? 'Template' : 'Unknown'), color: a?.color ?? '#9aa0a6', chars: 0 };
      t.chars += run.text.length;
      totals.set(key, t);
    }
    return [...totals.values()].sort((x, y) => y.chars - x.chars);
  }, [props.doc, props.authors, props.text]);
  const total = byAuthor.reduce((n, a) => n + a.chars, 0) || 1;
  const session = Math.max(0, s.words - props.sessionStartWords);
  const goal = props.goal;

  return (
    <div className="stats">
      <dl className="stat-grid">
        <div>
          <dt>Words</dt>
          <dd>{s.words.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Characters</dt>
          <dd>{s.characters.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Reading time</dt>
          <dd>{s.readingMinutes < 1 ? '< 1 min' : `${Math.round(s.readingMinutes)} min`}</dd>
        </div>
        <div>
          <dt>Sentences</dt>
          <dd>{s.sentences.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Paragraphs</dt>
          <dd>{s.paragraphs.toLocaleString()}</dd>
        </div>
        <div>
          <dt>This session</dt>
          <dd>+{session.toLocaleString()} words</dd>
        </div>
      </dl>
      <section>
        <h4>Readability</h4>
        {s.readingEase === null ? (
          <p className="muted small">Write at least 30 words to see a readability score.</p>
        ) : (
          <p>
            <strong>{Math.round(s.readingEase)}</strong> / 100 · {easeLabel(s.readingEase)} <span className="muted small">(Flesch reading ease)</span>
          </p>
        )}
      </section>
      <section>
        <h4>Word goal</h4>
        {goal ? (
          <>
            <div className="progress" role="progressbar" aria-valuenow={Math.min(100, Math.round((s.words / goal) * 100))} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${Math.min(100, (s.words / goal) * 100)}%` }} />
            </div>
            <p className="small">
              {s.words.toLocaleString()} of {goal.toLocaleString()} words ({Math.min(100, Math.round((s.words / goal) * 100))}%)
            </p>
          </>
        ) : (
          <p className="muted small">No goal set.</p>
        )}
        {props.canSetGoal && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(goalDraft);
              props.onSetGoal(Number.isInteger(n) && n > 0 ? n : null);
            }}
          >
            <input className="input" type="number" min={1} placeholder="e.g. 1500" value={goalDraft} onChange={(e) => setGoalDraft(e.target.value)} aria-label="Word goal" />
            <button className="btn btn-outline btn-sm" type="submit">
              Set goal
            </button>
          </form>
        )}
      </section>
      <section>
        <h4>Who wrote what</h4>
        {byAuthor.map((a) => (
          <div key={a.name + a.color} className="author-row">
            <span className="dot" style={{ background: a.color }} />
            <span className="author-name">{a.name}</span>
            <span className="bar">
              <span style={{ width: `${(a.chars / total) * 100}%`, background: a.color }} />
            </span>
            <span className="muted small">{Math.round((a.chars / total) * 100)}%</span>
          </div>
        ))}
        {!byAuthor.length && <p className="muted small">Nothing written yet.</p>}
      </section>
    </div>
  );
}

// ------------------------------------------------------- network chaos

export function NetworkPanel({ client, manualOffline, setOffline }: { client: SyncClient; manualOffline: boolean; setOffline(v: boolean): void }) {
  const [latency, setLatency] = useState(client.latency);
  const [jitter, setJitter] = useState(client.jitter);
  const vector = client.doc.vector;
  return (
    <div className="network">
      <p className="muted small">
        Make this connection deliberately bad and watch the document stay consistent. Delays apply to everything this tab sends and receives.
      </p>
      <label className="field">
        <span>
          Added latency: <strong>{latency} ms</strong> each way
        </span>
        <input
          type="range"
          min={0}
          max={5000}
          step={100}
          value={latency}
          onChange={(e) => {
            client.latency = Number(e.target.value);
            setLatency(client.latency);
          }}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={jitter}
          onChange={(e) => {
            client.jitter = e.target.checked;
            setJitter(e.target.checked);
          }}
        />{' '}
        Random jitter
      </label>
      <label className="switch block">
        <input type="checkbox" checked={manualOffline} onChange={(e) => setOffline(e.target.checked)} />
        <span>Disconnect this tab</span>
      </label>
      <dl className="stat-grid compact">
        <div>
          <dt>Status</dt>
          <dd className={`status-text ${client.status}`}>{client.status}</dd>
        </div>
        <div>
          <dt>Unsynced ops</dt>
          <dd>{client.pending}</dd>
        </div>
        <div>
          <dt>Messages in flight</dt>
          <dd>{client.stats.inFlight}</dd>
        </div>
        <div>
          <dt>Waiting for deps</dt>
          <dd>{client.doc.pendingCount}</dd>
        </div>
        <div>
          <dt>Ops sent</dt>
          <dd>{client.stats.sentOps}</dd>
        </div>
        <div>
          <dt>Ops received</dt>
          <dd>{client.stats.receivedOps}</dd>
        </div>
        <div>
          <dt>Characters</dt>
          <dd>{client.doc.length}</dd>
        </div>
        <div>
          <dt>Tombstones</dt>
          <dd>{client.doc.size - client.doc.length}</dd>
        </div>
      </dl>
      <h4>State vector</h4>
      <p className="muted small">The latest clock this tab has seen from each author (site). On reconnect it is sent to the server, which replies with exactly the missing operations.</p>
      <table className="vector">
        <tbody>
          {Object.entries(vector)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([site, clock]) => (
              <tr key={site}>
                <td>
                  <code>{site}</code>
                  {site === client.doc.site && <span className="muted small"> (this tab)</span>}
                </td>
                <td>{clock}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <p className="muted small">
        <Icon name="lock" size={14} /> Site id <code>{client.doc.site}</code>
      </p>
    </div>
  );
}
