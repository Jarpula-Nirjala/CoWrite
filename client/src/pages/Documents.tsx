import { useCallback, useEffect, useRef, useState } from 'react';
import { api, cache, errorText, formatDate, timeAgo, type DocKind, type DocMeta, type Folder } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Dropdown, Icon, Modal, Spinner } from '../components/ui.tsx';
import { generateKey } from '../lib/e2e.ts';
import { readImport } from '../lib/exporters.ts';
import { listOffline, type OfflineDoc } from '../lib/offline.ts';
import { TemplateGallery } from '../components/TemplateGallery.tsx';
import { BLANKS, GALLERY, type Category } from '../lib/gallery.ts';
import { pendingContent, type InitialContent } from '../lib/templates.ts';
import { markdownToTokens } from '../../../shared/rich.ts';
import { htmlToTokens } from '../rich/importHtml.ts';
import { Link, navigate } from '../router.ts';

type View = 'all' | 'recent' | 'starred' | 'shared' | 'trash';

interface Library {
  folders: Folder[];
  tags: { tag: string; count: number }[];
  counts: { all: number; starred: number; trash: number; shared: number };
}

const NEW_KINDS: { kind: DocKind; label: string; icon: string }[] = [
  { kind: 'slides', label: 'presentation', icon: '📊' },
  { kind: 'board', label: 'whiteboard', icon: '🧩' },
  { kind: 'kanban', label: 'kanban board', icon: '🗂️' },
  { kind: 'sheet', label: 'spreadsheet', icon: '📈' },
];

const KIND_NAME: Record<DocKind, string> = { doc: 'Document', slides: 'Presentation', board: 'Whiteboard', kanban: 'Kanban board', sheet: 'Spreadsheet' };

const VIEW_LABEL: Record<View, string> = { all: 'All documents', recent: 'Recent', starred: 'Starred', shared: 'Shared with me', trash: 'Trash' };

