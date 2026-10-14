import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api, errorText } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { AppRail } from '../components/AppRail.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Icon, Modal, Spinner } from '../components/ui.tsx';
import { navigate } from '../router.ts';

interface Item {
  text: string;
  done: boolean;
}
interface Note {
  id: string;
  title: string;
  body: string;
  items: Item[] | null;
  color: string;
  pinned: boolean;
  archived: boolean;
  labels: string[];
  updatedAt: number;
}
type Draft = Omit<Note, 'id' | 'updatedAt'>;

export const NOTE_COLORS: Record<string, string> = {
  white: 'var(--surface)',
  red: '#faafa8',
  orange: '#f39f76',
  yellow: '#fff8b8',
  green: '#e2f6d3',
  teal: '#b4ddd3',
  blue: '#d4e4ed',
  purple: '#d3bfdb',
  pink: '#f6e2dd',
  gray: '#efeff1',
};
const EMPTY: Draft = { title: '', body: '', items: null, color: 'white', pinned: false, archived: false, labels: [] };

/** Google Keep-style notes: quick notes and checklists in colourful cards. */
export function Keep() {
  const { user, ready } = useAuth();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [view, setView] = useState<'notes' | 'archive' | string>('notes');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Keep · CoWrite';
    if (!ready) return;
    if (!user) return navigate('/signin?next=/keep', { replace: true });
    api<{ notes: Note[] }>('/notes').then((r) => setNotes(r.notes), (e) => (setNotes([]), setError(errorText(e))));
  }, [ready, user]);

  const save = async (id: string | null, d: Draft) => {
    setError(null);
    try {
      if (id) {
        const { note } = await api<{ note: Note }>(`/notes/${id}`, { method: 'PUT', body: d });
        setNotes((n) => (n ?? []).map((x) => (x.id === id ? note : x)));
      } else {
        const { note } = await api<{ note: Note }>('/notes', { method: 'POST', body: d });
        setNotes((n) => [note, ...(n ?? [])]);
      }
    } catch (e) {
      setError(errorText(e));
    }
  };
  const remove = async (id: string) => {
    await api(`/notes/${id}`, { method: 'DELETE' }).catch(() => {});
    setNotes((n) => (n ?? []).filter((x) => x.id !== id));
    setEditing(null);
  };

  const labels = useMemo(() => [...new Set((notes ?? []).flatMap((n) => n.labels))].sort(), [notes]);
  const shown = (notes ?? []).filter((n) => {
    if (q) return `${n.title} ${n.body} ${(n.items ?? []).map((i) => i.text).join(' ')}`.toLowerCase().includes(q.toLowerCase());
    if (view === 'archive') return n.archived;
    if (view !== 'notes') return !n.archived && n.labels.includes(view);
    return !n.archived;
  });
  const pinned = shown.filter((n) => n.pinned && view !== 'archive');
  const others = shown.filter((n) => !n.pinned || view === 'archive');

  if (!ready || !user) return <Spinner />;
  return (
    <div className="page">
      <SiteHeader />
      <div className="rail-layout">
        <AppRail active="keep" />
        <main className="keep">
          <div className="keep-top">
            <nav className="keep-views">
              <button className={view === 'notes' ? 'on' : ''} onClick={() => setView('notes')} type="button">
                💡 Notes
              </button>
              {labels.map((l) => (
                <button key={l} className={view === l ? 'on' : ''} onClick={() => setView(l)} type="button">
                  🏷️ {l}
                </button>
              ))}
              <button className={view === 'archive' ? 'on' : ''} onClick={() => setView('archive')} type="button">
                🗄️ Archive
              </button>
            </nav>
            <label className="tpl-search">
              <Icon name="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
            </label>
          </div>
          {view !== 'archive' && <Composer onSave={(d) => void save(null, { ...d, labels: view !== 'notes' ? [view] : [] })} />}
          {error && <p className="error-text">{error}</p>}
          {!notes ? (
            <Spinner />
          ) : !shown.length ? (
            <div className="keep-empty">
              <span>💡</span>
              <p className="muted">{view === 'archive' ? 'Your archived notes appear here' : q ? 'No matching notes' : 'Notes you add appear here'}</p>
            </div>
          ) : (
            <>
              {!!pinned.length && <p className="side-h">Pinned</p>}
              <NoteGrid notes={pinned} onOpen={setEditing} onSave={save} />
              {!!pinned.length && !!others.length && <p className="side-h">Others</p>}
              <NoteGrid notes={others} onOpen={setEditing} onSave={save} />
            </>
          )}
        </main>
      </div>
      {editing && (
        <Modal title="Edit note" onClose={() => setEditing(null)}>
          <NoteEditor
            initial={editing}
            onDone={(d) => {
              void save(editing.id, d);
              setEditing(null);
            }}
            onDelete={() => void remove(editing.id)}
          />
        </Modal>
      )}
    </div>
  );
}

