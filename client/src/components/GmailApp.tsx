import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorText } from '../api.ts';
import { markdownToTokens } from '../../../shared/rich.ts';
import { createAndOpen } from '../lib/create.ts';
import { AppLogo } from './AppLogo.tsx';
import { ContactInput } from './ContactInput.tsx';
import { GoogleGate } from './GoogleGate.tsx';
import { Spinner } from './ui.tsx';
import * as ic from '@mdi/js';
import { FileTypeIcon, MIcon } from './MIcon.tsx';

interface Label {
  id: string;
  name: string;
  system: boolean;
  unread: number;
  color: string | null;
}
interface Thread {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: number;
  count: number;
  unread: boolean;
  starred: boolean;
  important: boolean;
  attachment: boolean;
  labels: string[];
}
interface Message {
  id: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: number;
  messageId: string;
  references: string;
  snippet: string;
  labels: string[];
  html: string;
  text: string;
  attachments: { id: string; name: string; mime: string; size: number }[];
}
interface Draft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  key: number;
}

const SYSTEM: { id: string; name: string; icon: string }[] = [
  { id: 'INBOX', name: 'Inbox', icon: ic.mdiInbox },
  { id: 'STARRED', name: 'Starred', icon: ic.mdiStarOutline },
  { id: 'IMPORTANT', name: 'Important', icon: ic.mdiLabelVariantOutline },
  { id: 'SENT', name: 'Sent', icon: ic.mdiSendOutline },
  { id: 'DRAFT', name: 'Drafts', icon: ic.mdiFileOutline },
  { id: 'ALL', name: 'All Mail', icon: ic.mdiEmailMultipleOutline },
  { id: 'SPAM', name: 'Spam', icon: ic.mdiAlertOctagonOutline },
  { id: 'TRASH', name: 'Bin', icon: ic.mdiDeleteOutline },
];

