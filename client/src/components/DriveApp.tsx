import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api.ts';
import { markdownToTokens } from '../../../shared/rich.ts';
import { allowUrl, appApi } from '../lib/google.ts';
import { createAndOpen } from '../lib/create.ts';
import { AppLogo } from './AppLogo.tsx';
import { GoogleGate } from './GoogleGate.tsx';
import { Icon, Spinner } from './ui.tsx';

interface DFile {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  thumbnailLink?: string;
  modifiedTime: string;
  size?: string;
  starred?: boolean;
  trashed?: boolean;
  webViewLink?: string;
  owners?: { displayName: string }[];
}
type View = 'mine' | 'shared' | 'recent' | 'starred' | 'trash';

const FOLDER = 'application/vnd.google-apps.folder';
const G = 'application/vnd.google-apps.';
const FIELDS = 'nextPageToken,files(id,name,mimeType,iconLink,thumbnailLink,modifiedTime,size,starred,trashed,webViewLink,owners(displayName))';
const KIND: Record<string, [string, string]> = {
  [`${G}document`]: ['📄', 'Google Docs'],
  [`${G}spreadsheet`]: ['📊', 'Google Sheets'],
  [`${G}presentation`]: ['📽️', 'Google Slides'],
  [`${G}form`]: ['📝', 'Google Forms'],
  [`${G}drawing`]: ['🖌️', 'Google Drawings'],
  [FOLDER]: ['📁', 'Folder'],
  'application/pdf': ['📕', 'PDF'],
};
const kindOf = (m: string): [string, string] => KIND[m] ?? (m.startsWith('image/') ? ['🖼️', 'Image'] : m.startsWith('video/') ? ['🎞️', 'Video'] : m.startsWith('audio/') ? ['🎵', 'Audio'] : ['📎', 'File']);
const size = (b?: string) => {
  const n = Number(b ?? 0);
  return !n ? '—' : n > 1_073_741_824 ? `${(n / 1_073_741_824).toFixed(1)} GB` : n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
};
const date = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Google Drive inside CoWrite: browse, preview, upload, create, rename, star and delete. */
export function DriveApp() {
  return (
    <GoogleGate feature={null} tab="drive">
      <Drive />
    </GoogleGate>
  );
}

