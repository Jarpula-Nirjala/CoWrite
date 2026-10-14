import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Icon, Modal, Spinner } from '../components/ui.tsx';
import { Link, navigate, useSearch } from '../router.ts';

interface DriveFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  docId: string | null;
  docTitle: string | null;
  url: string;
}

const FILTERS = [
  { id: 'all', label: 'All files' },
  { id: 'images', label: '🖼️ Photos' },
  { id: 'pdf', label: '📕 PDFs' },
  { id: 'media', label: '🎞️ Audio & video' },
  { id: 'other', label: '📎 Other' },
] as const;
const kb = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const kindOf = (m: string) => (m.startsWith('image/') ? 'images' : m === 'application/pdf' ? 'pdf' : /^(audio|video)\//.test(m) ? 'media' : 'other');
const ICON: Record<string, string> = { images: '🖼️', pdf: '📕', media: '🎞️', other: '📎' };

/** Drive and Pics: every file you have uploaded, with storage use. */
export function Drive() {
  const { user, ready } = useAuth();
  const search = useSearch();
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [used, setUsed] = useState(0);
  const [quota, setQuota] = useState(60 * 1024 * 1024);
  const [filter, setFilter] = useState<string>('all');
  const [grid, setGrid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<DriveFile | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pics = new URLSearchParams(search).get('view') === 'images';

  useEffect(() => setFilter(pics ? 'images' : 'all'), [pics]);
  const load = () =>
    api<{ files: DriveFile[]; used: number; quota: number }>('/me/files').then(
      (r) => (setFiles(r.files), setUsed(r.used), setQuota(r.quota)),
      (e) => (setFiles([]), setError(errorText(e))),
    );
  useEffect(() => {
    document.title = `${pics ? 'Pics' : 'Drive'} · CoWrite`;
    if (!ready) return;
    if (!user) return navigate(`/signin?next=${pics ? '/drive?view=images' : '/drive'}`, { replace: true });
    void load();
  }, [ready, user, pics]);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of [...list]) {
        const res = await fetch('/api/files', { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name) }, body: f, credentials: 'same-origin' });
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(j.error ?? 'Upload failed.');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (f: DriveFile) => {
    if (!confirm(`Delete “${f.name}”? Documents that show it will show a broken image.`)) return;
    await api(`/me/files/${f.id}`, { method: 'DELETE' }).catch(() => {});
    setViewing(null);
    void load();
  };

  const shown = (files ?? []).filter((f) => filter === 'all' || kindOf(f.mime) === filter);
  const pct = Math.min(100, (used / quota) * 100);
  if (!ready || !user) return <Spinner />;
  return (
    <div className="page">
      <SiteHeader />
      <div className="rail-layout">
        <main className="drive">
          <header className="drive-head">
            <div>
              <h1>{pics ? '🖼️ Pics' : '☁️ Drive'}</h1>
              <p className="muted">{pics ? 'Every photo you have added to your documents.' : 'Files you have uploaded to your documents.'}</p>
            </div>
            <div className="drive-actions">
              <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()} type="button">
                <Icon name="upload" size={16} /> {busy ? 'Uploading…' : 'Upload'}
              </button>
              <input ref={input} type="file" hidden multiple accept={pics ? 'image/*' : undefined} onChange={(e) => (void upload(e.target.files), (e.target.value = ''))} />
              <button className="btn btn-outline" onClick={() => setGrid(!grid)} aria-label={grid ? 'List view' : 'Grid view'} type="button">
                <Icon name={grid ? 'list' : 'grid'} size={16} />
              </button>
            </div>
          </header>
          <div className="drive-quota">
            <span className="quota-bar">
              <i style={{ width: `${pct}%`, background: pct > 85 ? '#d93025' : undefined }} />
            </span>
            <span className="muted small">
              {kb(used)} of {kb(quota)} used
            </span>
          </div>
          <div className="tpl-kinds">
            {FILTERS.map((f) => (
              <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)} type="button">
                {f.label}
              </button>
            ))}
          </div>
          {error && <p className="error-text">{error}</p>}
          {!files ? (
            <Spinner />
          ) : !shown.length ? (
            <div className="keep-empty">
              <span>{pics ? '🖼️' : '☁️'}</span>
              <p className="muted">Nothing here yet. Upload a file, or add images to a document.</p>
            </div>
          ) : grid ? (
            <div className="drive-grid">
              {shown.map((f) => (
                <button key={f.id} className="drive-card" onClick={() => setViewing(f)} type="button">
                  <span className="drive-thumb">{kindOf(f.mime) === 'images' ? <img src={f.url} alt="" loading="lazy" /> : <span>{ICON[kindOf(f.mime)]}</span>}</span>
                  <span className="drive-name">{f.name}</span>
                  <span className="muted small">
                    {kb(f.size)} · {new Date(f.createdAt).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <table className="drive-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>In document</th>
                  <th>Size</th>
                  <th>Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <button className="link-btn" onClick={() => setViewing(f)} type="button">
                        {ICON[kindOf(f.mime)]} {f.name}
                      </button>
                    </td>
                    <td>{f.docId ? <Link to={`/d/${f.docId}`}>{f.docTitle ?? 'Open'}</Link> : <span className="muted">—</span>}</td>
                    <td>{kb(f.size)}</td>
                    <td>{new Date(f.createdAt).toLocaleDateString()}</td>
                    <td>
                      <a href={f.url} download={f.name} aria-label="Download">
                        <Icon name="download" size={16} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </main>
      </div>
      {viewing && (
        <Modal title={viewing.name} onClose={() => setViewing(null)} wide>
          <div className="drive-view">
            {kindOf(viewing.mime) === 'images' ? (
              <img src={viewing.url} alt={viewing.name} />
            ) : viewing.mime === 'application/pdf' ? (
              <iframe src={viewing.url} title={viewing.name} />
            ) : viewing.mime.startsWith('video/') ? (
              <video src={viewing.url} controls />
            ) : viewing.mime.startsWith('audio/') ? (
              <audio src={viewing.url} controls />
            ) : (
              <p className="muted">No preview for this file type.</p>
            )}
            <div className="row-between">
              <span className="muted small">
                {kb(viewing.size)} · added {new Date(viewing.createdAt).toLocaleString()}
                {viewing.docId && (
                  <>
                    {' '}
                    · in <Link to={`/d/${viewing.docId}`}>{viewing.docTitle ?? 'a document'}</Link>
                  </>
                )}
              </span>
              <span className="row-actions">
                <a className="btn btn-outline btn-sm" href={viewing.url} download={viewing.name}>
                  <Icon name="download" size={14} /> Download
                </a>
                <button className="btn btn-outline btn-sm" onClick={() => void remove(viewing)} type="button">
                  <Icon name="trash" size={14} /> Delete
                </button>
              </span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
