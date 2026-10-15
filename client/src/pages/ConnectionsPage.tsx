import { ContactInput } from '../components/ContactInput.tsx';
import { allowUrl, pickFromDrive, type GoogleFeature } from '../lib/google.ts';
import { aiDeck } from '../lib/proTemplates.ts';
import { useEffect, useState } from 'react';
import { markdownToTokens } from '../../../shared/rich.ts';
import { api, errorText, timeAgo, type DocMeta } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { ConnectionsSection, GitHubLogo, GoogleLogo, useIntegrations } from '../components/Connections.tsx';
import { AppLogo, type AppLogoName } from '../components/AppLogo.tsx';
import { GmailApp } from '../components/GmailApp.tsx';
import { DriveApp } from '../components/DriveApp.tsx';
import { GCalendarApp } from '../components/GCalendarApp.tsx';
import { TasksApp } from '../components/TasksApp.tsx';
import { GitHubApp } from '../components/GitHubApp.tsx';
import { YouTubeApp } from '../components/YouTubeApp.tsx';
import { useWindows, type WindowApp } from '../components/Windows.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Icon, Spinner } from '../components/ui.tsx';
import * as ic from '@mdi/js';
import { FileTypeIcon, MIcon } from '../components/MIcon.tsx';
import { FileDirectoryFillIcon, FileIcon, LockIcon, RepoIcon } from '@primer/octicons-react';
import { createAndOpen } from '../lib/create.ts';
import { navigate, useSearch } from '../router.ts';

type Tab = 'drive' | 'calendar' | 'gmail' | 'youtube' | 'tasks' | 'repos' | 'send';
type Feature = GoogleFeature;

