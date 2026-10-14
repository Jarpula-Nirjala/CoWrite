import { useEffect, useMemo, useState } from 'react';
import { api, errorText } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Icon, Spinner } from '../components/ui.tsx';
import { Link, navigate } from '../router.ts';

interface Task {
  docId: string;
  docTitle: string;
  key: string;
  text: string;
  done: boolean;
  due: string | null;
  mine: boolean;
}
interface Reminder {
  id: string;
  docId: string | null;
  docTitle: string | null;
  note: string;
  at: number;
  sent: boolean;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Tasks assigned to you and your reminders, on a calendar. */
export function CalendarPage() {
  const { user, ready } = useAuth();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState(() => ymd(new Date()));
  const [note, setNote] = useState('');
  // Default to the next full hour, so a reminder for today is not in the past.
  const [time, setTime] = useState(() => `${String(Math.min(23, new Date().getHours() + 1)).padStart(2, '0')}:00`);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = () => {
    api<{ tasks: Task[] }>('/tasks').then((r) => setTasks(r.tasks), (e) => setError(errorText(e)));
    api<{ reminders: Reminder[] }>('/reminders').then((r) => setReminders(r.reminders), () => {});
  };
  useEffect(() => {
    document.title = 'Calendar · CoWrite';
    if (!ready) return;
    if (!user) navigate('/signin?next=/calendar');
    else load();
  }, [ready, user]);

  const byDay = useMemo(() => {
    const m = new Map<string, { tasks: Task[]; reminders: Reminder[] }>();
    const get = (k: string) => m.get(k) ?? (m.set(k, { tasks: [], reminders: [] }), m.get(k)!);
    for (const t of tasks ?? []) if (t.due) get(t.due).tasks.push(t);
    for (const r of reminders) get(ymd(new Date(r.at))).reminders.push(r);
    return m;
  }, [tasks, reminders]);

  if (!ready || !user) return <Spinner />;

  // Weeks start on Monday.
  const first = new Date(month);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const today = ymd(new Date());
  const day = byDay.get(selected);
  const mine = (tasks ?? []).filter((t) => t.mine && (showDone || !t.done));
  const overdue = mine.filter((t) => !t.done && t.due && t.due < today).length;

  return (
    <div className="page">
      <SiteHeader />
      <main className="container calendar-page">
        <div className="dash-head">
          <div>
            <p className="kicker">Planner</p>
            <h1>Calendar &amp; tasks</h1>
            <p className="muted">Tasks with due dates from all your documents, plus your own reminders. You get a notification when something is due.</p>
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="calendar-layout">
          <section className="calendar">
            <header className="calendar-head">
              <button className="btn btn-ghost btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month" type="button">
                ‹
              </button>
              <h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month" type="button">
                ›
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  const d = new Date();
                  setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                  setSelected(ymd(d));
                }}
                type="button"
              >
                Today
              </button>
            </header>
            <div className="calendar-grid" role="grid">
              {WEEKDAYS.map((w) => (
                <div key={w} className="calendar-wd">
                  {w}
                </div>
              ))}
              {days.map((d) => {
                const k = ymd(d);
                const items = byDay.get(k);
                const other = d.getMonth() !== month.getMonth();
                return (
                  <button key={k} className={`calendar-day ${other ? 'other' : ''} ${k === today ? 'today' : ''} ${k === selected ? 'selected' : ''}`} onClick={() => setSelected(k)} type="button" aria-label={d.toDateString()}>
                    <span className="calendar-num">{d.getDate()}</span>
                    {items?.tasks.slice(0, 3).map((t) => (
                      <span key={t.docId + t.key} className={`calendar-item task ${t.done ? 'done' : ''} ${!t.done && k < today ? 'late' : ''}`}>
                        {t.text || 'Task'}
                      </span>
                    ))}
                    {items?.reminders.slice(0, 2).map((r) => (
                      <span key={r.id} className="calendar-item reminder">
                        ⏰ {r.note}
                      </span>
                    ))}
                    {(items?.tasks.length ?? 0) + (items?.reminders.length ?? 0) > 5 && <span className="calendar-more">more…</span>}
                  </button>
                );
              })}
            </div>
          </section>
          <aside className="calendar-side">
            <h3>{new Date(`${selected}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
            {!day?.tasks.length && !day?.reminders.length && <p className="muted small">Nothing due.</p>}
            <ul className="day-list">
              {day?.tasks.map((t) => (
                <li key={t.docId + t.key} className={t.done ? 'done' : ''}>
                  <span>{t.done ? '☑' : '☐'}</span>
                  <div>
                    {t.text}
                    <Link className="small" to={`/d/${t.docId}`}>
                      {t.docTitle}
                    </Link>
                  </div>
                </li>
              ))}
              {day?.reminders.map((r) => (
                <li key={r.id}>
                  <span>⏰</span>
                  <div>
                    {r.note}
                    <span className="small muted">
                      {new Date(r.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      {r.docTitle && (
                        <>
                          {' · '}
                          <Link to={`/d/${r.docId}`}>{r.docTitle}</Link>
                        </>
                      )}
                    </span>
                  </div>
                  <button className="link-btn" onClick={() => void api(`/reminders/${r.id}`, { method: 'DELETE' }).then(load)} aria-label="Delete reminder" type="button">
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="reminder-form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api('/reminders', { method: 'POST', body: { note, at: new Date(`${selected}T${time}:00`).getTime() } });
                  setNote('');
                  setError(null);
                  load();
                } catch (err) {
                  setError(errorText(err));
                }
              }}
            >
              <label className="field">
                <span>Add a reminder on this day</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Send the proposal to Ravi" maxLength={300} required />
              </label>
              <div className="row-actions">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
                <button className="btn btn-primary btn-sm" type="submit">
                  <Icon name="bell" size={14} /> Remind me
                </button>
              </div>
            </form>
          </aside>
        </div>

        <section className="assigned">
          <div className="row-between">
            <h2>
              Assigned to me {overdue > 0 && <span className="pill status-changes">{overdue} overdue</span>}
            </h2>
            <label className="check-row small">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done
            </label>
          </div>
          {!tasks ? (
            <Spinner />
          ) : !mine.length ? (
            <p className="muted">No open tasks assigned to you. In a document, make a checklist item (type “[] ”), then pick a person and due date in the toolbar.</p>
          ) : (
            <ul className="task-list">
              {mine.map((t) => (
                <li key={t.docId + t.key} className={t.done ? 'done' : ''}>
                  <span className="task-box">{t.done ? '☑' : '☐'}</span>
                  <span className="task-text">{t.text}</span>
                  {t.due && <span className={`due ${!t.done && t.due < today ? 'due-overdue' : t.due === today ? 'due-today' : ''}`}>{new Date(`${t.due}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}
                  <Link to={`/d/${t.docId}`} className="small">
                    {t.docTitle}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