const when = (ms: number) => {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return d.toLocaleDateString();
};
const nameOf = (from: string) => from.replace(/<.*>/, '').replace(/"/g, '').trim() || from;
const emailOf = (from: string) => /<([^>]+)>/.exec(from)?.[1] ?? from;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kb = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** A mail client for the person's real Gmail account: labels, threads, reading, compose, reply and forward. */
export function GmailApp() {
  return (
    <GoogleGate feature="gmail" tab="gmail">
      <Mailbox />
    </GoogleGate>
  );
}

function Mailbox() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [me, setMe] = useState('');
  const [label, setLabel] = useState('INBOX');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [next, setNext] = useState<string | null>(null);
  const [estimate, setEstimate] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [retry, setRetry] = useState(0);

  const loadLabels = useCallback((fresh = false) => api<{ email: string; labels: Label[] }>(`/gmail/labels${fresh ? '?fresh=1' : ''}`).then((r) => (setLabels(r.labels), setMe(r.email)), (e) => setError(errorText(e))), []);
  const page = pages[pages.length - 1];
  const load = useCallback(() => {
    setThreads(null);
    setError(null);
    setSelected(new Set());
    const qs = new URLSearchParams({ label, ...(search ? { q: search } : {}), ...(page ? { page } : {}) });
    api<{ threads: Thread[]; next: string | null; estimate: number }>(`/gmail/threads?${qs}`).then(
      (r) => (setThreads(r.threads), setNext(r.next), setEstimate(r.estimate), setCooldown(0)),
      (e) => {
        // Gmail's per-minute quota: wait it out and load again by ourselves.
        if (e instanceof ApiError && e.status === 429) {
          setCooldown(45);
          setThreads((t) => t ?? []);
        } else (setThreads([]), setError(errorText(e)));
      },
    );
  }, [label, search, page, retry]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => (cooldown === 1 ? (setCooldown(0), setRetry((n) => n + 1)) : setCooldown(cooldown - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  useEffect(() => void loadLabels(), [loadLabels]);
  useEffect(() => load(), [load]);

  const modify = async (ids: string[], body: { add?: string[]; remove?: string[]; action?: 'trash' | 'untrash' }) => {
    await Promise.all(ids.map((id) => api(`/gmail/thread/${id}/modify`, { method: 'POST', body }))).catch((e) => setError(errorText(e)));
  };
  const act = async (ids: string[], what: 'archive' | 'trash' | 'read' | 'unread' | 'spam' | 'inbox') => {
    const body = { archive: { remove: ['INBOX'] }, trash: { action: 'trash' as const }, read: { remove: ['UNREAD'] }, unread: { add: ['UNREAD'] }, spam: { add: ['SPAM'], remove: ['INBOX'] }, inbox: { add: ['INBOX'], remove: ['SPAM', 'TRASH'] } }[what];
    if (what === 'read' || what === 'unread') setThreads((ts) => ts?.map((t) => (ids.includes(t.id) ? { ...t, unread: what === 'unread' } : t)) ?? null);
    else setThreads((ts) => ts?.filter((t) => !ids.includes(t.id)) ?? null);
    await modify(ids, body);
    setSelected(new Set());
    void loadLabels();
  };
  const star = async (t: Thread) => {
    setThreads((ts) => ts?.map((x) => (x.id === t.id ? { ...x, starred: !x.starred } : x)) ?? null);
    await modify([t.id], t.starred ? { remove: ['STARRED'] } : { add: ['STARRED'] });
  };
  const compose = (d: Partial<Draft> = {}) => setDrafts((ds) => [...ds.slice(-2), { to: '', cc: '', bcc: '', subject: '', html: '', ...d, key: Date.now() }]);
  const choose = (id: string) => {
    setLabel(id);
    setPages([null]);
    setOpen(null);
  };

  const userLabels = labels.filter((l) => !l.system);
  const count = (id: string) => labels.find((l) => l.id === id)?.unread ?? 0;
  const from = (pages.length - 1) * 40 + 1;

  return (
    <div className={`gm ${collapsed ? 'gm-collapsed' : ''}`}>
      <header className="gm-top">
        <button className="gm-icon" onClick={() => setCollapsed(!collapsed)} aria-label="Main menu" title="Main menu" type="button">
          <MIcon path={ic.mdiMenu} size={24} />
        </button>
        <span className="gm-brand">
          <AppLogo name="gmail" size={26} /> <b>Gmail</b>
        </span>
        <form
          className="gm-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
            setPages([null]);
            setOpen(null);
          }}
        >
          <MIcon path={ic.mdiMagnify} size={22} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail" aria-label="Search mail" />
          {search && (
            <button onClick={() => (setQ(''), setSearch(''), setPages([null]))} type="button" aria-label="Clear search" title="Clear search">
              <MIcon path={ic.mdiClose} />
            </button>
          )}
        </form>
        <span className="gm-me" title={me}>
          {me ? me[0].toUpperCase() : ''}
        </span>
      </header>
      <aside className="gm-side">
        <button className="gm-compose" onClick={() => compose()} type="button">
          <MIcon path={ic.mdiPencilOutline} size={22} /> <span>Compose</span>
        </button>
        <nav>
          {SYSTEM.map((s) => (
            <button key={s.id} className={label === s.id && !search ? 'on' : ''} onClick={() => (choose(s.id), setSearch(''), setQ(''))} type="button" title={s.name}>
              <span className="gm-ico">
                <MIcon path={label === s.id && !search && s.id === 'INBOX' ? ic.mdiInbox : s.icon} />
              </span>
              <span className="gm-lname">{s.name}</span>
              {count(s.id) > 0 && <b className="gm-count">{count(s.id)}</b>}
            </button>
          ))}
          {userLabels.length > 0 && <p className="gm-sub">Labels</p>}
          {userLabels.map((l) => (
            <button key={l.id} className={label === l.id && !search ? 'on' : ''} onClick={() => choose(l.id)} type="button" title={l.name}>
              <span className="gm-ico">
                <MIcon path={ic.mdiLabel} color={l.color ?? '#9aa0a6'} />
              </span>
              <span className="gm-lname">{l.name}</span>
              {l.unread > 0 && <b className="gm-count">{l.unread}</b>}
            </button>
          ))}
        </nav>
      </aside>
      <main className="gm-main">
        {error && <p className="error-text gm-error">{error}</p>}
        {cooldown > 0 && (
          <div className="gm-cooldown" role="status">
            <MIcon path={ic.mdiClockOutline} size={18} /> Gmail is limiting how fast your mailbox can be read. Loading again in {cooldown} s…
            <button onClick={() => (setCooldown(0), setRetry((n) => n + 1))} type="button">
              Try now
            </button>
          </div>
        )}
        {open ? (
          <ThreadView
            id={open}
            me={me}
            onBack={() => (setOpen(null), load())}
            onAct={async (what) => {
              await act([open], what);
              setOpen(null);
            }}
            onReply={(d) => compose(d)}
          />
        ) : (
          <>
            <div className="gm-bar">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={!!threads?.length && selected.size === threads.length}
                onChange={(e) => setSelected(new Set(e.target.checked ? (threads ?? []).map((t) => t.id) : []))}
              />
              <button className="gm-icon" onClick={() => (load(), void loadLabels(true))} title="Refresh" aria-label="Refresh" type="button">
                <MIcon path={ic.mdiRefresh} />
              </button>
              {selected.size > 0 && (
                <span className="gm-bulk">
                  {label === 'SPAM' || label === 'TRASH' ? (
                    <button className="gm-icon" onClick={() => void act([...selected], 'inbox')} title="Move to Inbox" aria-label="Move to Inbox" type="button">
                      <MIcon path={ic.mdiInboxArrowDownOutline} />
                    </button>
                  ) : (
                    <button className="gm-icon" onClick={() => void act([...selected], 'archive')} title="Archive" aria-label="Archive" type="button">
                      <MIcon path={ic.mdiArchiveArrowDownOutline} />
                    </button>
                  )}
                  {label !== 'SPAM' && (
                    <button className="gm-icon" onClick={() => void act([...selected], 'spam')} title="Report spam" aria-label="Report spam" type="button">
                      <MIcon path={ic.mdiAlertOctagonOutline} />
                    </button>
                  )}
                  <button className="gm-icon" onClick={() => void act([...selected], 'trash')} title="Delete" aria-label="Delete" type="button">
                    <MIcon path={ic.mdiDeleteOutline} />
                  </button>
                  <span className="gm-sep" />
                  <button className="gm-icon" onClick={() => void act([...selected], 'read')} title="Mark as read" aria-label="Mark as read" type="button">
                    <MIcon path={ic.mdiEmailOpenOutline} />
                  </button>
                  <button className="gm-icon" onClick={() => void act([...selected], 'unread')} title="Mark as unread" aria-label="Mark as unread" type="button">
                    <MIcon path={ic.mdiEmailOutline} />
                  </button>
                </span>
              )}
              <span className="gm-pages">
                {threads && threads.length > 0 && `${from}–${from + threads.length - 1} of ${estimate > from + threads.length ? `about ${estimate}` : from + threads.length - 1}`}
                <button className="gm-icon" disabled={pages.length < 2} onClick={() => setPages(pages.slice(0, -1))} aria-label="Newer" title="Newer" type="button">
                  <MIcon path={ic.mdiChevronLeft} />
                </button>
                <button className="gm-icon" disabled={!next} onClick={() => setPages([...pages, next])} aria-label="Older" title="Older" type="button">
                  <MIcon path={ic.mdiChevronRight} />
                </button>
              </span>
            </div>
            {!threads ? (
              <Spinner />
            ) : !threads.length ? (
              cooldown > 0 ? null : <p className="gm-empty">{search ? `No messages matched “${search}”.` : `No conversations in ${SYSTEM.find((x) => x.id === label)?.name ?? labels.find((l) => l.id === label)?.name ?? 'this label'}.`}</p>
            ) : (
              <ul className="gm-list">
                {threads.map((t) => (
                  <li key={t.id} className={`${t.unread ? 'unread' : ''} ${selected.has(t.id) ? 'sel' : ''}`} onClick={() => (setOpen(t.id), t.unread && void act([t.id], 'read'))}>
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => {
                        const n = new Set(selected);
                        if (n.has(t.id)) n.delete(t.id);
                        else n.add(t.id);
                        setSelected(n);
                      }}
                      aria-label="Select"
                    />
                    <button className={`gm-star ${t.starred ? 'on' : ''}`} onClick={(e) => (e.stopPropagation(), void star(t))} aria-label={t.starred ? 'Unstar' : 'Star'} type="button">
                      <MIcon path={t.starred ? ic.mdiStar : ic.mdiStarOutline} color={t.starred ? '#f4b400' : undefined} />
                    </button>
                    <button className={`gm-imp ${t.important ? 'on' : ''}`} onClick={(e) => e.stopPropagation()} aria-label="Important" title={t.important ? 'Important' : 'Not important'} type="button">
                      <MIcon path={t.important ? ic.mdiLabelVariant : ic.mdiLabelVariantOutline} color={t.important ? '#f4b400' : undefined} size={18} />
                    </button>
                    <span className="gm-from">
                      {t.from}
                      {t.count > 1 && <small> {t.count}</small>}
                    </span>
                    <span className="gm-subject">
                      <b>{t.subject}</b> <span className="gm-snippet">— {decodeEntities(t.snippet)}</span>
                    </span>
                    {t.attachment && (
                      <span className="gm-clip">
                        <MIcon path={ic.mdiPaperclip} size={16} />
                      </span>
                    )}
                    <span className="gm-date">{when(t.date)}</span>
                    <span className="gm-hover">
                      <button onClick={(e) => (e.stopPropagation(), void act([t.id], 'archive'))} title="Archive" aria-label="Archive" type="button">
                        <MIcon path={ic.mdiArchiveArrowDownOutline} />
                      </button>
                      <button onClick={(e) => (e.stopPropagation(), void act([t.id], 'trash'))} title="Delete" aria-label="Delete" type="button">
                        <MIcon path={ic.mdiDeleteOutline} />
                      </button>
                      <button onClick={(e) => (e.stopPropagation(), void act([t.id], t.unread ? 'read' : 'unread'))} title={t.unread ? 'Mark as read' : 'Mark as unread'} aria-label={t.unread ? 'Mark as read' : 'Mark as unread'} type="button">
                        <MIcon path={t.unread ? ic.mdiEmailOpenOutline : ic.mdiEmailOutline} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
      <div className="gm-compose-dock">
        {drafts.map((d) => (
          <Compose key={d.key} draft={d} onClose={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))} onSent={() => (setDrafts((ds) => ds.filter((x) => x.key !== d.key)), label === 'SENT' && load())} />
        ))}
      </div>
    </div>
  );
}

const decodeEntities = (s: string) => {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
};

function ThreadView({ id, me, onBack, onAct, onReply }: { id: string; me: string; onBack(): void; onAct(what: 'archive' | 'trash' | 'unread' | 'spam'): void; onReply(d: Partial<Draft>): void }) {
  const [thread, setThread] = useState<{ subject: string; messages: Message[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    api<{ subject: string; messages: Message[] }>(`/gmail/thread/${id}`).then(
      (r) => (setThread(r), setExpanded(new Set([r.messages[r.messages.length - 1]?.id]))),
      (e) => setError(errorText(e)),
    );
  }, [id]);
  if (error) return <p className="error-text gm-error">{error}</p>;
  if (!thread) return <Spinner />;
  const last = thread.messages[thread.messages.length - 1];
  const quoteOf = (m: Message) => `<br><br><div>On ${esc(new Date(m.date).toLocaleString())}, ${esc(m.from)} wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${m.html || esc(m.text).replace(/\n/g, '<br>')}</blockquote>`;
  const reply = (m: Message, all: boolean) => {
    const others = all ? [m.to, m.cc].join(',').split(',').map((x) => x.trim()).filter((x) => x && !x.includes(me)) : [];
    onReply({
      to: [emailOf(m.from), ...others.map(emailOf)].filter((x, i, a) => x && a.indexOf(x) === i && x !== me).join(', '),
      subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`,
      html: quoteOf(m),
      threadId: id,
      inReplyTo: m.messageId,
      references: m.references,
    });
  };
  const forward = (m: Message) =>
    onReply({
      subject: /^fwd:/i.test(thread.subject) ? thread.subject : `Fwd: ${thread.subject}`,
      html: `<br><br>---------- Forwarded message ---------<br>From: ${esc(m.from)}<br>Date: ${esc(new Date(m.date).toLocaleString())}<br>Subject: ${esc(m.subject)}<br>To: ${esc(m.to)}<br><br>${m.html || esc(m.text).replace(/\n/g, '<br>')}`,
    });
  const toDoc = () =>
    void createAndOpen(thread.subject, 'doc', {
      tokens: markdownToTokens(
        `# ${thread.subject}\n${thread.messages.map((m) => `**${nameOf(m.from)}** · ${new Date(m.date).toLocaleString()}\n\n${(m.text || m.html.replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '')).trim()}`).join('\n\n---\n\n')}`,
      ),
      settings: { theme: 'simple', font: 'sans' },
    });
  return (
    <div className="gm-thread">
      <div className="gm-bar">
        <button className="gm-icon" onClick={onBack} title="Back to Inbox" aria-label="Back" type="button">
          <MIcon path={ic.mdiArrowLeft} />
        </button>
        <button className="gm-icon" onClick={() => onAct('archive')} title="Archive" aria-label="Archive" type="button">
          <MIcon path={ic.mdiArchiveArrowDownOutline} />
        </button>
        <button className="gm-icon" onClick={() => onAct('spam')} title="Report spam" aria-label="Report spam" type="button">
          <MIcon path={ic.mdiAlertOctagonOutline} />
        </button>
        <button className="gm-icon" onClick={() => onAct('trash')} title="Delete" aria-label="Delete" type="button">
          <MIcon path={ic.mdiDeleteOutline} />
        </button>
        <span className="gm-sep" />
        <button className="gm-icon" onClick={() => onAct('unread')} title="Mark as unread" aria-label="Mark as unread" type="button">
          <MIcon path={ic.mdiEmailOutline} />
        </button>
        <button className="gm-icon" onClick={toDoc} title="Save as CoWrite document" aria-label="Save as CoWrite document" type="button">
          <MIcon path={ic.mdiFileDocumentEditOutline} />
        </button>
      </div>
      <h2 className="gm-thread-title">{thread.subject}</h2>
      {thread.messages.map((m) => {
        const isOpen = expanded.has(m.id);
        return (
          <article key={m.id} className={`gm-msg ${isOpen ? 'open' : ''}`}>
            <header onClick={() => setExpanded((s) => new Set(s.has(m.id) && m !== last ? [...s].filter((x) => x !== m.id) : [...s, m.id]))}>
              <span className="gm-avatar">{nameOf(m.from)[0]?.toUpperCase()}</span>
              <span className="gm-msg-who">
                <span>
                  <b>{nameOf(m.from)}</b> <small className="muted">&lt;{emailOf(m.from)}&gt;</small>
                </span>
                <small className="muted">{isOpen ? `to ${m.to}${m.cc ? `, cc ${m.cc}` : ''}` : decodeEntities(m.snippet)}</small>
              </span>
              <small className="muted">{new Date(m.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small>
            </header>
            {isOpen && (
              <>
                <MailBody html={m.html} text={m.text} />
                {m.attachments.length > 0 && (
                  <div className="gm-atts">
                    {m.attachments.map((a) => (
                      <a key={a.id} className="gm-att" href={`/api/gmail/attachment/${m.id}/${a.id}?name=${encodeURIComponent(a.name)}&mime=${encodeURIComponent(a.mime)}`}>
                        <FileTypeIcon mime={a.mime} name={a.name} />
                        <span>{a.name}</span>
                        <small className="muted">{kb(a.size)}</small>
                      </a>
                    ))}
                  </div>
                )}
                <div className="gm-replybar">
                  <button onClick={() => reply(m, false)} type="button">
                    <MIcon path={ic.mdiReply} size={18} /> Reply
                  </button>
                  <button onClick={() => reply(m, true)} type="button">
                    <MIcon path={ic.mdiReplyAll} size={18} /> Reply all
                  </button>
                  <button onClick={() => forward(m)} type="button">
                    <MIcon path={ic.mdiShare} size={18} /> Forward
                  </button>
                </div>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}

/** The email as its sender designed it, in a sandbox: no scripts, links open in a new tab. */
function MailBody({ html, text }: { html: string; text: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(200);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0;padding:8px 4px;font:14px/1.5 Arial,Helvetica,sans-serif;color:#202124;word-wrap:break-word}img{max-width:100%;height:auto}pre{white-space:pre-wrap;font:inherit}blockquote{color:#5f6368}</style></head><body>${html || `<pre>${esc(text)}</pre>`}</body></html>`;
  const fit = () => {
    const d = ref.current?.contentDocument;
    if (d) setH(Math.min(4000, Math.max(80, d.documentElement.scrollHeight + 4)));
  };
  return <iframe ref={ref} className="gm-body" title="Email" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height: h }} onLoad={() => (fit(), setTimeout(fit, 400), setTimeout(fit, 1500))} />;
}

function Compose({ draft, onClose, onSent }: { draft: Draft; onClose(): void; onSent(): void }) {
  const [d, setD] = useState(draft);
  const [showCc, setShowCc] = useState(!!draft.cc || !!draft.bcc);
  const [min, setMin] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const body = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (body.current && draft.html) body.current.innerHTML = draft.html;
    if (body.current && draft.html) {
      const r = document.createRange();
      r.setStart(body.current, 0);
      r.collapse(true);
    }
  }, [draft.html]);
  const fmt = (cmd: string, arg?: string) => {
    body.current?.focus();
    document.execCommand(cmd, false, arg);
  };
  const toBase64 = (f: File) =>
    new Promise<string>((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1] ?? '');
      r.onerror = () => no(r.error);
      r.readAsDataURL(f);
    });
  const send = async (asDraft: boolean) => {
    setBusy(asDraft ? 'Saving…' : 'Sending…');
    setError(null);
    try {
      if (files.reduce((n, f) => n + f.size, 0) > 15_000_000) throw new Error('Attachments must be under 15 MB in total.');
      const attachments = await Promise.all(files.map(async (f) => ({ name: f.name, mime: f.type || 'application/octet-stream', data: await toBase64(f) })));
      await api('/gmail/send', { method: 'POST', body: { ...d, html: body.current?.innerHTML ?? '', attachments, draft: asDraft } });
      onSent();
    } catch (e) {
      setError(e instanceof Error && !('status' in e) ? e.message : errorText(e));
      setBusy(null);
    }
  };
  return (
    <section className={`gm-composer ${min ? 'min' : ''}`} aria-label="New message">
      <header onClick={() => setMin(!min)}>
        <b>{d.subject || 'New message'}</b>
        <span>
          <button onClick={(e) => (e.stopPropagation(), setMin(!min))} aria-label="Minimise" title="Minimise" type="button">
            <MIcon path={ic.mdiWindowMinimize} size={16} />
          </button>
          <button onClick={(e) => (e.stopPropagation(), onClose())} aria-label="Save & close" title="Save & close" type="button">
            <MIcon path={ic.mdiClose} size={16} />
          </button>
        </span>
      </header>
      {!min && (
        <>
          <label className="gm-field">
            <span>To</span>
            <ContactInput value={d.to} onValue={(to) => setD({ ...d, to })} aria-label="To" />
            {!showCc && (
              <button className="gm-ccbtn" onClick={() => setShowCc(true)} type="button">
                Cc Bcc
              </button>
            )}
          </label>
          {showCc && (
            <>
              <label className="gm-field">
                <span>Cc</span>
                <ContactInput value={d.cc} onValue={(cc) => setD({ ...d, cc })} aria-label="Cc" />
              </label>
              <label className="gm-field">
                <span>Bcc</span>
                <ContactInput value={d.bcc} onValue={(bcc) => setD({ ...d, bcc })} aria-label="Bcc" />
              </label>
            </>
          )}
          <label className="gm-field">
            <input value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} placeholder="Subject" aria-label="Subject" />
          </label>
          <div ref={body} className="gm-editor" contentEditable suppressContentEditableWarning aria-label="Message body" role="textbox" aria-multiline />
          {files.length > 0 && (
            <div className="gm-files">
              {files.map((f, i) => (
                <span key={i}>
                  <FileTypeIcon mime={f.type} name={f.name} size={16} /> {f.name} <small>{kb(f.size)}</small>
                  <button onClick={() => setFiles(files.filter((_, k) => k !== i))} aria-label="Remove" type="button">
                    <MIcon path={ic.mdiClose} size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
          <footer>
            <button className="btn btn-primary btn-sm gm-send" disabled={!!busy || !d.to.trim()} onClick={() => void send(false)} type="button">
              {busy ?? 'Send'}
            </button>
            <span className="gm-fmt">
              <button onClick={() => fmt('bold')} title="Bold" type="button">
                <MIcon path={ic.mdiFormatBold} />
              </button>
              <button onClick={() => fmt('italic')} title="Italic" type="button">
                <MIcon path={ic.mdiFormatItalic} />
              </button>
              <button onClick={() => fmt('underline')} title="Underline" type="button">
                <MIcon path={ic.mdiFormatUnderline} />
              </button>
              <button onClick={() => fmt('insertUnorderedList')} title="Bulleted list" type="button">
                <MIcon path={ic.mdiFormatListBulleted} />
              </button>
              <button onClick={() => fmt('insertOrderedList')} title="Numbered list" type="button">
                <MIcon path={ic.mdiFormatListNumbered} />
              </button>
              <button
                onClick={() => {
                  const url = prompt('Link address');
                  if (url) fmt('createLink', url);
                }}
                title="Insert link"
                type="button"
              >
                <MIcon path={ic.mdiLink} />
              </button>
              <button onClick={() => fileRef.current?.click()} title="Attach files" type="button">
                <MIcon path={ic.mdiPaperclip} />
              </button>
              <input ref={fileRef} type="file" hidden multiple onChange={(e) => (setFiles([...files, ...(e.target.files ?? [])]), (e.target.value = ''))} />
            </span>
            <button className="btn btn-text btn-sm" disabled={!!busy} onClick={() => void send(true)} type="button">
              Save draft
            </button>
            <button className="gm-icon" onClick={onClose} title="Discard draft" aria-label="Discard" type="button">
              <MIcon path={ic.mdiDeleteOutline} />
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
