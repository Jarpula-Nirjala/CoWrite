import { useEffect, useRef, useState } from 'react';
import { api, errorText, timeAgo, type DocKind, type DocMeta } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { SmartCreate } from '../components/SmartCreate.tsx';
import { readImport } from '../lib/exporters.ts';
import { htmlToTokens } from '../rich/importHtml.ts';
import { createAndOpen } from '../lib/create.ts';
import { Preview, TemplateGallery } from '../components/TemplateGallery.tsx';
import { Icon, Spinner } from '../components/ui.tsx';
import { GALLERY, type GalleryItem } from '../lib/gallery.ts';
import { pendingContent } from '../lib/templates.ts';
import { localPrefs } from '../lib/prefs.ts';
import { Link, navigate } from '../router.ts';
import { Glyph } from '../components/Glyph.tsx';

const BADGE: Record<string, string> = { doc: 'D', slides: 'P', board: 'W', kanban: 'K', sheet: 'S' };
const KIND_LABEL: Record<string, string> = { doc: 'Document', slides: 'Presentation', board: 'Whiteboard', kanban: 'Kanban board', sheet: 'Spreadsheet' };
const RECENT_FILTERS: { id: DocKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'doc', label: 'Documents' },
  { id: 'slides', label: 'Presentations' },
  { id: 'sheet', label: 'Spreadsheets' },
  { id: 'board', label: 'Whiteboards' },
  { id: 'kanban', label: 'Boards' },
];
const FEATURED = ['pro-growth', 'gdoc-report-luxe', 'pro-corporate-brochure', 'gdoc-paperback', 'pro-data-insights', 'gdoc-project-plan', 'pro-pioneering', 'resume'];
const ACTIONS: { label: string; icon: string; to?: string; tint: string }[] = [
  { label: 'Blank', icon: '➕', tint: '#1a73e8' },
  { label: 'Open', icon: '📂', tint: '#f9ab00' },
  { label: 'Create from Template', icon: '🎨', to: '/templates', tint: '#e8710a' },
  { label: 'Smart Create', icon: '✨', to: '/ai?tool=docs-create', tint: '#7b1fa2' },
  { label: 'Smart Edit', icon: '✏️', to: '/ai?tool=smart-edit', tint: '#0b8bd8' },
  { label: 'AI Spell Check', icon: '🔤', to: '/ai?tool=spell', tint: '#d93025' },
  { label: 'More', icon: '⋯', to: '/ai', tint: '#5f6368' },
];

