import { useEffect, useState } from 'react';
import { api, errorText, timeAgo, type DocKind, type DocMeta } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Preview, TemplateGallery } from '../components/TemplateGallery.tsx';
import { Icon, Spinner } from '../components/ui.tsx';
import { BLANKS, GALLERY, type GalleryItem } from '../lib/gallery.ts';
import { pendingContent } from '../lib/templates.ts';
import { localPrefs } from '../lib/prefs.ts';
import { Link, navigate } from '../router.ts';

const KINDS: { kind: DocKind; label: string; icon: string; tint: string }[] = [
  { kind: 'doc', label: 'Document', icon: '📄', tint: '#1f3a68' },
  { kind: 'slides', label: 'Presentation', icon: '📊', tint: '#b3541e' },
  { kind: 'board', label: 'Whiteboard', icon: '🧩', tint: '#6a1b9a' },
  { kind: 'kanban', label: 'Kanban board', icon: '🗂️', tint: '#0a66c2' },
  { kind: 'sheet', label: 'Spreadsheet', icon: '📈', tint: '#2e7d32' },
];
const ICON: Record<string, string> = { doc: '📄', slides: '📊', board: '🧩', kanban: '🗂️', sheet: '📈' };
const FEATURED = ['diary', 'resume', 'pitch', 'meeting', 'retro', 'budget', 'notebook', 'proposal'];

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

  if (!ready || !user) return <Spinner />;
  const first = user.name.split(' ')[0];
  const goal = localPrefs().dailyGoal;
  const words = Math.round((writing?.today ?? 0) / 6);
  const today = new Date().toISOString().slice(0, 10);
  const due = [...tasks].sort((a, b) => (a.due ?? '9') .localeCompare(b.due ?? '9')).slice(0, 5);

  return (
    <div className="page">
      <SiteHeader />
      <main className="container dashboard">
        <header className="dash-hello">
          <div>
            <p className="kicker">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1>
              {greeting()}, {first} <span className="wave">👋</span>
            </h1>
            <p className="muted">What would you like to create today?</p>
          </div>
          {writing && (
            <div className="hello-stats">
              <span title="Writing streak">🔥 {writing.streak} day streak</span>
              <span title="Today's words">
                ✍️ {words}/{goal} words today
              </span>
            </div>
          )}
        </header>

        {error && <p className="error-text">{error}</p>}

        <section className="quick-create" aria-label="Create">
          {KINDS.map((k) => (
            <button key={k.kind} className="create-tile" style={{ '--tint': k.tint } as React.CSSProperties} disabled={busy} onClick={() => void create(GALLERY.find((g) => g.id === BLANKS[k.kind])!)} type="button">
              <span className="create-icon">{k.icon}</span>
              <span>
                <strong>{k.label}</strong>
                <small>Blank</small>
              </span>
              <Icon name="plus" size={16} />
            </button>
          ))}
          <button className="create-tile templates" onClick={() => setGallery(true)} type="button">
            <span className="create-icon">✨</span>
            <span>
              <strong>Templates</strong>
              <small>50 designs</small>
            </span>
          </button>
        </section>

        <section className="dash-section">
          <div className="row-between">
            <h2>Start from a template</h2>
            <button className="btn btn-text btn-sm" onClick={() => setGallery(true)} type="button">
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
              <ul className="recent-grid">
                {docs.slice(0, 8).map((d) => (
                  <li key={d.id}>
                    <Link className="recent-card" to={`/d/${d.id}`}>
                      <span className="recent-icon">{ICON[d.kind] ?? '📄'}</span>
                      <span className="recent-title">{d.title}</span>
                      <span className="muted small">
                        {timeAgo(d.updatedAt)}
                        {d.role && d.role !== 'owner' ? ` · shared by ${d.ownerName ?? 'someone'}` : ''}
                      </span>
                      {d.snippet && <span className="recent-snippet">{d.snippet.replace(/<[^>]+>/g, '').slice(0, 90)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
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
                <h3>📅 Due soon</h3>
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
              <h3>⚡ Shortcuts</h3>
              <div className="shortcut-grid">
                <Link to="/calendar">📅 Calendar</Link>
                <Link to="/workspaces">👥 Teams</Link>
                <Link to="/ask">❓ Ask AI</Link>
                <Link to="/activity">🔥 Streaks</Link>
                <Link to="/documents">📁 Library</Link>
                <Link to="/account">⚙️ Settings</Link>
              </div>
            </section>
          </aside>
        </div>
      </main>
      <SiteFooter />
      {gallery && <TemplateGallery busy={busy} onClose={() => setGallery(false)} onPick={(item) => (setGallery(false), void create(item))} />}
    </div>
  );
}
