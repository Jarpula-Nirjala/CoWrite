import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../api.ts';
import { appApi } from '../lib/google.ts';
import { AppLogo } from './AppLogo.tsx';
import { GoogleGate } from './GoogleGate.tsx';
import { Spinner } from './ui.tsx';

interface List {
  id: string;
  title: string;
}
interface Task {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  status: 'needsAction' | 'completed';
  completed?: string;
  parent?: string;
}

/** Google Tasks inside CoWrite: lists, tasks with notes and due dates, completed items. */
export function TasksApp() {
  return (
    <GoogleGate feature="tasks" tab="tasks">
      <Tasks />
    </GoogleGate>
  );
}

function Tasks() {
  const [lists, setLists] = useState<List[]>([]);
  const [list, setList] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [title, setTitle] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLists = useCallback(
    () =>
      appApi<{ items?: List[] }>('tasks', 'users/@me/lists?maxResults=100').then(
        (r) => {
          setLists(r.items ?? []);
          setList((l) => l ?? r.items?.[0]?.id ?? null);
        },
        (e) => setError(errorText(e)),
      ),
    [],
  );
  const load = useCallback(() => {
    if (!list) return;
    appApi<{ items?: Task[] }>('tasks', `lists/${encodeURIComponent(list)}/tasks?showCompleted=true&showHidden=true&maxResults=100`).then(
      (r) => setTasks(r.items ?? []),
      (e) => (setTasks([]), setError(errorText(e))),
    );
  }, [list]);
  useEffect(() => void loadLists(), [loadLists]);
  useEffect(() => (setTasks(null), load()), [load]);

  const path = (t: Task) => `lists/${encodeURIComponent(list!)}/tasks/${t.id}`;
  const update = async (t: Task, body: Partial<Task>) => {
    setTasks((ts) => ts?.map((x) => (x.id === t.id ? { ...x, ...body } : x)) ?? null);
    await appApi('tasks', path(t), { method: 'PATCH', body: { ...body, ...(body.status === 'needsAction' ? { completed: null } : {}) } }).catch((e) => setError(errorText(e)));
  };
  const add = async () => {
    if (!title.trim() || !list) return;
    const t = await appApi<Task>('tasks', `lists/${encodeURIComponent(list)}/tasks`, { method: 'POST', body: { title: title.trim() } }).catch((e) => (setError(errorText(e)), null));
    setTitle('');
    if (t) setTasks((ts) => [t, ...(ts ?? [])]);
  };
  const remove = async (t: Task) => {
    setTasks((ts) => ts?.filter((x) => x.id !== t.id) ?? null);
    await appApi('tasks', path(t), { method: 'DELETE' }).catch((e) => setError(errorText(e)));
  };
  const newList = async () => {
    const name = prompt('Name of the new list');
    if (!name?.trim()) return;
    const l = await appApi<List>('tasks', 'users/@me/lists', { method: 'POST', body: { title: name.trim() } }).catch((e) => (setError(errorText(e)), null));
    if (l) {
      setLists((ls) => [...ls, l]);
      setList(l.id);
    }
  };
  const clearDone = async () => {
    if (!list) return;
    await appApi('tasks', `lists/${encodeURIComponent(list)}/clear`, { method: 'POST' }).catch((e) => setError(errorText(e)));
    load();
  };

  const open = (tasks ?? []).filter((t) => t.status !== 'completed');
  const done = (tasks ?? []).filter((t) => t.status === 'completed');
  const current = lists.find((l) => l.id === list);

  return (
    <div className="gm gt">
      <header className="gm-top">
        <span className="gm-brand">
          <AppLogo name="tasks" size={28} /> <b>Tasks</b>
        </span>
      </header>
      <aside className="gm-side">
        <nav>
          {lists.map((l) => (
            <button key={l.id} className={l.id === list ? 'on' : ''} onClick={() => setList(l.id)} type="button" title={l.title}>
              <span className="gm-ico">☑️</span>
              <span className="gm-lname">{l.title}</span>
            </button>
          ))}
          <button onClick={() => void newList()} type="button">
            <span className="gm-ico">＋</span>
            <span className="gm-lname">Create new list</span>
          </button>
        </nav>
      </aside>
      <main className="gm-main gt-main">
        {error && (
          <p className="error-text gm-error" onClick={() => setError(null)}>
            {error}
          </p>
        )}
        <h2 className="gt-title">{current?.title ?? 'Tasks'}</h2>
        <form
          className="gt-add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <span className="gt-plus">＋</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task" aria-label="Add a task" />
        </form>
        {!tasks ? (
          <Spinner />
        ) : (
          <>
            <ul className="gt-list">
              {open.map((t) => (
                <TaskRow key={t.id} t={t} open={openId === t.id} onToggleOpen={() => setOpenId(openId === t.id ? null : t.id)} onUpdate={(b) => void update(t, b)} onDelete={() => void remove(t)} />
              ))}
              {!open.length && <li className="gt-empty">All tasks complete 🎉</li>}
            </ul>
            {done.length > 0 && (
              <>
                <div className="gt-done-head">
                  <button onClick={() => setShowDone(!showDone)} type="button">
                    {showDone ? '▾' : '▸'} Completed ({done.length})
                  </button>
                  <button onClick={() => void clearDone()} type="button">
                    Delete all completed
                  </button>
                </div>
                {showDone && (
                  <ul className="gt-list done">
                    {done.map((t) => (
                      <TaskRow key={t.id} t={t} open={false} onToggleOpen={() => {}} onUpdate={(b) => void update(t, b)} onDelete={() => void remove(t)} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function TaskRow({ t, open, onToggleOpen, onUpdate, onDelete }: { t: Task; open: boolean; onToggleOpen(): void; onUpdate(b: Partial<Task>): void; onDelete(): void }) {
  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes ?? '');
  const done = t.status === 'completed';
  const due = t.due?.slice(0, 10);
  const overdue = due && !done && due < new Date().toISOString().slice(0, 10);
  return (
    <li className={`gt-task ${done ? 'done' : ''}`}>
      <button className="gt-check" onClick={() => onUpdate({ status: done ? 'needsAction' : 'completed' })} aria-label={done ? 'Mark not done' : 'Mark complete'} type="button">
        {done ? '✓' : ''}
      </button>
      <div className="gt-body">
        {open ? (
          <>
            <input className="gt-edit-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== t.title && onUpdate({ title: title.trim() })} aria-label="Title" />
            <textarea className="gt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (t.notes ?? '') && onUpdate({ notes })} placeholder="Details" rows={2} aria-label="Details" />
            <label className="gt-due">
              📅 <input type="date" value={due ?? ''} onChange={(e) => onUpdate({ due: e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined })} aria-label="Due date" />
            </label>
          </>
        ) : (
          <button className="gt-title-btn" onClick={onToggleOpen} type="button">
            <span>{t.title}</span>
            {t.notes && <small className="muted">{t.notes}</small>}
            {due && <small className={`gt-chip ${overdue ? 'late' : ''}`}>{new Date(`${due}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</small>}
          </button>
        )}
      </div>
      <span className="gt-actions">
        {open && (
          <button onClick={onToggleOpen} title="Done editing" type="button">
            ✓
          </button>
        )}
        <button onClick={onDelete} title="Delete" type="button">
          🗑️
        </button>
      </span>
    </li>
  );
}