interface Task {
  docId: string;
  docTitle: string;
  key: string;
  text: string;
  done: boolean;
  due: string | null;
  mine: boolean;
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** The signed-in home: create something, pick up where you left off, see what is due. */
export function Dashboard() {
  const { user, ready, aiReady, aiName } = useAuth();
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [writing, setWriting] = useState<{ today: number; streak: number } | null>(null);
  const [gallery, setGallery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const openInput = useRef<HTMLInputElement>(null);
  const [recentKind, setRecentKind] = useState<DocKind | 'all'>('all');

  useEffect(() => {
    document.title = 'Home · CoWrite';
    if (!ready) return;
    if (!user) return navigate('/signin?next=/home', { replace: true });
    api<{ documents: DocMeta[] }>('/docs?view=recent').then((r) => setDocs(r.documents), (e) => (setDocs([]), setError(errorText(e))));
    api<{ tasks: Task[] }>('/tasks').then((r) => setTasks(r.tasks.filter((t) => !t.done)), () => {});
    api<{ writing?: { today: number; streak: number } }>('/activity').then((r) => setWriting(r.writing ?? null), () => {});
  }, [ready, user]);

  const create = async (item: GalleryItem) => {
    setBusy(true);
    try {
      const { document } = await api<{ document: DocMeta }>('/docs', { method: 'POST', body: { title: item.title, kind: item.kind } });
      pendingContent.set(document.id, item.build());
      navigate(`/d/${document.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const openFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await readImport(file);
      await createAndOpen(r.title, 'doc', { tokens: r.html ? htmlToTokens(r.html) : r.tokens });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!ready || !user) return <Spinner />;
  const first = user.name.split(' ')[0];
  const goal = localPrefs().dailyGoal;
  const words = Math.round((writing?.today ?? 0) / 6);
  const today = new Date().toISOString().slice(0, 10);
  const due = [...tasks].sort((a, b) => (a.due ?? '9') .localeCompare(b.due ?? '9')).slice(0, 5);

  return (
    <div className="page">
      <SiteHeader />
      <div className="rail-layout">
      <main className="container dashboard">
        <header className="dash-hello">
          <div>
            <p className="kicker">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1>
              {greeting()}, {first}
            </h1>
            <p className="muted">What would you like to create today?</p>
          </div>
          {writing && (
            <div className="hello-stats">
              <span title="Writing streak">
                <Glyph e="🔥" size={16} /> {writing.streak} day streak
              </span>
              <span title="Today's words">
                <Glyph e="✍️" size={16} /> {words}/{goal} words today
              </span>
            </div>
          )}
        </header>

        {error && <p className="error-text">{error}</p>}

        <nav className="wps-actions" aria-label="Quick actions">
          {ACTIONS.map((a) => (
            <button
              key={a.label}
              style={{ '--tint': a.tint } as React.CSSProperties}
              disabled={busy}
              onClick={() => (a.to ? navigate(a.to) : a.label === 'Open' ? openInput.current?.click() : void create(GALLERY.find((g) => g.id === 'blank')!))}
              type="button"
            >
              <span>
                <Glyph e={a.icon} size={20} />
              </span>
              {a.label}
            </button>
          ))}
          <input ref={openInput} type="file" hidden accept=".docx,.md,.markdown,.txt,.html,.htm" onChange={(e) => (void openFile(e.target.files?.[0]), (e.target.value = ''))} />
        </nav>

        <SmartCreate compact />


        <section className="dash-section">
          <div className="row-between">
            <h2>Start from a template</h2>
            <button className="btn btn-text btn-sm" onClick={() => navigate('/templates')} type="button">
              See all →
            </button>
          </div>
          <div className="template-strip">
            {FEATURED.map((id) => GALLERY.find((g) => g.id === id))
              .filter((g): g is GalleryItem => !!g)
              .map((g) => (
                <button key={g.id} className="strip-card" disabled={busy} onClick={() => void create(g)} type="button">
                  <span className="gallery-preview">
                    <Preview item={g} />
                  </span>
                  <span className="strip-name">{g.name}</span>
                </button>
              ))}
          </div>
        </section>

        <div className="dash-columns">
          <section className="dash-section">
            <div className="row-between">
              <h2>Recent</h2>
              <Link className="btn btn-text btn-sm" to="/documents">
                All documents →
              </Link>
            </div>
            {!docs ? (
              <Spinner />
            ) : !docs.length ? (
              <p className="muted">Nothing yet. Create your first document above, or try a template.</p>
            ) : (
              <>
                <div className="recent-filter" role="tablist">
                  {RECENT_FILTERS.map((f) => (
                    <button key={f.id} role="tab" aria-selected={recentKind === f.id} className={recentKind === f.id ? 'on' : ''} onClick={() => setRecentKind(f.id)} type="button">
                      {f.label}
                    </button>
                  ))}
                </div>
                <table className="recent-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th className="hide-sm">Owner</th>
                      <th>Last modified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs
                      .filter((d) => recentKind === 'all' || d.kind === recentKind)
                      .slice(0, 10)
                      .map((d) => (
                        <tr key={d.id} onClick={() => navigate(`/d/${d.id}`)}>
                          <td>
                            <Link className="recent-name" to={`/d/${d.id}`} onClick={(e) => e.stopPropagation()}>
                              <span className={`file-badge fb-${d.kind}`} aria-hidden>
                                {BADGE[d.kind] ?? 'D'}
                              </span>
                              <span>
                                <b>{d.title}</b>
                                <small>{KIND_LABEL[d.kind] ?? 'Document'}{d.starred ? ' · Starred' : ''}</small>
                              </span>
                            </Link>
                          </td>
                          <td className="hide-sm">{d.role && d.role !== 'owner' ? (d.ownerName ?? 'Shared') : 'me'}</td>
                          <td className="muted">{timeAgo(d.updatedAt)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          <aside className="dash-side">
            <section className="side-card ai-card">
              <h3>
                <Icon name="sparkle" size={16} /> AI assistant
              </h3>
              {aiReady ? (
                <>
                  <p className="small muted">
                    {aiName === 'AI' ? 'AI is' : `${aiName} is`} ready{user.aiConnected ? ' on your own free Gemini key' : ''}. Ask anything about your documents:
                  </p>
                  <form
                    className="ask-mini"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (question.trim()) navigate(`/ask?q=${encodeURIComponent(question.trim())}`);
                    }}
                  >
                    <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What did we decide about…?" aria-label="Ask your documents" />
                    <button className="btn btn-primary btn-sm" type="submit">
                      Ask
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <p className="small">Connect your free Gemini key (sign in to Google AI Studio with {user.email}) to unlock writing help, slides from documents, translation and more.</p>
                  <Link className="btn btn-primary btn-sm" to="/account#ai">
                    Connect free AI
                  </Link>
                </>
              )}
            </section>

            <section className="side-card">
              <div className="row-between">
                <h3>
                  <Glyph e="📅" /> Due soon
                </h3>
                <Link className="small" to="/calendar">
                  Calendar
                </Link>
              </div>
              {!due.length ? (
                <p className="small muted">No open tasks. Assign checklist items in any document to see them here.</p>
              ) : (
                <ul className="due-list">
                  {due.map((t) => (
                    <li key={t.docId + t.key}>
                      <Link to={`/d/${t.docId}`}>{t.text || 'Task'}</Link>
                      {t.due && <span className={`due ${t.due < today ? 'due-overdue' : t.due === today ? 'due-today' : ''}`}>{new Date(`${t.due}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="side-card">
              <h3>
                <Glyph e="⚡" /> Shortcuts
              </h3>
              <div className="shortcut-grid">
                <Link to="/calendar">
                  <Glyph e="📅" /> Calendar
                </Link>
                <Link to="/workspaces">
                  <Glyph e="👥" /> Teams
                </Link>
                <Link to="/ask">
                  <Glyph e="❓" /> Ask AI
                </Link>
                <Link to="/activity">
                  <Glyph e="🔥" /> Streaks
                </Link>
                <Link to="/documents">
                  <Glyph e="📁" /> Library
                </Link>
                <Link to="/keep">
                  <Glyph e="💡" /> Keep
                </Link>
                <Link to="/drive">
                  <Glyph e="☁️" /> Drive
                </Link>
                <Link to="/meet">
                  <Glyph e="🎥" /> Meet
                </Link>
                <Link to="/assistant">
                  <Glyph e="✦" /> Assistant
                </Link>
                <Link to="/account">
                  <Glyph e="⚙️" /> Settings
                </Link>
              </div>
            </section>
          </aside>
        </div>
      </main>
      </div>
      <SiteFooter />
      {gallery && <TemplateGallery busy={busy} onClose={() => setGallery(false)} onPick={(item) => (setGallery(false), void create(item))} />}
    </div>
  );
}