/** Open Google Drive files, Google Calendar, and your GitHub inside CoWrite, and send documents back. */
export function ConnectionsPage() {
  const { user, ready } = useAuth();
  const { data, reload } = useIntegrations();
  const windows = useWindows();
  const search = useSearch();
  const [tab, setTab] = useState<Tab>('drive');
  const just = new URLSearchParams(search).get('connected');

  useEffect(() => {
    document.title = 'Connected apps · CoWrite';
    if (ready && !user) navigate('/signin?next=/connections', { replace: true });
  }, [ready, user]);
  useEffect(() => {
    if (!data) return;
    const want = new URLSearchParams(search).get('tab') as Tab | null;
    if (want) setTab(want);
    else if (just === 'github' || (!data.google.connected && data.github.connected)) setTab('repos');
  }, [data, just, search]);

  if (!ready || !user || !data) return <Spinner />;
  const g = data.google.connected;
  const gh = data.github.connected;
  const tabs: { id: Tab; label: string; on: boolean; logo: AppLogoName | null; win?: WindowApp }[] = [
    { id: 'gmail', label: 'Gmail', on: g, logo: 'gmail', win: 'gmail' },
    { id: 'drive', label: 'Drive', on: g, logo: 'drive', win: 'drive' },
    { id: 'calendar', label: 'Calendar', on: g, logo: 'calendar', win: 'calendar' },
    { id: 'youtube', label: 'YouTube', on: g, logo: 'youtube', win: 'youtube' },
    { id: 'tasks', label: 'Tasks', on: g, logo: 'tasks', win: 'tasks' },
    { id: 'repos', label: 'GitHub', on: gh, logo: 'github', win: 'github' },
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
            <p className="muted">Open Google Docs, Drive files and Calendar events, work in your GitHub repositories, and send your documents back.</p>
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
                  {t.logo ? <AppLogo name={t.logo} size={18} /> : <Icon name="share" size={15} />} {t.label}
                  {!t.on && <span className="muted small"> · not connected</span>}
                </button>
              ))}
            </nav>
            {tabs.find((t) => t.id === tab)?.win && (
              <div className="win-open-row">
                <button className="btn btn-outline btn-sm" onClick={() => windows.open(tabs.find((t) => t.id === tab)!.win!)} type="button">
                  <MIcon path={ic.mdiDockWindow} size={18} /> Open in a window
                </button>
                <span className="muted small">Floating windows stay open while you move around CoWrite; drag, resize, minimise or maximise them.</span>
              </div>
            )}
            {['drive', 'calendar', 'gmail', 'youtube', 'tasks'].includes(tab) && !g ? (
              <NotConnected name="Google" onDone={reload} />
            ) : tab === 'repos' && !gh ? (
              <NotConnected name="GitHub" onDone={reload} />
            ) : tab === 'drive' ? (
              <div className="app-embed">
                <DriveApp />
              </div>
            ) : tab === 'calendar' ? (
              <div className="app-embed">
                <GCalendarApp />
              </div>
            ) : tab === 'gmail' ? (
              <div className="app-embed">
                <GmailApp />
              </div>
            ) : tab === 'youtube' ? (
              <div className="app-embed">
                <YouTubeApp />
              </div>
            ) : tab === 'tasks' ? (
              <div className="app-embed">
                <TasksApp />
              </div>
            ) : tab === 'repos' ? (
              <div className="app-embed">
                <GitHubApp />
              </div>

            ) : (
              <SendTab google={g} github={gh} features={data.google.features} />
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

const KIND_MIME: Record<string, string> = { doc: 'application/vnd.google-apps.document', sheet: 'application/vnd.google-apps.spreadsheet', slides: 'application/vnd.google-apps.presentation', pdf: 'application/pdf', text: 'text/plain' };

function DriveTab({ sheets, picker }: { sheets: boolean; picker: boolean }) {
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
      if (kind === 'sheet' && sheets) {
        // A real CoWrite spreadsheet, formulas included.
        const r = await api<{ title: string; rows: string[][] }>(`/integrations/google/sheets/${id}`);
        const col = (c: number) => (c < 26 ? String.fromCharCode(65 + c) : String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + (c % 26)));
        const objects = r.rows.flatMap((row, ri) => row.map((v, ci) => ({ key: `cell:${col(ci)}${ri + 1}`, fields: { v, ...(ri === 0 ? { b: true } : {}) } as Record<string, unknown> }))).filter((o) => o.fields.v !== '');
        await createAndOpen(r.title, 'sheet', { tokens: [], objects });
        return;
      }
      if (kind === 'slides') {
        // The presentation's words, laid out on a CoWrite design.
        const r = await api<{ title: string; slides: { title: string; bullets: string[]; notes: string }[] }>(`/integrations/google/slides/${id}`);
        const [first, ...rest] = r.slides;
        const outline = {
          title: first?.title || r.title,
          subtitle: first?.bullets.join(' · ') ?? '',
          theme: 'growth',
          cover: 'office',
          slides: rest.map((s) => ({ layout: s.bullets.length ? 'title-content' : 'section', title: s.title, bullets: s.bullets, notes: s.notes, photo: 'office' })),
        };
        await createAndOpen(r.title, 'slides', aiDeck(outline, { cover: true }));
        return;
      }
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
        {picker && (
          <button
            className="btn btn-outline btn-sm"
            onClick={() =>
              void pickFromDrive().then(
                (docs) => {
                  const d = docs[0];
                  if (d) void open(d.id, d.mimeType.includes('spreadsheet') ? 'sheet' : d.mimeType.includes('presentation') ? 'slides' : d.mimeType.includes('document') ? 'doc' : 'text');
                },
                (e) => setError(errorText(e)),
              )
            }
            type="button"
          >
            <GoogleLogo size={14} /> Choose with Google Picker
          </button>
        )}
        <span className="muted small">
          Google Docs, Sheets, Slides and text files, newest first.{' '}
          {!sheets && <a href={allowUrl('sheets', 'drive')}>Allow Google Sheets to open sheets as real spreadsheets →</a>}
        </span>
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
                    <span className="drive-kind">
                      <FileTypeIcon mime={KIND_MIME[f.kind] ?? 'text/plain'} />
                    </span>
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

export function CalendarTab() {
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
      <p className="muted">
        Your next 30 days from Google Calendar. They also appear on the CoWrite <a href="/calendar">Calendar</a> page.{' '}
        <a href={allowUrl('calendar', 'calendar')}>Allow adding CoWrite events to Google Calendar →</a>
      </p>
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

export function ReposTab() {
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
              {r.private ? <LockIcon /> : <RepoIcon />} {r.fullName}
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
                  <FileDirectoryFillIcon fill="#54aeff" /> {it.name}
                </button>
              ) : (
                <span>
                  <FileIcon /> {it.name}
                </span>
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

function SendTab({ google, github, features }: { google: boolean; github: boolean; features: Partial<Record<Feature, boolean>> }) {
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [allDocs, setAllDocs] = useState<DocMeta[]>([]);
  const [sheet, setSheet] = useState('');
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [doc, setDoc] = useState('');
  const [repos, setRepos] = useState<{ fullName: string }[]>([]);
  const [repo, setRepo] = useState('');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ documents: DocMeta[] }>('/docs').then(
      (r) => {
        setAllDocs(r.documents);
        setDocs(r.documents.filter((d) => d.kind === 'doc' && !d.encrypted));
        setDoc(r.documents.find((d) => d.kind === 'doc' && !d.encrypted)?.id ?? '');
        setSheet(r.documents.find((d) => d.kind === 'sheet' && !d.encrypted)?.id ?? '');
      },
      () => setDocs([]),
    );
    if (github) api<{ repos: { fullName: string }[] }>('/integrations/github/repos').then((r) => (setRepos(r.repos), setRepo(r.repos[0]?.fullName ?? '')), () => {});
  }, [github]);
  const send = async (where: 'google' | 'github' | 'gmail' | 'sheets') => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const target = where === 'sheets' ? sheet : doc;
      const body = where === 'github' ? { repo, path } : where === 'gmail' ? { to, note } : {};
      const r = await api<{ url?: string; updated?: boolean; sentTo?: string[] }>(`/docs/${target}/send/${where}`, { method: 'POST', body });
      const text =
        where === 'gmail'
          ? `Emailed to ${r.sentTo?.join(', ')}.`
          : where === 'sheets'
            ? 'Saved to Google Sheets.'
            : where === 'google'
              ? 'Saved as a Google Doc.'
              : r.updated
                  ? 'Updated the file on GitHub.'
                  : 'Added the file to GitHub.';
      setResult({ url: r.url ?? '', text });
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
          <span className="send-logo">
            <AppLogo name="gmail" size={28} />
          </span>
          <b>Email with Gmail</b>
          <small className="muted">Sends the document, formatted, from your own Gmail.</small>
          {features.gmail ? (
            <>
              <ContactInput className="input" value={to} onValue={setTo} placeholder="name@example.com, … (type a name)" aria-label="Recipients" />
              {!features.contacts && (
                <a className="small" href={allowUrl('contacts', 'send')}>
                  Suggest my Google contacts
                </a>
              )}
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="A short note (optional)" aria-label="Note" />
              <button className="btn btn-primary btn-sm" disabled={!doc || !to.trim() || busy} onClick={() => void send('gmail')} type="button">
                Send email
              </button>
            </>
          ) : (
            <a className="btn btn-outline btn-sm" href={allowUrl('gmail', 'send')}>
              Allow Gmail
            </a>
          )}
        </div>
        <div className="send-card">
          <span className="send-logo">
            <FileTypeIcon mime="application/vnd.google-apps.spreadsheet" size={30} />
          </span>
          <b>Spreadsheet to Google Sheets</b>
          <select className="input" value={sheet} onChange={(e) => setSheet(e.target.value)} aria-label="Spreadsheet">
            {allDocs
              .filter((d) => d.kind === 'sheet' && !d.encrypted)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
          </select>
          {features.sheets ? (
            <button className="btn btn-primary btn-sm" disabled={!sheet || busy} onClick={() => void send('sheets')} type="button">
              Save to Google Sheets
            </button>
          ) : (
            <a className="btn btn-outline btn-sm" href={allowUrl('sheets', 'send')}>
              Allow Google Sheets
            </a>
          )}
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
          {result.url && (
            <a href={result.url} target="_blank" rel="noreferrer">
              Open it ↗
            </a>
          )}
        </p>
      )}
    </section>
  );
}