function Drive() {
  const [view, setView] = useState<View>('mine');
  const [path, setPath] = useState<{ id: string; name: string }[]>([{ id: 'root', name: 'My Drive' }]);
  const [search, setSearch] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<DFile[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [grid, setGrid] = useState(true);
  const [preview, setPreview] = useState<DFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [quota, setQuota] = useState<{ usage: number; limit: number } | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [menu, setMenu] = useState(false);
  const upRef = useRef<HTMLInputElement>(null);
  const folder = path[path.length - 1];

  useEffect(() => {
    appApi<{ storageQuota: { usage: string; limit?: string } }>('drive', 'about?fields=storageQuota').then((r) => setQuota({ usage: Number(r.storageQuota.usage), limit: Number(r.storageQuota.limit ?? 0) }), () => {});
    api<{ google: { features: { drive?: boolean } } }>('/integrations').then((r) => setCanEdit(!!r.google.features.drive), () => {});
  }, []);

  const query = useCallback(() => {
    if (search) return { q: `name contains '${q(search)}' and trashed = false`, orderBy: 'modifiedTime desc' };
    switch (view) {
      case 'shared':
        return { q: 'sharedWithMe = true and trashed = false', orderBy: 'modifiedTime desc' };
      case 'recent':
        return { q: `trashed = false and mimeType != '${FOLDER}'`, orderBy: 'viewedByMeTime desc' };
      case 'starred':
        return { q: 'starred = true and trashed = false', orderBy: 'folder,name' };
      case 'trash':
        return { q: 'trashed = true', orderBy: 'modifiedTime desc' };
      default:
        return { q: `'${q(folder.id)}' in parents and trashed = false`, orderBy: 'folder,name' };
    }
  }, [view, folder.id, search]);

  const load = useCallback(
    (more?: string) => {
      if (!more) setFiles(null);
      setError(null);
      const params = new URLSearchParams({ ...query(), fields: FIELDS, pageSize: '60', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(more ? { pageToken: more } : {}) });
      appApi<{ files: DFile[]; nextPageToken?: string }>('drive', `files?${params}`).then(
        (r) => (setFiles((f) => (more ? [...(f ?? []), ...r.files] : r.files)), setNext(r.nextPageToken ?? null)),
        (e) => (setFiles([]), setError(errorText(e))),
      );
    },
    [query],
  );
  useEffect(() => load(), [load]);

  const go = (v: View) => (setView(v), setSearch(''), setText(''), setPreview(null), setPath([{ id: 'root', name: 'My Drive' }]));
  const open = (f: DFile) => {
    if (f.mimeType === FOLDER) {
      setView('mine');
      setSearch('');
      setPath((p) => [...p, { id: f.id, name: f.name }]);
    } else setPreview(f);
  };
  const needEdit = () => {
    if (canEdit) return false;
    setError('To rename, star, move or delete files you did not create in CoWrite, allow full Drive access first.');
    return true;
  };
  const patch = async (f: DFile, body: Record<string, unknown>, done: string) => {
    if (needEdit()) return;
    setBusy(done);
    try {
      await appApi('drive', `files/${f.id}?supportsAllDrives=true`, { method: 'PATCH', body });
      load();
      if (preview?.id === f.id) setPreview(body.trashed ? null : { ...f, ...body });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const rename = (f: DFile) => {
    const name = prompt('New name', f.name);
    if (name && name.trim() && name !== f.name) void patch(f, { name: name.trim() }, 'Renaming…');
  };
  const destroy = async (f: DFile) => {
    if (needEdit() || !confirm(`Delete “${f.name}” for ever? This cannot be undone.`)) return;
    await appApi('drive', `files/${f.id}?supportsAllDrives=true`, { method: 'DELETE' }).catch((e) => setError(errorText(e)));
    load();
  };
  const create = async (mimeType: string, label: string) => {
    setMenu(false);
    const name = prompt(`Name for the new ${label}`, `Untitled ${label.toLowerCase()}`);
    if (!name) return;
    setBusy('Creating…');
    try {
      const f = await appApi<{ id: string; webViewLink?: string }>('drive', 'files?fields=id,webViewLink&supportsAllDrives=true', {
        method: 'POST',
        body: { name, mimeType, ...(view === 'mine' && !search ? { parents: [folder.id] } : {}) },
      });
      if (mimeType !== FOLDER && f.webViewLink) window.open(f.webViewLink, '_blank', 'noopener');
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const upload = async (list: FileList | null) => {
    setMenu(false);
    if (!list?.length) return;
    setBusy(`Uploading ${list.length} file${list.length > 1 ? 's' : ''}…`);
    try {
      for (const f of [...list]) {
        const qs = new URLSearchParams({ name: f.name, mime: f.type || 'application/octet-stream', ...(view === 'mine' && folder.id !== 'root' ? { parent: folder.id } : {}) });
        const res = await fetch(`/api/apps-upload/drive?${qs}`, { method: 'POST', body: f, headers: { 'content-type': 'application/octet-stream' }, credentials: 'same-origin' });
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Upload failed.');
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(null);
    }
  };
  const toCoWrite = async (f: DFile) => {
    setBusy('Opening in CoWrite…');
    try {
      const r = await api<{ name: string; text: string }>(`/integrations/google/file/${f.id}`);
      await createAndOpen(r.name, 'doc', { tokens: markdownToTokens(r.text), settings: { theme: 'simple', font: 'sans' } });
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  const NAV: [View, string, string][] = [
    ['mine', '🏠', 'My Drive'],
    ['shared', '👥', 'Shared with me'],
    ['recent', '🕒', 'Recent'],
    ['starred', '⭐', 'Starred'],
    ['trash', '🗑️', 'Bin'],
  ];
  const title = search ? `Search results for “${search}”` : view === 'mine' ? null : NAV.find((n) => n[0] === view)![2];
  const previewUrl = preview ? (preview.mimeType.startsWith(G) && preview.mimeType !== FOLDER ? (preview.webViewLink ?? '').replace(/\/(edit|view)[^/]*$/, '/preview') : `https://drive.google.com/file/d/${preview.id}/preview`) : '';

  return (
    <div className="gm dr">
      <header className="gm-top">
        <span className="gm-brand">
          <AppLogo name="drive" size={30} /> <b>Drive</b>
        </span>
        <form
          className="gm-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(text.trim());
            setPreview(null);
          }}
        >
          <Icon name="search" size={16} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search in Drive" aria-label="Search in Drive" />
          {search && (
            <button onClick={() => (setSearch(''), setText(''))} type="button" aria-label="Clear search">
              ✕
            </button>
          )}
        </form>
        <span className="dr-views">
          <button className={grid ? '' : 'on'} onClick={() => setGrid(false)} title="List view" aria-label="List view" type="button">
            ☰
          </button>
          <button className={grid ? 'on' : ''} onClick={() => setGrid(true)} title="Grid view" aria-label="Grid view" type="button">
            ▦
          </button>
        </span>
      </header>
      <aside className="gm-side">
        <div className="dr-new-wrap">
          <button className="gm-compose dr-new" onClick={() => setMenu(!menu)} type="button">
            ＋ <span>New</span>
          </button>
          {menu && (
            <div className="dr-menu" role="menu">
              <button onClick={() => void create(FOLDER, 'Folder')} type="button">
                📁 New folder
              </button>
              <button onClick={() => upRef.current?.click()} type="button">
                ⬆️ File upload
              </button>
              <hr />
              <button onClick={() => void create(`${G}document`, 'Document')} type="button">
                📄 Google Docs
              </button>
              <button onClick={() => void create(`${G}spreadsheet`, 'Spreadsheet')} type="button">
                📊 Google Sheets
              </button>
              <button onClick={() => void create(`${G}presentation`, 'Presentation')} type="button">
                📽️ Google Slides
              </button>
            </div>
          )}
          <input ref={upRef} type="file" hidden multiple onChange={(e) => (void upload(e.target.files), (e.target.value = ''))} />
        </div>
        <nav>
          {NAV.map(([v, icon, label]) => (
            <button key={v} className={view === v && !search ? 'on' : ''} onClick={() => go(v)} type="button" title={label}>
              <span className="gm-ico">{icon}</span>
              <span className="gm-lname">{label}</span>
            </button>
          ))}
        </nav>
        {quota && quota.limit > 0 && (
          <div className="dr-quota">
            <span className="quota-bar">
              <i style={{ width: `${Math.min(100, (quota.usage / quota.limit) * 100)}%` }} />
            </span>
            <small className="muted">
              {size(String(quota.usage))} of {size(String(quota.limit))} used
            </small>
          </div>
        )}
        {!canEdit && (
          <a className="dr-allow" href={allowUrl('drive', 'drive')}>
            Allow full Drive access (rename, star, delete)
          </a>
        )}
      </aside>
      <main className="gm-main dr-main">
        {busy && <p className="gm-cooldown">⏳ {busy}</p>}
        {error && <p className="error-text gm-error">{error}</p>}
        {preview ? (
          <div className="dr-preview">
            <div className="gm-bar">
              <button className="gm-icon" onClick={() => setPreview(null)} aria-label="Back" type="button">
                ←
              </button>
              <b className="dr-pname">
                {kindOf(preview.mimeType)[0]} {preview.name}
              </b>
              {[`${G}document`, 'text/plain', 'text/markdown'].includes(preview.mimeType) && (
                <button onClick={() => void toCoWrite(preview)} type="button">
                  Open in CoWrite
                </button>
              )}
              <a className="dr-btn" href={`/api/apps-download/drive/${preview.id}`}>
                ⬇ Download
              </a>
              {preview.webViewLink && (
                <a className="dr-btn" href={preview.webViewLink} target="_blank" rel="noreferrer">
                  ✏️ Edit in Google
                </a>
              )}
              <button onClick={() => void patch(preview, { starred: !preview.starred }, 'Saving…')} type="button">
                {preview.starred ? '★ Starred' : '☆ Star'}
              </button>
              <button onClick={() => rename(preview)} type="button">
                Rename
              </button>
              <button onClick={() => void patch(preview, { trashed: true }, 'Moving to bin…')} type="button">
                🗑️
              </button>
            </div>
            <iframe className="dr-frame" src={previewUrl} title={preview.name} allow="autoplay; fullscreen" />
          </div>
        ) : (
          <>
            <div className="dr-crumbs">
              {title ? (
                <b>{title}</b>
              ) : (
                path.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && ' › '}
                    <button onClick={() => setPath(path.slice(0, i + 1))} type="button" disabled={i === path.length - 1}>
                      {p.name}
                    </button>
                  </span>
                ))
              )}
            </div>
            {!files ? (
              <Spinner />
            ) : !files.length ? (
              <p className="gm-empty">{view === 'trash' ? 'Bin is empty.' : search ? 'No files match.' : 'Drop files here with “New → File upload”.'}</p>
            ) : grid ? (
              <>
              {[
                ['Folders', files.filter((f) => f.mimeType === FOLDER)],
                ['Files', files.filter((f) => f.mimeType !== FOLDER)],
              ].map(([label, group]) =>
                (group as DFile[]).length ? (
              <section key={label as string}>
              <h4 className="dr-section">{label as string}</h4>
              <div className="dr-grid">
                {(group as DFile[]).map((f) => (
                  <div key={f.id} className={`dr-card ${f.mimeType === FOLDER ? 'folder' : ''}`} onDoubleClick={() => open(f)} onClick={() => f.mimeType === FOLDER && open(f)}>
                    {f.mimeType === FOLDER ? (
                      <span className="dr-fname">📁 {f.name}</span>
                    ) : (
                      <>
                        <span className="dr-fname">
                          {f.iconLink ? <img src={f.iconLink} alt="" /> : kindOf(f.mimeType)[0]} {f.name}
                        </span>
                        <button className="dr-thumb" onClick={() => setPreview(f)} type="button" aria-label={`Preview ${f.name}`}>
                          {f.thumbnailLink ? <img src={f.thumbnailLink} alt="" referrerPolicy="no-referrer" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} /> : null}
                          <span>{kindOf(f.mimeType)[0]}</span>
                        </button>
                        <small className="muted">{date(f.modifiedTime)}</small>
                      </>
                    )}
                    <Actions f={f} trash={view === 'trash'} onStar={() => void patch(f, { starred: !f.starred }, 'Saving…')} onRename={() => rename(f)} onTrash={() => void patch(f, { trashed: true }, 'Moving to bin…')} onRestore={() => void patch(f, { trashed: false }, 'Restoring…')} onDelete={() => void destroy(f)} />
                  </div>
                ))}
              </div>
              </section>
                ) : null,
              )}
              </>
            ) : (
              <table className="dr-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="hide-sm">Owner</th>
                    <th>Last modified</th>
                    <th className="hide-sm">File size</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.id} onDoubleClick={() => open(f)}>
                      <td>
                        <button className="dr-row-name" onClick={() => open(f)} type="button">
                          {f.iconLink ? <img src={f.iconLink} alt="" /> : kindOf(f.mimeType)[0]} {f.name} {f.starred && <span className="gm-star on">★</span>}
                        </button>
                      </td>
                      <td className="hide-sm muted">{f.owners?.[0]?.displayName ?? 'me'}</td>
                      <td className="muted">{date(f.modifiedTime)}</td>
                      <td className="hide-sm muted">{f.mimeType.startsWith(G) ? '—' : size(f.size)}</td>
                      <td>
                        <Actions f={f} trash={view === 'trash'} onStar={() => void patch(f, { starred: !f.starred }, 'Saving…')} onRename={() => rename(f)} onTrash={() => void patch(f, { trashed: true }, 'Moving to bin…')} onRestore={() => void patch(f, { trashed: false }, 'Restoring…')} onDelete={() => void destroy(f)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {next && (
              <button className="btn btn-outline btn-sm dr-more" onClick={() => load(next)} type="button">
                Load more
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Actions({ f, trash, onStar, onRename, onTrash, onRestore, onDelete }: { f: DFile; trash: boolean; onStar(): void; onRename(): void; onTrash(): void; onRestore(): void; onDelete(): void }) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => (e.stopPropagation(), fn());
  return (
    <span className="dr-actions">
      {trash ? (
        <>
          <button onClick={stop(onRestore)} title="Restore" type="button">
            ↩
          </button>
          <button onClick={stop(onDelete)} title="Delete for ever" type="button">
            ✕
          </button>
        </>
      ) : (
        <>
          {f.mimeType !== FOLDER && (
            <a href={`/api/apps-download/drive/${f.id}`} title="Download" onClick={(e) => e.stopPropagation()}>
              ⬇
            </a>
          )}
          <button onClick={stop(onStar)} title={f.starred ? 'Remove star' : 'Star'} type="button">
            {f.starred ? '★' : '☆'}
          </button>
          <button onClick={stop(onRename)} title="Rename" type="button">
            ✏️
          </button>
          <button onClick={stop(onTrash)} title="Move to bin" type="button">
            🗑️
          </button>
        </>
      )}
    </span>
  );
}