function NoteGrid({ notes, onOpen, onSave }: { notes: Note[]; onOpen(n: Note): void; onSave(id: string, d: Draft): Promise<void> }) {
  return (
    <div className="keep-grid">
      {notes.map((n) => (
        <article key={n.id} className="keep-note" style={{ '--nc': NOTE_COLORS[n.color] ?? NOTE_COLORS.white } as CSSProperties} onClick={() => onOpen(n)}>
          <button
            className={`keep-pin ${n.pinned ? 'on' : ''}`}
            onClick={(e) => (e.stopPropagation(), void onSave(n.id, { ...n, pinned: !n.pinned }))}
            aria-label={n.pinned ? 'Unpin' : 'Pin'}
            type="button"
          >
            📌
          </button>
          {n.title && <h3>{n.title}</h3>}
          {n.body && <p>{n.body.length > 400 ? `${n.body.slice(0, 400)}…` : n.body}</p>}
          {n.items && (
            <ul className="keep-items">
              {n.items.slice(0, 8).map((it, i) => (
                <li key={i} className={it.done ? 'done' : ''}>
                  <input
                    type="checkbox"
                    checked={it.done}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => void onSave(n.id, { ...n, items: n.items!.map((x, k) => (k === i ? { ...x, done: !x.done } : x)) })}
                    aria-label={it.text}
                  />
                  {it.text}
                </li>
              ))}
              {n.items.length > 8 && <li className="muted">+ {n.items.length - 8} more</li>}
            </ul>
          )}
          {!!n.labels.length && (
            <span className="keep-labels">
              {n.labels.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </span>
          )}
        </article>
      ))}
    </div>
  );
}

function Composer({ onSave }: { onSave(d: Draft): void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(false);
  const close = (d: Draft) => {
    if (d.title.trim() || d.body.trim() || d.items?.some((i) => i.text.trim())) onSave({ ...d, items: d.items?.filter((i) => i.text.trim()) ?? null });
    setOpen(false);
    setList(false);
  };
  if (!open)
    return (
      <div className="keep-composer closed">
        <button className="keep-take" onClick={() => setOpen(true)} type="button">
          Take a note…
        </button>
        <button onClick={() => (setList(true), setOpen(true))} aria-label="New list" title="New list" type="button">
          ☑️
        </button>
      </div>
    );
  return (
    <div className="keep-composer">
      <NoteEditor initial={{ ...EMPTY, items: list ? [{ text: '', done: false }] : null }} onDone={close} autoFocus />
    </div>
  );
}

function NoteEditor({ initial, onDone, onDelete, autoFocus }: { initial: Draft; onDone(d: Draft): void; onDelete?(): void; autoFocus?: boolean }) {
  const [d, setD] = useState<Draft>({ title: initial.title, body: initial.body, items: initial.items, color: initial.color, pinned: initial.pinned, archived: initial.archived, labels: initial.labels });
  const [label, setLabel] = useState('');
  const items = d.items;
  return (
    <div className="note-editor" style={{ '--nc': NOTE_COLORS[d.color] ?? NOTE_COLORS.white } as CSSProperties}>
      <input className="ne-title" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Title" aria-label="Title" />
      {items ? (
        <ul className="ne-items">
          {items.map((it, i) => (
            <li key={i}>
              <input type="checkbox" checked={it.done} onChange={() => setD({ ...d, items: items.map((x, k) => (k === i ? { ...x, done: !x.done } : x)) })} aria-label="Done" />
              <input
                value={it.text}
                autoFocus={autoFocus && i === items.length - 1}
                onChange={(e) => setD({ ...d, items: items.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setD({ ...d, items: [...items.slice(0, i + 1), { text: '', done: false }, ...items.slice(i + 1)] });
                  }
                }}
                placeholder="List item"
                aria-label="List item"
              />
              <button onClick={() => setD({ ...d, items: items.filter((_, k) => k !== i) })} aria-label="Remove item" type="button">
                ×
              </button>
            </li>
          ))}
          <li>
            <button className="ne-add" onClick={() => setD({ ...d, items: [...items, { text: '', done: false }] })} type="button">
              + List item
            </button>
          </li>
        </ul>
      ) : (
        <textarea className="ne-body" value={d.body} autoFocus={autoFocus} onChange={(e) => setD({ ...d, body: e.target.value })} placeholder="Take a note…" rows={4} aria-label="Note" />
      )}
      {!!d.labels.length && (
        <span className="keep-labels">
          {d.labels.map((l) => (
            <span key={l}>
              {l}
              <button onClick={() => setD({ ...d, labels: d.labels.filter((x) => x !== l) })} aria-label={`Remove label ${l}`} type="button">
                ×
              </button>
            </span>
          ))}
        </span>
      )}
      <div className="ne-bar">
        <span className="ne-colors">
          {Object.entries(NOTE_COLORS).map(([k, v]) => (
            <button key={k} className={d.color === k ? 'on' : ''} style={{ background: v }} onClick={() => setD({ ...d, color: k })} aria-label={`Colour ${k}`} type="button" />
          ))}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setD({ ...d, items: items ? null : (d.body || '').split('\n').filter(Boolean).map((t) => ({ text: t, done: false })).concat(d.body ? [] : [{ text: '', done: false }]), body: items ? items.map((i) => i.text).join('\n') : '' })} type="button">
          {items ? '📝 Text' : '☑️ Checklist'}
        </button>
        <button className={`btn btn-ghost btn-sm ${d.pinned ? 'on' : ''}`} onClick={() => setD({ ...d, pinned: !d.pinned })} type="button">
          📌 {d.pinned ? 'Pinned' : 'Pin'}
        </button>
        <form
          className="ne-label"
          onSubmit={(e) => {
            e.preventDefault();
            const l = label.trim().slice(0, 30);
            if (l && !d.labels.includes(l)) setD({ ...d, labels: [...d.labels, l] });
            setLabel('');
          }}
        >
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="🏷️ Add label" aria-label="Add label" />
        </form>
        {onDelete && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => onDone({ ...d, archived: !d.archived })} type="button">
              🗄️ {d.archived ? 'Unarchive' : 'Archive'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onDelete} type="button">
              <Icon name="trash" size={14} /> Delete
            </button>
          </>
        )}
        <button className="btn btn-primary btn-sm ne-close" onClick={() => onDone(d)} type="button">
          Close
        </button>
      </div>
    </div>
  );
}
