import { useEffect, useState } from 'react';
import { api, errorText, timeAgo, type DocMeta } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Avatar, Icon, Spinner } from '../components/ui.tsx';
import { Link, navigate } from '../router.ts';

interface Workspace {
  id: string;
  name: string;
  role: string;
  owner: boolean;
  members: number;
  docs: number;
}
interface Detail {
  workspace: { id: string; name: string; role: string };
  members: { userId: string; name: string; username: string; email?: string; role: string }[];
  documents: { id: string; title: string; kind: string; updatedAt: number; isTemplate: boolean; ownerName: string }[];
}

const KIND_ICON: Record<string, string> = { doc: '📄', slides: '📊', board: '🧩', kanban: '🗂️', sheet: '📈' };

/** Teams: shared spaces where every member can open every document, plus team templates. */
export function Workspaces() {
  const { user, ready } = useAuth();
  const [list, setList] = useState<Workspace[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [mine, setMine] = useState<DocMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadList = () =>
    api<{ workspaces: Workspace[] }>('/workspaces').then((r) => {
      setList(r.workspaces);
      setCurrent((c) => c ?? r.workspaces[0]?.id ?? null);
    });
  const loadDetail = (id: string) => api<Detail>(`/workspaces/${id}`).then(setDetail, (e) => setError(errorText(e)));

  useEffect(() => {
    document.title = 'Workspaces · CoWrite';
    if (!ready) return;
    if (!user) return navigate('/signin?next=/workspaces');
    void loadList();
    api<{ documents: DocMeta[] }>('/docs?view=all').then((r) => setMine(r.documents), () => {});
  }, [ready, user]);
  useEffect(() => {
    if (current) void loadDetail(current);
  }, [current]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      await loadList();
      if (current) await loadDetail(current);
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!ready || !user || !list) return <Spinner />;
  const isOwner = detail?.workspace.role === 'owner';
  const canAdd = detail && detail.workspace.role !== 'viewer';

  return (
    <div className="page">
      <SiteHeader />
      <main className="container workspaces-page">
        <p className="kicker">Teams</p>
        <h1>Workspaces</h1>
        <p className="muted">A workspace is a shared space for a team: every member can open its documents, and documents marked as team templates show up in everyone’s template gallery.</p>
        <div className="ws-layout">
          <aside className="ws-list">
            {list.map((w) => (
              <button key={w.id} className={`ws-item ${w.id === current ? 'active' : ''}`} onClick={() => setCurrent(w.id)} type="button">
                <Icon name="team" size={16} />
                <span>
                  <strong>{w.name}</strong>
                  <span className="muted small">
                    {w.members} member{w.members === 1 ? '' : 's'} · {w.docs} doc{w.docs === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
            ))}
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                void act(async () => {
                  const r = await api<{ workspace: Workspace }>('/workspaces', { method: 'POST', body: { name } });
                  setCurrent(r.workspace.id);
                  setName('');
                }, 'Workspace created.');
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New workspace name" maxLength={60} aria-label="Workspace name" />
              <button className="btn btn-primary btn-sm" type="submit">
                Create
              </button>
            </form>
          </aside>
          <section className="ws-detail">
            {error && <p className="error-text">{error}</p>}
            {msg && <p className="notice small">{msg}</p>}
            {!detail ? (
              <p className="muted">{list.length ? 'Pick a workspace.' : 'Create your first workspace to share documents with a team.'}</p>
            ) : (
              <>
                <h2>{detail.workspace.name}</h2>
                <h3>Members</h3>
                <ul className="ws-members">
                  {detail.members.map((m) => (
                    <li key={m.userId}>
                      <Avatar name={m.name} size={28} />
                      <span>
                        <strong>{m.name}</strong> <span className="muted small">@{m.username}{m.email ? ` · ${m.email}` : ''}</span>
                      </span>
                      <span className="pill">{m.role}</span>
                      {((isOwner && m.role !== 'owner') || (m.userId === user.id && m.role !== 'owner')) && (
                        <button className="btn btn-text btn-sm danger" onClick={() => void act(() => api(`/workspaces/${detail.workspace.id}/members/${m.userId}`, { method: 'DELETE' }), m.userId === user.id ? 'You left the workspace.' : 'Removed.')} type="button">
                          {m.userId === user.id ? 'Leave' : 'Remove'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {isOwner && (
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(async () => {
                        await api(`/workspaces/${detail.workspace.id}/members`, { method: 'POST', body: { email, role } });
                        setEmail('');
                      }, 'Added. They will get a notification.');
                    }}
                  >
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@email.com" required aria-label="Email" />
                    <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
                      <option value="editor">Can edit</option>
                      <option value="viewer">Can view</option>
                    </select>
                    <button className="btn btn-primary btn-sm" type="submit">
                      Add
                    </button>
                  </form>
                )}
                <div className="row-between">
                  <h3>Documents</h3>
                  {canAdd && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() =>
                        void act(async () => {
                          const r = await api<{ document: DocMeta }>('/docs', { method: 'POST', body: { title: `${detail.workspace.name} document`, workspaceId: detail.workspace.id } });
                          navigate(`/d/${r.document.id}`);
                        })
                      }
                      type="button"
                    >
                      <Icon name="plus" size={14} /> New team document
                    </button>
                  )}
                </div>
                {!detail.documents.length && <p className="muted small">No documents yet. Create one, or move one of yours in below.</p>}
                <ul className="ws-docs">
                  {detail.documents.map((d) => (
                    <li key={d.id}>
                      <span>{KIND_ICON[d.kind] ?? '📄'}</span>
                      <Link to={`/d/${d.id}`}>{d.title}</Link>
                      {d.isTemplate && <span className="pill">Team template</span>}
                      <span className="muted small">
                        {d.ownerName} · {timeAgo(d.updatedAt)}
                      </span>
                      {mine.some((m) => m.id === d.id && m.role === 'owner') && (
                        <>
                          <button className="btn btn-text btn-sm" onClick={() => void act(() => api(`/docs/${d.id}`, { method: 'PATCH', body: { isTemplate: !d.isTemplate } }), d.isTemplate ? 'No longer a template.' : 'Now a team template: it appears in everyone’s template gallery.')} type="button">
                            {d.isTemplate ? 'Unmark template' : 'Make team template'}
                          </button>
                          <button className="btn btn-text btn-sm" onClick={() => void act(() => api(`/docs/${d.id}`, { method: 'PATCH', body: { workspaceId: null } }), 'Moved out of the workspace.')} type="button">
                            Move out
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {canAdd && (
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const id = (e.currentTarget.elements.namedItem('doc') as HTMLSelectElement).value;
                      if (id) void act(() => api(`/docs/${id}`, { method: 'PATCH', body: { workspaceId: detail.workspace.id } }), 'Moved into the workspace.');
                    }}
                  >
                    <select name="doc" aria-label="Your document">
                      <option value="">Move one of your documents in…</option>
                      {mine
                        .filter((m) => m.role === 'owner' && m.workspaceId !== detail.workspace.id && !m.encrypted)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.title}
                          </option>
                        ))}
                    </select>
                    <button className="btn btn-outline btn-sm" type="submit">
                      Move in
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