interface TaskList {
  id: string;
  title: string;
  tasks: { id: string; title: string; notes: string; due: string | null; done: boolean }[];
}

export function TasksTab() {
  const [lists, setLists] = useState<TaskList[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const load = () => api<{ lists: TaskList[] }>('/integrations/google/tasks').then((r) => setLists(r.lists), (e) => (setLists([]), setError(errorText(e))));
  useEffect(() => {
    void load();
  }, []);
  const toggle = async (list: string, id: string, done: boolean) => {
    setLists((ls) => ls?.map((l) => (l.id !== list ? l : { ...l, tasks: l.tasks.map((t) => (t.id === id ? { ...t, done } : t)) })) ?? null);
    await api(`/integrations/google/tasks/${encodeURIComponent(list)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: { done } }).catch((e) => setError(errorText(e)));
  };
  const add = async (list: string) => {
    const title = (draft[list] ?? '').trim();
    if (!title) return;
    setDraft({ ...draft, [list]: '' });
    await api(`/integrations/google/tasks/${encodeURIComponent(list)}`, { method: 'POST', body: { title } }).catch((e) => setError(errorText(e)));
    void load();
  };
  const toChecklist = (l: TaskList) => void importText(l.title, `# ${l.title}\n${l.tasks.map((t) => `- [${t.done ? 'x' : ' '}] ${t.title}${t.due ? ` (due ${t.due})` : ''}`).join('\n')}`);
  if (!lists) return <Spinner />;
  return (
    <section>
      {error && <p className="error-text">{error}</p>}
      <div className="repo-grid">
        {lists.map((l) => (
          <div key={l.id} className="repo-card tasks-card">
            <div className="row-between">
              <b>
                <AppLogo name="tasks" size={18} /> {l.title}
              </b>
              <button className="btn btn-text btn-sm" onClick={() => toChecklist(l)} type="button">
                Open as checklist
              </button>
            </div>
            <ul className="gtasks">
              {l.tasks.map((t) => (
                <li key={t.id} className={t.done ? 'done' : ''}>
                  <label>
                    <input type="checkbox" checked={t.done} onChange={(e) => void toggle(l.id, t.id, e.target.checked)} /> {t.title}
                  </label>
                  {t.due && <small className="muted">{t.due}</small>}
                </li>
              ))}
              {!l.tasks.length && <li className="muted">No tasks.</li>}
            </ul>
            <form
              className="chat-ask"
              onSubmit={(e) => {
                e.preventDefault();
                void add(l.id);
              }}
            >
              <input value={draft[l.id] ?? ''} onChange={(e) => setDraft({ ...draft, [l.id]: e.target.value })} placeholder="Add a task" aria-label={`Add a task to ${l.title}`} />
              <button className="btn btn-primary btn-sm" type="submit">
                Add
              </button>
            </form>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Drive in a floating window: works out which extras are switched on by itself. */
export function DriveWindow() {
  const { data } = useIntegrations();
  if (!data) return <Spinner />;
  if (!data.google.connected) return <NotConnected name="Google" onDone={() => {}} />;
  return <DriveTab sheets={!!data.google.features.sheets} picker={!!data.google.picker} />;
}
