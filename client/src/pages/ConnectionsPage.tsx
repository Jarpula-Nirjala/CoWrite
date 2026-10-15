import { useEffect, useState } from 'react';
import { markdownToTokens } from '../../../shared/rich.ts';
import { api, errorText, timeAgo, type DocMeta } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { ConnectionsSection, GitHubLogo, GoogleLogo, useIntegrations } from '../components/Connections.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Icon, Spinner } from '../components/ui.tsx';
import { createAndOpen } from '../lib/create.ts';
import { navigate, useSearch } from '../router.ts';

type Tab = 'drive' | 'calendar' | 'repos' | 'gists' | 'send';

/** Open Google Drive files, Google Calendar, GitHub repositories and gists inside CoWrite, and send documents back. */
export function ConnectionsPage() {
  const { user, ready } = useAuth();
  const { data, reload } = useIntegrations();
  const search = useSearch();
  const [tab, setTab] = useState<Tab>('drive');
  const just = new URLSearchParams(search).get('connected');

  useEffect(() => {
    document.title = 'Connected apps · CoWrite';
    if (ready && !user) navigate('/signin?next=/connections', { replace: true });
  }, [ready, user]);
  useEffect(() => {
    if (!data) return;
    if (just === 'github' || (!data.google.connected && data.github.connected)) setTab('repos');
  }, [data, just]);

  if (!ready || !user || !data) return <Spinner />;
  const g = data.google.connected;
  const gh = data.github.connected;
  const tabs: { id: Tab; label: string; on: boolean; logo: 'g' | 'gh' | null }[] = [
    { id: 'drive', label: 'Google Drive', on: g, logo: 'g' },
    { id: 'calendar', label: 'Google Calendar', on: g, logo: 'g' },
    { id: 'repos', label: 'GitHub repositories', on: gh, logo: 'gh' },
    { id: 'gists', label: 'GitHub gists', on: gh, logo: 'gh' },
    { id: 'send', label: 'Send a document', on: g || gh, logo: null },
  ];
  return (
    <div className="page">
      <SiteHeader />
      <main className="container connections-page">
        <header className="tools-hero">
          <div>
            <p className="kicker">Connected apps</p>
            <h1>Your Google and GitHub, inside CoWrite</h1>
            <p className="muted">Open Google Docs, Drive files and Calendar events, browse repositories and gists, and send your documents back.</p>
          </div>
        </header>
        {just && <div className="alert success">✓ {just === 'google' ? 'Google' : 'GitHub'} is connected.</div>}
        {!g && !gh ? (
          <ConnectionsSection />
        ) : (
          <>
            <nav className="tpl-tabs">
              {tabs.map((t) => (
                <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} type="button">
                  {t.logo === 'g' ? <GoogleLogo size={16} /> : t.logo === 'gh' ? <GitHubLogo size={16} /> : <Icon name="share" size={15} />} {t.label}
                  {!t.on && <span className="muted small"> · not connected</span>}
                </button>
              ))}
            </nav>
            {(tab === 'drive' || tab === 'calendar') && !g ? (
              <NotConnected name="Google" onDone={reload} />
            ) : (tab === 'repos' || tab === 'gists') && !gh ? (
              <NotConnected name="GitHub" onDone={reload} />
            ) : tab === 'drive' ? (
              <DriveTab />
            ) : tab === 'calendar' ? (
              <CalendarTab />
            ) : tab === 'repos' ? (
              <ReposTab />
            ) : tab === 'gists' ? (
              <GistsTab />
            ) : (
              <SendTab google={g} github={gh} />
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function NotConnected({ name }: { name: string; onDone(): void }) {
  return (
    <div className="keep-empty">
      <span>{name === 'Google' ? <GoogleLogo size={64} /> : <GitHubLogo size={64} />}</span>
      <p className="muted">{name} is not connected yet.</p>
      <a className="btn btn-primary" href="/account#connected">
        Connect {name}
      </a>
    </div>
  );
}

const importText = async (title: string, text: string, csv = false) => {
  const md = csv ? csvToMarkdown(text) : text;
  await createAndOpen(title, 'doc', { tokens: markdownToTokens(md), settings: { theme: 'simple', font: 'sans' } });
};
function csvToMarkdown(csv: string): string {
  const rows = csv
    .trim()
    .split(/\r?\n/)
    .slice(0, 200)
    .map((r) => r.split(',').map((c) => c.replace(/^"|"$/g, '').replace(/\|/g, '/')));
  if (!rows.length) return '';
  const w = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), `|${' --- |'.repeat(w)}`, ...rows.slice(1).map(line)].join('\n');
}

const KIND_ICON: Record<string, string> = { doc: '📄', sheet: '📊', slides: '📽️', pdf: '📕', text: '📃' };

function DriveTab() {
  const [q, setQ] = useState('');
  const [files, setFiles] = useState<{ id: string; name: string; kind: string; modified: string; url: string; owner: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (query = q) => {
    setFiles(null);
    setError(null);
    api<{ files: NonNullable<typeof files> }>(`/integrations/google/files?q=${encodeURIComponent(query)}`).then((r) => setFiles(r.files), (e) => (setFiles([]), setError(errorText(e))));
  };
  useEffect(() => load(''), []);
  const open = async (id: string, kind: string) => {
    setBusy(id);
    setError(null);
    try {
      const r = await api<{ name: string; text: string }>(`/integrations/google/file/${id}`);
      await importText(r.name, r.text, kind === 'sheet');
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };
  return (
    <section>
      <form
        className="tool-row"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <label className="tpl-search">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your Drive" aria-label="Search Drive" />
        </label>
        <span className="muted small">Google Docs, Sheets, Slides and text files, newest first.</span>
      </form>
      {error && <p className="error-text">{error}</p>}
      {!files ? (
        <Spinner />
      ) : !files.length ? (
        <p className="muted">No files found.</p>
      ) : (
        <table className="recent-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="hide-sm">Owner</th>
              <th>Modified</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td>
                  <span className="recent-name">
                    <span className="drive-kind">{KIND_ICON[f.kind] ?? '📃'}</span>
                    <b>{f.name}</b>
                  </span>
                </td>
                <td className="hide-sm">{f.owner}</td>
                <td className="muted">{timeAgo(Date.parse(f.modified))}</td>
                <td className="row-actions">
                  {f.kind !== 'pdf' && (
                    <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void open(f.id, f.kind)} type="button">
                      {busy === f.id ? 'Opening…' : 'Open in CoWrite'}
                    </button>
                  )}
                  <a className="btn btn-text btn-sm" href={f.url} target="_blank" rel="noreferrer">
                    View in Google ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CalendarTab() {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [events, setEvents] = useState<{ id: string; title: string; url: string; allDay: boolean; start: string; end: string; location: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  useEffect(() => {
    const to = new Date(today.getTime() + 30 * 86_400_000);
    api<{ events: NonNullable<typeof events> }>(`/integrations/google/calendar?from=${iso(today)}&to=${iso(to)}`).then((r) => setEvents(r.events), (e) => (setEvents([]), setError(errorText(e))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const copy = async (e: NonNullable<typeof events>[number]) => {
    const start = new Date(e.start);
    const hhmm = (d: Date) => d.toTimeString().slice(0, 5);
    await api('/events', {
      method: 'POST',
      body: { title: e.title, day: e.allDay ? e.start.slice(0, 10) : iso(new Date(start.getTime() - start.getTimezoneOffset() * 60_000)), start: e.allDay ? null : hhmm(start), end: e.allDay ? null : hhmm(new Date(e.end)), notes: [e.location, e.url].filter(Boolean).join('\n'), kind: 'meeting', color: 'blue' },
    }).catch(() => {});
    setAdded(new Set([...added, e.id]));
  };
  return (
    <section>
      <p className="muted">Your next 30 days from Google Calendar. They also appear on the CoWrite <a href="/calendar">Calendar</a> page.</p>
      {error && <p className="error-text">{error}</p>}
      {!events ? (
        <Spinner />
      ) : !events.length ? (
        <p className="muted">No upcoming events.</p>
      ) : (
        <ul className="gcal-list">
          {events.map((e) => {
            const d = new Date(e.start);
            return (
              <li key={e.id}>
                <span className="up-date" style={{ background: '#1a73e8' }}>
                  {d.toLocaleDateString(undefined, { month: 'short' })}
                  <b>{d.getDate()}</b>
                </span>
                <span className="gcal-text">
                  <b>{e.title}</b>
                  <small className="muted">
                    {e.allDay ? 'All day' : `${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${new Date(e.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                    {e.location ? ` · ${e.location}` : ''}
                  </small>
                </span>
                <span className="row-actions">
                  <button className="btn btn-outline btn-sm" disabled={added.has(e.id)} onClick={() => void copy(e)} type="button">
                    {added.has(e.id) ? '✓ Added' : 'Add to CoWrite calendar'}
                  </button>
                  <a className="btn btn-text btn-sm" href={e.url} target="_blank" rel="noreferrer">
                    Open ↗
                  </a>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ReposTab() {
  const [repos, setRepos] = useState<{ fullName: string; name: string; private: boolean; description: string; updatedAt: string; url: string; language: string | null }[] | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [items, setItems] = useState<{ name: string; path: string; type: 'dir' | 'file'; size: number }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ repos: NonNullable<typeof repos> }>('/integrations/github/repos').then((r) => setRepos(r.repos), (e) => (setRepos([]), setError(errorText(e))));
  }, []);
  useEffect(() => {
    if (!repo) return;
    setItems(null);
    api<{ items: NonNullable<typeof items> }>(`/integrations/github/tree?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`).then((r) => setItems(r.items), (e) => (setItems([]), setError(errorText(e))));
  }, [repo, path]);
  const open = async (p: string) => {
    setBusy(p);
    setError(null);
    try {
      const r = await api<{ name: string; text: string }>(`/integrations/github/file?repo=${encodeURIComponent(repo!)}&path=${encodeURIComponent(p)}`);
      const md = /\.(md|markdown|txt)$/i.test(r.name) ? r.text : `# ${r.name}\n\`\`\`${r.name.split('.').pop() ?? ''}\n${r.text}\n\`\`\``;
      await importText(r.name.replace(/\.(md|markdown|txt)$/i, ''), md);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };
  if (error && !repos?.length) return <p className="error-text">{error}</p>;
  if (!repos) return <Spinner />;
  if (!repo)
    return (
      <div className="repo-grid">
        {repos.map((r) => (
          <button key={r.fullName} className="repo-card" onClick={() => (setRepo(r.fullName), setPath(''))} type="button">
            <b>
              {r.private ? '🔒' : '📘'} {r.fullName}
            </b>
            <small className="muted">{r.description || 'No description'}</small>
            <small className="muted">
              {r.language ? `${r.language} · ` : ''}updated {timeAgo(Date.parse(r.updatedAt))}
            </small>
          </button>
        ))}
        {!repos.length && <p className="muted">No repositories yet.</p>}
      </div>
    );
  const crumbs = path ? path.split('/') : [];
  return (
    <section>
      <nav className="crumbs">
        <button className="link-btn" onClick={() => setRepo(null)} type="button">
          All repositories
        </button>
        {' / '}
        <button className="link-btn" onClick={() => setPath('')} type="button">
          {repo}
        </button>
        {crumbs.map((c, i) => (
          <span key={i}>
            {' / '}
            <button className="link-btn" onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))} type="button">
              {c}
            </button>
          </span>
        ))}
      </nav>
      {error && <p className="error-text">{error}</p>}
      {!items ? (
        <Spinner />
      ) : (
        <ul className="batch-list">
          {items.map((it) => (
            <li key={it.path} className="row-between">
              {it.type === 'dir' ? (
                <button className="link-btn" onClick={() => setPath(it.path)} type="button">
                  📁 {it.name}
                </button>
              ) : (
                <span>📄 {it.name}</span>
              )}
              {it.type === 'file' && it.size < 1_000_000 && (
                <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void open(it.path)} type="button">
                  {busy === it.path ? 'Opening…' : 'Open in CoWrite'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GistsTab() {
  const [gists, setGists] = useState<{ id: string; title: string; public: boolean; updatedAt: string; url: string; files: string[] }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ gists: NonNullable<typeof gists> }>('/integrations/github/gists').then((r) => setGists(r.gists), (e) => (setGists([]), setError(errorText(e))));
  }, []);
  const open = async (id: string) => {
    setBusy(id);
    try {
      const r = await api<{ title: string; text: string }>(`/integrations/github/gist/${id}`);
      await importText(r.title, r.text);
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };
  return (
    <section>
      {error && <p className="error-text">{error}</p>}
      {!gists ? (
        <Spinner />
      ) : !gists.length ? (
        <p className="muted">No gists yet. Send a document from the “Send a document” tab to create one.</p>
      ) : (
        <div className="repo-grid">
          {gists.map((g) => (
            <div key={g.id} className="repo-card">
              <b>
                {g.public ? '🌐' : '🔒'} {g.title}
              </b>
              <small className="muted">{g.files.join(', ')}</small>
              <small className="muted">updated {timeAgo(Date.parse(g.updatedAt))}</small>
              <span className="row-actions">
                <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void open(g.id)} type="button">
                  {busy === g.id ? 'Opening…' : 'Open in CoWrite'}
                </button>
                <a className="btn btn-text btn-sm" href={g.url} target="_blank" rel="noreferrer">
                  View ↗
                </a>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SendTab({ google, github }: { google: boolean; github: boolean }) {
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [doc, setDoc] = useState('');
  const [repos, setRepos] = useState<{ fullName: string }[]>([]);
  const [repo, setRepo] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ documents: DocMeta[] }>('/docs').then((r) => (setDocs(r.documents.filter((d) => d.kind === 'doc' && !d.encrypted)), setDoc(r.documents.find((d) => d.kind === 'doc' && !d.encrypted)?.id ?? '')), () => setDocs([]));
    if (github) api<{ repos: { fullName: string }[] }>('/integrations/github/repos').then((r) => (setRepos(r.repos), setRepo(r.repos[0]?.fullName ?? '')), () => {});
  }, [github]);
  const send = async (where: 'google' | 'gist' | 'github') => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<{ url: string; updated?: boolean }>(`/docs/${doc}/send/${where}`, { method: 'POST', body: where === 'github' ? { repo, path } : where === 'gist' ? { public: false } : {} });
      setResult({ url: r.url, text: where === 'google' ? 'Saved as a Google Doc.' : where === 'gist' ? 'Saved as a private gist.' : r.updated ? 'Updated the file on GitHub.' : 'Added the file to GitHub.' });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!docs) return <Spinner />;
  return (
    <section className="send-tab">
      <label className="field">
        <span>Document</span>
        <select className="input" value={doc} onChange={(e) => setDoc(e.target.value)}>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </label>
      <div className="send-grid">
        <div className="send-card">
          <GoogleLogo size={28} />
          <b>Save to Google Docs</b>
          <small className="muted">Creates an editable Google Doc in your Drive.</small>
          <button className="btn btn-primary btn-sm" disabled={!google || !doc || busy} onClick={() => void send('google')} type="button">
            {google ? 'Save to Google Docs' : 'Connect Google first'}
          </button>
        </div>
        <div className="send-card">
          <GitHubLogo size={28} />
          <b>Save as a GitHub gist</b>
          <small className="muted">A private gist with the document as Markdown.</small>
          <button className="btn btn-primary btn-sm" disabled={!github || !doc || busy} onClick={() => void send('gist')} type="button">
            {github ? 'Create gist' : 'Connect GitHub first'}
          </button>
        </div>
        <div className="send-card">
          <GitHubLogo size={28} />
          <b>Commit to a repository</b>
          <select className="input" value={repo} onChange={(e) => setRepo(e.target.value)} disabled={!github}>
            {repos.map((r) => (
              <option key={r.fullName}>{r.fullName}</option>
            ))}
          </select>
          <input className="input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="docs/my-document.md (optional)" disabled={!github} />
          <button className="btn btn-primary btn-sm" disabled={!github || !doc || !repo || busy} onClick={() => void send('github')} type="button">
            Commit Markdown file
          </button>
        </div>
      </div>
      {error && <p className="error-text">{error}</p>}
      {result && (
        <p className="ok-text">
          ✓ {result.text}{' '}
          <a href={result.url} target="_blank" rel="noreferrer">
            Open it ↗
          </a>
        </p>
      )}
    </section>
  );
}