export function Documents() {
  const { user, ready, offline } = useAuth();
  const [view, setView] = useState<View>('all');
  const [folder, setFolder] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState<false | Category | 'All'>(false);
  const [tagEdit, setTagEdit] = useState<DocMeta | null>(null);
  const [offlineDocs, setOfflineDocs] = useState<OfflineDoc[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'My documents · CoWrite';
    void listOffline().then(setOfflineDocs);
  }, []);

  useEffect(() => {
    if (ready && !user) navigate(`/signin?next=${encodeURIComponent('/documents')}`, { replace: true });
  }, [ready, user]);

  const cacheKey = `docs:${view}:${folder ?? ''}:${tag ?? ''}`;
  const load = useCallback(() => {
    if (!user) return;
    const q = new URLSearchParams({ view });
    if (folder) q.set('folder', folder);
    if (tag) q.set('tag', tag);
    if (query.trim()) q.set('q', query.trim());
    api<{ documents: DocMeta[] }>(`/docs?${q}`)
      .then((r) => {
        setDocs(r.documents);
        setError(null);
        if (!query.trim()) cache.set(cacheKey, r.documents);
      })
      .catch((e) => {
        const cached = cache.get<DocMeta[]>(cacheKey);
        if (cached) setDocs(cached);
        setError(errorText(e, 'Could not load documents.'));
      });
    api<Library>('/library').then(setLib, () => {});
  }, [user, view, folder, tag, query, cacheKey]);

  // Debounce searches; load immediately otherwise.
  useEffect(() => {
    const t = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  const choose = (v: View, f: string | null = null, t: string | null = null) => {
    setView(v);
    setFolder(f);
    setTag(t);
    setDocs(null);
    setSidebarOpen(false);
  };

  const create = async (opts: { title?: string; content?: string; encrypted?: boolean }) => {
    setBusy(true);
    try {
      const { document } = await api<{ document: DocMeta }>('/docs', {
        method: 'POST',
        body: { title: opts.title ?? 'Untitled document', encrypted: !!opts.encrypted, folderId: folder },
      });
      if (opts.content) pendingContent.set(document.id, { tokens: markdownToTokens(opts.content) });
      const hash = opts.encrypted ? `#key=${await generateKey()}` : '';
      navigate(`/d/${document.id}${hash}`);
    } catch (e) {
      setError(errorText(e, 'Could not create the document.'));
      setBusy(false);
    }
  };

  const createWith = async (title: string, content: InitialContent, kind: DocKind = 'doc') => {
    setBusy(true);
    try {
      const { document } = await api<{ document: DocMeta }>('/docs', { method: 'POST', body: { title, folderId: folder, kind } });
      pendingContent.set(document.id, content);
      navigate(`/d/${document.id}`);
    } catch (e) {
      setError(errorText(e, 'Could not create the document.'));
      setBusy(false);
    }
  };

  // A team template is copied (forked) into a new document of your own.
  const pickTeamTemplate = async (t: { id: string; title: string }) => {
    setTemplatesOpen(false);
    setBusy(true);
    try {
      const r = await api<{ document: DocMeta }>(`/docs/${t.id}/fork`, { method: 'POST' });
      await api(`/docs/${r.document.id}`, { method: 'PATCH', body: { title: t.title } });
      navigate(`/d/${r.document.id}`);
    } catch (e) {
      setError(errorText(e, 'Could not use that template.'));
      setBusy(false);
    }
  };

  const patch = async (d: DocMeta, body: Record<string, unknown>) => {
    try {
      await api(`/docs/${d.id}`, { method: 'PATCH', body });
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const act = async (path: string, method = 'POST', confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await api(path, { method });
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await readImport(file);
      const tokens = r.html ? htmlToTokens(r.html) : r.tokens;
      await createWith(r.title, { tokens });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const newFolder = async () => {
    const name = window.prompt('Folder name');
    if (!name?.trim()) return;
    await api('/folders', { method: 'POST', body: { name: name.trim() } }).catch((e) => setError(errorText(e)));
    load();
  };

  const heading = folder ? lib?.folders.find((f) => f.id === folder)?.name ?? 'Folder' : tag ? `#${tag}` : VIEW_LABEL[view];
  const isTrash = view === 'trash';

  return (
    <div className="page">
      <SiteHeader />
      <div className="container dashboard">
        <button className="btn btn-outline btn-sm sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} type="button">
          <Icon name="folder" size={15} /> {heading} ▾
        </button>
        <div className="dash-layout">
          <aside className={`dash-side ${sidebarOpen ? 'open' : ''}`} aria-label="Library">
            <nav>
              {(['all', 'recent', 'starred', 'shared', 'trash'] as View[]).map((v) => (
                <button key={v} className={view === v && !folder && !tag ? 'side-link active' : 'side-link'} onClick={() => choose(v)} type="button">
                  <Icon name={v === 'all' ? 'file' : v === 'recent' ? 'clock' : v === 'starred' ? 'star' : v === 'shared' ? 'users' : 'trash'} size={16} />
                  <span>{VIEW_LABEL[v]}</span>
                  {lib && v !== 'recent' && <span className="count">{lib.counts[v as keyof Library['counts']]}</span>}
                </button>
              ))}
            </nav>
            <div className="side-section">
              <div className="row-between">
                <h4>Folders</h4>
                <button className="btn btn-text btn-sm" onClick={newFolder} type="button" aria-label="New folder">
                  + New
                </button>
              </div>
              {lib?.folders.map((f) => (
                <div key={f.id} className={folder === f.id ? 'side-link active folder-row' : 'side-link folder-row'}>
                  <button className="folder-open" onClick={() => choose('all', f.id)} type="button">
                    <Icon name="folder" size={16} />
                    <span>{f.name}</span>
                    <span className="count">{f.count}</span>
                  </button>
                  <Dropdown className="icon-button tiny" ariaLabel={`${f.name} options`} label={<Icon name="more" size={16} />}>
                    {(close) => (
                      <>
                        <button
                          role="menuitem"
                          type="button"
                          onClick={async () => {
                            close();
                            const name = window.prompt('Rename folder', f.name);
                            if (name?.trim()) await api(`/folders/${f.id}`, { method: 'PATCH', body: { name: name.trim() } });
                            load();
                          }}
                        >
                          Rename
                        </button>
                        <button
                          role="menuitem"
                          type="button"
                          onClick={async () => {
                            close();
                            if (!window.confirm(`Delete the folder “${f.name}”? Its documents are kept.`)) return;
                            await api(`/folders/${f.id}`, { method: 'DELETE' });
                            if (folder === f.id) choose('all');
                            else load();
                          }}
                        >
                          Delete folder
                        </button>
                      </>
                    )}
                  </Dropdown>
                </div>
              ))}
              {lib && !lib.folders.length && <p className="muted small">No folders yet.</p>}
            </div>
            {lib && lib.tags.length > 0 && (
              <div className="side-section">
                <h4>Tags</h4>
                <div className="tag-cloud">
                  {lib.tags.map((t) => (
                    <button key={t.tag} className={tag === t.tag ? 'tag-chip active' : 'tag-chip'} onClick={() => choose('all', null, t.tag)} type="button">
                      #{t.tag} <span className="muted">{t.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {offlineDocs.length > 0 && (
              <div className="side-section">
                <h4>Available offline</h4>
                {offlineDocs.slice(0, 8).map((d) => (
                  <Link key={d.id} className="side-link" to={`/d/${d.id}`}>
                    <Icon name="wifi" size={16} />
                    <span>{d.title}</span>
                  </Link>
                ))}
              </div>
            )}
          </aside>

          <main className="dash-main">
            <div className="dash-head">
              <div>
                <p className="kicker">Dashboard</p>
                <h1>{heading}</h1>
                {offline && <p className="notice small">You are offline. Showing saved copies; changes sync when you reconnect.</p>}
              </div>
              {!isTrash && (
                <div className="dash-actions">
                  <button className="btn btn-primary btn-lg" onClick={() => void create({})} disabled={busy || !user} type="button">
                    {busy ? 'Creating…' : '+ New document'}
                  </button>
                  <Dropdown className="btn btn-outline btn-lg" label="New ▾">
                    {(close) => (
                      <>
                        <button
                          role="menuitem"
                          type="button"
                          className="menu-strong"
                          onClick={() => {
                            close();
                            setTemplatesOpen('All');
                          }}
                        >
                          ✨ Templates
                        </button>
                        {NEW_KINDS.map((k) => (
                          <button
                            key={k.kind}
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              close();
                              const blank = GALLERY.find((g) => g.id === BLANKS[k.kind])!;
                              void createWith(blank.title, blank.build(), k.kind);
                            }}
                          >
                            {k.icon} New {k.label}
                          </button>
                        ))}
                        <hr className="menu-sep" />
                        <button
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            close();
                            void create({ title: 'Private document', encrypted: true });
                          }}
                        >
                          🔒 End-to-end encrypted document
                        </button>
                        <button
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            close();
                            fileInput.current?.click();
                          }}
                        >
                          Import a Word, Markdown, HTML or text file…
                        </button>
                      </>
                    )}
                  </Dropdown>
                  <input ref={fileInput} type="file" accept=".md,.markdown,.txt,.html,.htm,.docx,text/plain,text/markdown,text/html" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
                </div>
              )}
              {isTrash && docs && docs.length > 0 && (
                <button className="btn btn-outline" onClick={() => void act('/trash/empty', 'POST', 'Permanently delete everything in the trash?')} type="button">
                  Empty trash
                </button>
              )}
            </div>

            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}

            <div className="dash-toolbar">
              <div className="search-wrap">
                <Icon name="search" size={16} />
                <input
                  className="search"
                  type="search"
                  placeholder="Search titles and full text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search documents"
                />
              </div>
              <span className="muted small">{docs ? `${docs.length} document${docs.length === 1 ? '' : 's'}` : ''}</span>
            </div>
            {isTrash && <p className="muted small">Documents in the trash are deleted for good after 30 days.</p>}

            {!docs ? (
              <Spinner />
            ) : docs.length === 0 ? (
              <div className="empty">
                <h2>{query ? 'No matches' : isTrash ? 'Trash is empty' : view === 'shared' ? 'Nothing shared with you yet' : 'No documents here yet'}</h2>
                <p className="muted">
                  {query
                    ? `Nothing contains “${query}”.`
                    : view === 'shared'
                      ? 'When someone sends you an invite link, the document appears here.'
                      : 'Create a document, start from a template, or import a file.'}
                </p>
                {!isTrash && view !== 'shared' && !query && (
                  <div className="row-actions center">
                    <button className="btn btn-primary" onClick={() => void create({})} disabled={busy} type="button">
                      Create a document
                    </button>
                    <button className="btn btn-outline" onClick={() => setTemplatesOpen('All')} type="button">
                      Browse templates
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <ul className="doc-list">
                {docs.map((d) => (
                  <li key={d.id} className="doc-row">
                    {!isTrash && view !== 'shared' && (
                      <button className={d.starred ? 'star on' : 'star'} onClick={() => void patch(d, { starred: !d.starred })} aria-label={d.starred ? 'Unstar' : 'Star'} aria-pressed={d.starred} type="button">
                        <Icon name="star" size={18} />
                      </button>
                    )}
                    <div className="doc-info">
                      {isTrash ? (
                        <span className="doc-link">{d.title}</span>
                      ) : (
                        <Link className="doc-link" to={`/d/${d.id}`}>
                          {d.kind && d.kind !== 'doc' && <span className="kind-icon" title={KIND_NAME[d.kind]}>{NEW_KINDS.find((k) => k.kind === d.kind)?.icon}</span>}
                          {d.title}
                        </Link>
                      )}
                      <div className="doc-meta muted small">
                        {d.encrypted && (
                          <span className="pill pill-lock">
                            <Icon name="lock" size={11} /> Encrypted
                          </span>
                        )}
                        {d.published && <span className="pill">Published</span>}
                        {d.parentId && <span className="pill">Fork</span>}
                        {view === 'shared' && <span>{d.ownerName} · {d.role === 'viewer' ? 'can view' : d.role === 'commenter' ? 'can comment' : 'can edit'} · </span>}
                        <span>{isTrash && d.deletedAt ? `Deleted ${timeAgo(d.deletedAt)}` : `Edited ${timeAgo(d.updatedAt)}`}</span>
                        <span className="hide-sm"> · Created {formatDate(d.createdAt)}</span>
                        {d.tags.map((t) => (
                          <button key={t} className="tag-chip small" onClick={() => choose('all', null, t)} type="button">
                            #{t}
                          </button>
                        ))}
                      </div>
                      {d.snippet && <p className="snippet" dangerouslySetInnerHTML={{ __html: highlight(d.snippet, query) }} />}
                    </div>
                    <Dropdown className="icon-button" ariaLabel={`Actions for ${d.title}`} label={<Icon name="more" />}>
                      {(close) =>
                        isTrash ? (
                          <>
                            <button role="menuitem" type="button" onClick={() => (close(), void act(`/docs/${d.id}/restore`))}>
                              Restore
                            </button>
                            <button role="menuitem" type="button" onClick={() => (close(), void act(`/docs/${d.id}`, 'DELETE', `Delete “${d.title}” forever? This cannot be undone.`))}>
                              Delete forever
                            </button>
                          </>
                        ) : view === 'shared' ? (
                          <>
                            <Link role="menuitem" to={`/d/${d.id}`} onClick={close}>
                              Open
                            </Link>
                            <button role="menuitem" type="button" onClick={() => (close(), void act(`/docs/${d.id}/membership`, 'DELETE', `Remove “${d.title}” from your list?`))}>
                              Remove from my list
                            </button>
                          </>
                        ) : (
                          <>
                            <Link role="menuitem" to={`/d/${d.id}`} onClick={close}>
                              Open
                            </Link>
                            <button
                              role="menuitem"
                              type="button"
                              onClick={() => {
                                close();
                                const title = window.prompt('Rename document', d.title);
                                if (title?.trim()) void patch(d, { title: title.trim() });
                              }}
                            >
                              Rename
                            </button>
                            <button role="menuitem" type="button" onClick={() => (close(), setTagEdit(d))}>
                              Edit tags
                            </button>
                            {lib && lib.folders.length > 0 && (
                              <div className="menu-sub">
                                <span className="muted small">Move to</span>
                                <button role="menuitem" type="button" onClick={() => (close(), void patch(d, { folderId: null }))}>
                                  No folder
                                </button>
                                {lib.folders.map((f) => (
                                  <button key={f.id} role="menuitem" type="button" disabled={d.folderId === f.id} onClick={() => (close(), void patch(d, { folderId: f.id }))}>
                                    📁 {f.name}
                                  </button>
                                ))}
                              </div>
                            )}
                            <button
                              role="menuitem"
                              type="button"
                              onClick={async () => {
                                close();
                                try {
                                  const r = await api<{ document: DocMeta }>(`/docs/${d.id}/fork`, { method: 'POST' });
                                  navigate(`/d/${r.document.id}`);
                                } catch (e) {
                                  setError(errorText(e));
                                }
                              }}
                            >
                              Fork (make a copy)
                            </button>
                            <button role="menuitem" type="button" onClick={() => (close(), void act(`/docs/${d.id}/trash`))}>
                              Move to trash
                            </button>
                          </>
                        )
                      }
                    </Dropdown>
                  </li>
                ))}
              </ul>
            )}
          </main>
        </div>
      </div>

      {templatesOpen && (
        <TemplateGallery
          busy={busy}
          initial={templatesOpen === 'All' ? undefined : templatesOpen}
          onClose={() => setTemplatesOpen(false)}
          onPick={(item) => {
            setTemplatesOpen(false);
            void createWith(item.title, item.build(), item.kind);
          }}
          onPickTeam={user ? pickTeamTemplate : undefined}
        />
      )}

      {tagEdit && <TagEditor doc={tagEdit} onClose={() => setTagEdit(null)} onSave={(tags) => void patch(tagEdit, { tags }).then(() => setTagEdit(null))} />}
      <SiteFooter />
    </div>
  );
}

function TagEditor({ doc, onClose, onSave }: { doc: DocMeta; onClose(): void; onSave(tags: string[]): void }) {
  const [value, setValue] = useState(doc.tags.join(', '));
  return (
    <Modal title={`Tags for “${doc.title}”`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value.split(',').map((t) => t.trim()).filter(Boolean));
        }}
      >
        <label className="field">
          <span>Tags (comma separated)</span>
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="work, ideas, q4" />
        </label>
        <button className="btn btn-primary" type="submit">
          Save tags
        </button>
      </form>
    </Modal>
  );
}

function highlight(snippet: string, q: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  if (!q.trim()) return esc(snippet);
  const re = new RegExp(`(${q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return esc(snippet).replace(re, '<mark>$1</mark>');
}
