import { useEffect, useMemo, useState } from 'react';
import type { Attrs } from '../../../../shared/crdt.ts';
import { Avatar, Icon } from '../../components/ui.tsx';
import type { KindProps } from '../KindPage.tsx';
import { keyBetween, uid, useObjects, type Obj } from '../objects.ts';

interface Col {
  order: string;
  title: string;
  color?: string;
  limit?: number | null;
}

interface Check {
  id: string;
  text: string;
  done: boolean;
}

interface Card {
  col: string;
  order: string;
  title: string;
  desc?: string;
  assignee?: string | null;
  due?: string | null;
  labels?: string[];
  priority?: 'low' | 'medium' | 'high' | null;
  checklist?: Check[];
  cover?: string | null;
}

const COL_COLORS = ['#6b7785', '#1f3a68', '#0a66c2', '#2e7d32', '#c8a24a', '#c62828', '#6a1b9a', '#ef6c00'];
const LABELS: { id: string; name: string; color: string }[] = [
  { id: 'red', name: 'Urgent', color: '#e53935' },
  { id: 'orange', name: 'Blocked', color: '#fb8c00' },
  { id: 'yellow', name: 'Review', color: '#fdd835' },
  { id: 'green', name: 'Ready', color: '#43a047' },
  { id: 'blue', name: 'Feature', color: '#1e88e5' },
  { id: 'purple', name: 'Design', color: '#8e24aa' },
];
const COVERS = [null, '#fde68a', '#bfdbfe', '#bbf7d0', '#fbcfe8', '#ddd6fe', '#fed7aa'];

const today = () => new Date().toISOString().slice(0, 10);
const dueState = (due: string | null | undefined) => {
  if (!due) return '';
  const t = today();
  if (due < t) return 'overdue';
  if (due === t) return 'today';
  return 'later';
};
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function KanbanEditor(p: KindProps) {
  const { api, canEdit, client } = p;
  const { doc, version } = api;
  const cols = useObjects<Col>(doc, 'col', version);
  const cards = useObjects<Card>(doc, 'card', version);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; kind: 'card' | 'col' } | null>(null);
  const [dropAt, setDropAt] = useState<{ col: string; index: number } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    client.setExt({ focus: open ? `card|${open}` : 'kanban' });
  }, [open, client]);

  const names = useMemo(() => [...new Set([p.me.name, ...p.peers.map((x) => x.name)])], [p.me.name, p.peers]);
  const visible = (c: Obj<Card>) =>
    (!query || `${c.f.title} ${c.f.desc ?? ''}`.toLowerCase().includes(query.toLowerCase())) && (!mine || c.f.assignee === p.me.name) && (!label || c.f.labels?.includes(label));
  const byCol = useMemo(() => {
    const m = new Map<string, Obj<Card>[]>();
    for (const c of cards) m.set(c.f.col, [...(m.get(c.f.col) ?? []), c]);
    return m;
  }, [cards]);

  const addCol = () => {
    const id = uid();
    api.set(`col:${id}`, { order: keyBetween(cols.at(-1)?.f.order ?? null, null), title: 'New list', color: COL_COLORS[cols.length % COL_COLORS.length] });
  };
  const addCard = (col: string, title: string) => {
    const list = byCol.get(col) ?? [];
    api.set(`card:${uid()}`, { col, order: keyBetween(list.at(-1)?.f.order ?? null, null), title, labels: [], checklist: [] } as Attrs);
  };
  const moveCard = (id: string, col: string, index: number) => {
    const list = (byCol.get(col) ?? []).filter((c) => c.id !== id);
    api.set(`card:${id}`, { col, order: keyBetween(list[index - 1]?.f.order ?? null, list[index]?.f.order ?? null) });
  };
  const moveCol = (id: string, index: number) => {
    const rest = cols.filter((c) => c.id !== id);
    api.set(`col:${id}`, { order: keyBetween(rest[index - 1]?.f.order ?? null, rest[index]?.f.order ?? null) });
  };
  const deleteCol = (c: Obj<Col>) => {
    const n = byCol.get(c.id)?.length ?? 0;
    if (n && !window.confirm(`Delete “${c.f.title}” and its ${n} card${n === 1 ? '' : 's'}?`)) return;
    api.group(() => {
      for (const card of byCol.get(c.id) ?? []) api.remove(card.key);
      api.remove(c.key);
    });
  };

  const exportCsv = () => {
    const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['List', 'Title', 'Description', 'Assignee', 'Due', 'Priority', 'Labels', 'Checklist'].map(q).join(',')];
    for (const col of cols)
      for (const c of byCol.get(col.id) ?? [])
        rows.push(
          [col.f.title, c.f.title, c.f.desc, c.f.assignee, c.f.due, c.f.priority, (c.f.labels ?? []).map((l) => LABELS.find((x) => x.id === l)?.name).join('; '), `${(c.f.checklist ?? []).filter((x) => x.done).length}/${(c.f.checklist ?? []).length}`]
            .map(q)
            .join(','),
        );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = `${p.title || 'Board'}.csv`;
    a.click();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) api.redo();
        else api.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        api.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api]);

  const total = cards.length;
  const done = cols.length ? (byCol.get(cols.at(-1)!.id)?.length ?? 0) : 0;
  const overdue = cards.filter((c) => dueState(c.f.due) === 'overdue').length;
  const openCard = open ? cards.find((c) => c.id === open) : null;

  return (
    <div className="kanban">
      <div className="kanban-top" role="toolbar">
        {canEdit && (
          <>
            <button className="tb-btn" onClick={api.undo} disabled={!api.canUndo} title="Undo" type="button">
              <Icon name="undo" size={16} />
            </button>
            <button className="tb-btn" onClick={api.redo} disabled={!api.canRedo} title="Redo" type="button">
              <Icon name="redo" size={16} />
            </button>
            <span className="tb-sep" />
          </>
        )}
        <label className="kanban-search">
          <Icon name="search" size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter cards" aria-label="Filter cards" />
        </label>
        <button className={`tb-btn wide ${mine ? 'active' : ''}`} onClick={() => setMine((m) => !m)} aria-pressed={mine} type="button">
          Assigned to me
        </button>
        <span className="label-filter">
          {LABELS.map((l) => (
            <button key={l.id} className={`label-dot ${label === l.id ? 'active' : ''}`} style={{ background: l.color }} onClick={() => setLabel(label === l.id ? null : l.id)} title={`Only “${l.name}”`} type="button" />
          ))}
        </span>
        <span className="tb-flex" />
        <span className="kanban-stats small muted">
          {total} cards · {total ? Math.round((done / total) * 100) : 0}% in “{cols.at(-1)?.f.title ?? '—'}”{overdue ? <span className="overdue-count"> · {overdue} overdue</span> : null}
        </span>
        <button className="tb-btn wide" onClick={exportCsv} type="button">
          <Icon name="download" size={15} /> CSV
        </button>
      </div>
      <div className="kanban-cols">
        {cols.map((col, ci) => {
          const list = (byCol.get(col.id) ?? []).filter(visible);
          const all = byCol.get(col.id) ?? [];
          const over = col.f.limit && all.length > col.f.limit;
          return (
            <section
              key={col.id}
              className={`kanban-col ${drag?.kind === 'col' && drag.id === col.id ? 'dragging' : ''}`}
              style={{ '--col': col.f.color ?? '#6b7785' } as React.CSSProperties}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (drag.kind === 'card' && (!dropAt || dropAt.col !== col.id) && !list.length) setDropAt({ col: col.id, index: 0 });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag?.kind === 'card' && dropAt) moveCard(drag.id, dropAt.col, dropAt.index);
                if (drag?.kind === 'col') moveCol(drag.id, ci);
                setDrag(null);
                setDropAt(null);
              }}
            >
              <header className="kanban-col-head" draggable={canEdit} onDragStart={() => setDrag({ id: col.id, kind: 'col' })} onDragEnd={() => setDrag(null)}>
                <span className="col-dot" />
                {canEdit ? (
                  <input className="col-title" defaultValue={col.f.title} key={col.f.title} onBlur={(e) => e.target.value.trim() && e.target.value !== col.f.title && api.set(col.key, { title: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label="List name" />
                ) : (
                  <h3 className="col-title">{col.f.title}</h3>
                )}
                <span className={`col-count ${over ? 'over' : ''}`} title={col.f.limit ? `Limit ${col.f.limit}` : undefined}>
                  {all.length}
                  {col.f.limit ? `/${col.f.limit}` : ''}
                </span>
                {canEdit && (
                  <details className="col-menu">
                    <summary aria-label="List options">
                      <Icon name="more" size={16} />
                    </summary>
                    <div className="menu">
                      <div className="swatches">
                        {COL_COLORS.map((c) => (
                          <button key={c} className="swatch" style={{ background: c }} onClick={() => api.set(col.key, { color: c })} aria-label={c} type="button" />
                        ))}
                      </div>
                      <label className="field small">
                        <span>Work-in-progress limit</span>
                        <input type="number" min={0} defaultValue={col.f.limit ?? ''} onBlur={(e) => api.set(col.key, { limit: Number(e.target.value) || null })} />
                      </label>
                      <button className="menu-item danger" onClick={() => deleteCol(col)} type="button">
                        Delete list
                      </button>
                    </div>
                  </details>
                )}
              </header>
              <ol className="kanban-cards">
                {list.map((c, i) => {
                  const viewers = p.peers.filter((x) => x.ext?.focus === `card|${c.id}`);
                  const checks = c.f.checklist ?? [];
                  const ds = dueState(c.f.due);
                  return (
                    <li
                      key={c.id}
                      className={`kanban-card ${drag?.id === c.id ? 'dragging' : ''} ${dropAt?.col === col.id && dropAt.index === i ? 'drop-before' : ''} ${dropAt?.col === col.id && dropAt.index === i + 1 && i === list.length - 1 ? 'drop-after' : ''}`}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        setDrag({ id: c.id, kind: 'card' });
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setDropAt(null);
                      }}
                      onDragOver={(e) => {
                        if (drag?.kind !== 'card') return;
                        e.preventDefault();
                        e.stopPropagation();
                        const r = e.currentTarget.getBoundingClientRect();
                        const index = e.clientY < r.top + r.height / 2 ? i : i + 1;
                        const real = index < list.length ? all.indexOf(list[index]) : all.length;
                        if (dropAt?.col !== col.id || dropAt.index !== real) setDropAt({ col: col.id, index: real });
                      }}
                      onClick={() => setOpen(c.id)}
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setOpen(c.id)}
                    >
                      {c.f.cover && <div className="card-cover" style={{ background: c.f.cover }} />}
                      {(c.f.labels?.length ?? 0) > 0 && (
                        <div className="card-labels">
                          {c.f.labels!.map((l) => {
                            const L = LABELS.find((x) => x.id === l);
                            return L ? <span key={l} className="card-label" style={{ background: L.color }} title={L.name} /> : null;
                          })}
                        </div>
                      )}
                      <div className="card-title">{c.f.title}</div>
                      <div className="card-meta">
                        {c.f.priority && <span className={`prio prio-${c.f.priority}`}>{c.f.priority}</span>}
                        {c.f.due && <span className={`due due-${ds}`}>{fmtDate(c.f.due)}</span>}
                        {checks.length > 0 && (
                          <span className={`checks ${checks.every((x) => x.done) ? 'all' : ''}`}>
                            ☑ {checks.filter((x) => x.done).length}/{checks.length}
                          </span>
                        )}
                        {c.f.desc && <span title="Has description">≡</span>}
                        <span className="tb-flex" />
                        {viewers.map((v) => (
                          <span key={v.site} className="card-viewer" style={{ background: v.color }} title={`${v.name} is looking at this`} />
                        ))}
                        {c.f.assignee && <Avatar name={c.f.assignee} size={22} />}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {canEdit &&
                (adding === col.id ? (
                  <form
                    className="add-card-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const input = e.currentTarget.elements.namedItem('t') as HTMLTextAreaElement;
                      if (input.value.trim()) addCard(col.id, input.value.trim());
                      input.value = '';
                      input.focus();
                    }}
                  >
                    <textarea
                      name="t"
                      autoFocus
                      placeholder="Card title"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                        if (e.key === 'Escape') setAdding(null);
                      }}
                    />
                    <div className="row-actions">
                      <button className="btn btn-primary btn-sm" type="submit">
                        Add card
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setAdding(null)} type="button">
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button className="add-card" onClick={() => setAdding(col.id)} type="button">
                    <Icon name="plus" size={14} /> Add a card
                  </button>
                ))}
            </section>
          );
        })}
        {canEdit && (
          <button className="kanban-add-col" onClick={addCol} type="button">
            <Icon name="plus" size={16} /> Add list
          </button>
        )}
        {!cols.length && !canEdit && <p className="muted">This board is empty.</p>}
      </div>
      {openCard && (
        <CardDialog
          card={openCard}
          cols={cols}
          names={names}
          readOnly={!canEdit}
          onSet={(f) => api.set(openCard.key, f as Attrs)}
          onDelete={() => {
            api.remove(openCard.key);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function CardDialog({ card, cols, names, readOnly, onSet, onDelete, onClose }: { card: Obj<Card>; cols: Obj<Col>[]; names: string[]; readOnly: boolean; onSet(f: Partial<Card>): void; onDelete(): void; onClose(): void }) {
  const f = card.f;
  const checks = f.checklist ?? [];
  const [item, setItem] = useState('');
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card-dialog" role="dialog" aria-label="Card details">
        {f.cover && <div className="card-cover big" style={{ background: f.cover }} />}
        <button className="modal-close" onClick={onClose} aria-label="Close" type="button">
          ×
        </button>
        <input className="card-dialog-title" defaultValue={f.title} key={f.title} readOnly={readOnly} onBlur={(e) => e.target.value.trim() && e.target.value !== f.title && onSet({ title: e.target.value.trim() })} aria-label="Card title" />
        <p className="small muted">
          in list{' '}
          <select value={f.col} disabled={readOnly} onChange={(e) => onSet({ col: e.target.value })} aria-label="List">
            {cols.map((c) => (
              <option key={c.id} value={c.id}>
                {c.f.title}
              </option>
            ))}
          </select>
        </p>
        <div className="card-grid">
          <label className="field">
            <span>Assignee</span>
            <select value={f.assignee ?? ''} disabled={readOnly} onChange={(e) => onSet({ assignee: e.target.value || null })}>
              <option value="">Nobody</option>
              {[...new Set([...(f.assignee ? [f.assignee] : []), ...names])].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Due date</span>
            <input type="date" value={f.due ?? ''} disabled={readOnly} onChange={(e) => onSet({ due: e.target.value || null })} />
          </label>
          <label className="field">
            <span>Priority</span>
            <select value={f.priority ?? ''} disabled={readOnly} onChange={(e) => onSet({ priority: (e.target.value || null) as Card['priority'] })}>
              <option value="">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <div className="field">
          <span>Labels</span>
          <div className="label-pick">
            {LABELS.map((l) => {
              const on = f.labels?.includes(l.id);
              return (
                <button
                  key={l.id}
                  className={`label-chip ${on ? 'on' : ''}`}
                  style={{ '--c': l.color } as React.CSSProperties}
                  disabled={readOnly}
                  onClick={() => onSet({ labels: on ? f.labels!.filter((x) => x !== l.id) : [...(f.labels ?? []), l.id] })}
                  type="button"
                >
                  {l.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="field">
          <span>Cover</span>
          <div className="swatches">
            {COVERS.map((c) => (
              <button key={c ?? 'none'} className={`swatch ${f.cover === c ? 'active' : ''} ${c ? '' : 'none'}`} style={{ background: c ?? '#fff' }} disabled={readOnly} onClick={() => onSet({ cover: c })} aria-label={c ?? 'No cover'} type="button" />
            ))}
          </div>
        </div>
        <label className="field">
          <span>Description</span>
          <textarea rows={4} defaultValue={f.desc ?? ''} key={f.desc} readOnly={readOnly} placeholder="Add more detail…" onBlur={(e) => e.target.value !== (f.desc ?? '') && onSet({ desc: e.target.value })} />
        </label>
        <div className="field">
          <span>
            Checklist {checks.length > 0 && `· ${Math.round((checks.filter((x) => x.done).length / checks.length) * 100)}%`}
          </span>
          {checks.length > 0 && (
            <div className="progress">
              <div style={{ width: `${(checks.filter((x) => x.done).length / checks.length) * 100}%` }} />
            </div>
          )}
          <ul className="checklist">
            {checks.map((c) => (
              <li key={c.id}>
                <label>
                  <input type="checkbox" checked={c.done} disabled={readOnly} onChange={() => onSet({ checklist: checks.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)) })} />
                  <span className={c.done ? 'done' : ''}>{c.text}</span>
                </label>
                {!readOnly && (
                  <button className="link-btn" onClick={() => onSet({ checklist: checks.filter((x) => x.id !== c.id) })} aria-label="Remove item" type="button">
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!readOnly && (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!item.trim()) return;
                onSet({ checklist: [...checks, { id: uid(), text: item.trim(), done: false }] });
                setItem('');
              }}
            >
              <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Add an item" />
              <button className="btn btn-outline btn-sm" type="submit">
                Add
              </button>
            </form>
          )}
        </div>
        {!readOnly && (
          <div className="row-actions end">
            <button className="btn btn-ghost btn-sm danger" onClick={onDelete} type="button">
              <Icon name="trash" size={14} /> Delete card
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
