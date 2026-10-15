import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorText } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Icon, Modal, Spinner } from '../components/ui.tsx';
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
export interface CalEvent {
  id: string;
  title: string;
  notes: string;
  day: string;
  start: string | null;
  end: string | null;
  color: string;
  kind: string;
  remind: boolean;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => new Date(`${s}T00:00:00`);
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = Array.from({ length: 12 }, (_, m) => new Date(2000, m, 1).toLocaleDateString(undefined, { month: 'long' }));
export const EVENT_KINDS: { id: string; label: string; icon: string; color: string }[] = [
  { id: 'event', label: 'Event', icon: '📌', color: 'blue' },
  { id: 'important', label: 'Important', icon: '⭐', color: 'red' },
  { id: 'meeting', label: 'Meeting', icon: '👥', color: 'teal' },
  { id: 'task', label: 'Task / deadline', icon: '✅', color: 'green' },
  { id: 'birthday', label: 'Birthday', icon: '🎂', color: 'pink' },
  { id: 'reminder', label: 'Reminder', icon: '⏰', color: 'orange' },
];
export const EVENT_COLORS: Record<string, string> = {
  blue: '#1a73e8',
  red: '#d93025',
  green: '#188038',
  purple: '#8e24aa',
  orange: '#f29900',
  teal: '#00897b',
  pink: '#e91e63',
  gray: '#5f6368',
  yellow: '#f9ab00',
};
const kindOf = (k: string) => EVENT_KINDS.find((x) => x.id === k) ?? EVENT_KINDS[0];
const fmtTime = (t: string | null) => (t ? new Date(`2000-01-01T${t}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');

/** A real calendar: browse any month and year, jump to any date, schedule events, tasks and reminders. */
export function CalendarPage() {
  const { user, ready } = useAuth();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState(() => ymd(new Date()));
  const [editing, setEditing] = useState<Partial<CalEvent> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [gcalWrite, setGcalWrite] = useState(false);
  const [sent, setSent] = useState<Set<string>>(new Set());
  useEffect(() => {
    api<{ google: { connected: boolean; features: { calendar?: boolean } } }>('/integrations').then((r) => setGcalWrite(r.google.connected && !!r.google.features.calendar), () => {});
  }, []);
  const toGoogle = async (id: string) => {
    try {
      await api(`/events/${id}/google`, { method: 'POST', body: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      setSent((x) => new Set([...x, id]));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const loadEvents = useCallback(() => {
    // Everything visible in the grid, plus the next two months for "Upcoming".
    const from = ymd(new Date(month.getFullYear(), month.getMonth() - 1, 20));
    const to = ymd(new Date(month.getFullYear(), month.getMonth() + 3, 10));
    const mine = api<{ events: CalEvent[] }>(`/events?from=${from}&to=${to}`).then((r) => r.events);
    // Google Calendar events appear alongside (read-only) when Google is connected.
    const google = api<{ events: { id: string; title: string; url: string; allDay: boolean; start: string; end: string; location: string }[] }>(`/integrations/google/calendar?from=${from}&to=${to}`).then(
      (r) =>
        r.events.map((g): CalEvent => {
          const st = new Date(g.start);
          const en = new Date(g.end);
          const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          return { id: `g:${g.id}`, title: `🗓 ${g.title}`, notes: g.url, day: g.allDay ? g.start.slice(0, 10) : ymd(st), start: g.allDay ? null : hm(st), end: g.allDay ? null : hm(en), color: 'teal', kind: 'meeting', remind: false };
        }),
      () => [] as CalEvent[],
    );
    Promise.all([mine, google]).then(([a, b]) => setEvents([...a, ...b].sort((x, y) => (x.day + (x.start ?? '')).localeCompare(y.day + (y.start ?? '')))), (e) => setError(errorText(e)));
  }, [month]);

  useEffect(() => {
    document.title = 'Calendar · CoWrite';
    if (!ready) return;
    if (!user) return navigate('/signin?next=/calendar');
    api<{ tasks: Task[] }>('/tasks').then((r) => setTasks(r.tasks), (e) => setError(errorText(e)));
    api<{ reminders: Reminder[] }>('/reminders').then((r) => setReminders(r.reminders), () => {});
  }, [ready, user]);
  useEffect(() => {
    if (ready && user) loadEvents();
  }, [ready, user, loadEvents]);

  const goTo = (day: string) => {
    const d = parse(day);
    if (Number.isNaN(d.getTime())) return;
    setSelected(day);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  const byDay = useMemo(() => {
    const m = new Map<string, { events: CalEvent[]; tasks: Task[]; reminders: Reminder[] }>();
    const get = (k: string) => m.get(k) ?? (m.set(k, { events: [], tasks: [], reminders: [] }), m.get(k)!);
    for (const e of events) get(e.day).events.push(e);
    for (const t of tasks ?? []) if (t.due) get(t.due).tasks.push(t);
    for (const r of reminders) get(ymd(new Date(r.at))).reminders.push(r);
    return m;
  }, [events, tasks, reminders]);

  if (!ready || !user) return <Spinner />;

  const offset = (month.getDay() + 6) % 7;
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - offset);
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const today = ymd(new Date());
  const day = byDay.get(selected);
  const mine = (tasks ?? []).filter((t) => t.mine && (showDone || !t.done));
  const overdue = mine.filter((t) => !t.done && t.due && t.due < today).length;
  const upcoming = events.filter((e) => e.day >= today).slice(0, 6);
  const sel = parse(selected);
  const years = Array.from({ length: 121 }, (_, i) => 1950 + i);

  const save = async (e: Partial<CalEvent>) => {
    const allDay = !e.start;
    const at = allDay ? new Date(`${e.day}T09:00:00`) : new Date(`${e.day}T${e.start}:00`);
    const body = { ...e, remindAt: at.getTime() - (allDay ? 0 : 10 * 60_000) };
    if (e.id) await api(`/events/${e.id}`, { method: 'PUT', body });
    else await api('/events', { method: 'POST', body });
    goTo(e.day!);
    loadEvents();
  };

  return (
    <div className="page">
      <SiteHeader />
      <main className="container calendar-page">
        <div className="cal-top">
          <div>
            <p className="kicker">Planner</p>
            <h1>Calendar</h1>
          </div>
          <button className="btn btn-primary" onClick={() => setEditing({ day: selected, kind: 'event', color: 'blue', remind: true, start: '09:00', end: '10:00' })} type="button">
            <Icon name="plus" size={16} /> New event
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}

        <div className="calendar-layout">
          <section className="calendar">
            <header className="calendar-head">
              <button className="cal-nav" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month" type="button">
                ‹
              </button>
              <select className="cal-select" value={month.getMonth()} onChange={(e) => setMonth(new Date(month.getFullYear(), Number(e.target.value), 1))} aria-label="Month">
                {MONTHS.map((m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ))}
              </select>
              <select className="cal-select" value={month.getFullYear()} onChange={(e) => setMonth(new Date(Number(e.target.value), month.getMonth(), 1))} aria-label="Year">
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <button className="cal-nav" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month" type="button">
                ›
              </button>
              <span className="tb-flex" />
              <label className="cal-jump" title="Jump to any date">
                <Icon name="calendar" size={15} />
                <input type="date" value={selected} onChange={(e) => e.target.value && goTo(e.target.value)} aria-label="Go to date" />
              </label>
              <button className="btn btn-outline btn-sm" onClick={() => goTo(today)} type="button">
                Today
              </button>
            </header>
            <div className="calendar-grid" role="grid">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`calendar-wd ${i >= 5 ? 'weekend' : ''}`}>
                  {w}
                </div>
              ))}
              {days.map((d, i) => {
                const k = ymd(d);
                const items = byDay.get(k);
                const other = d.getMonth() !== month.getMonth();
                const chips = [
                  ...(items?.events ?? []).map((e) => ({ key: e.id, label: `${kindOf(e.kind).icon} ${e.title}`, color: EVENT_COLORS[e.color] ?? EVENT_COLORS.blue })),
                  ...(items?.tasks ?? []).map((t) => ({ key: t.docId + t.key, label: `☐ ${t.text || 'Task'}`, color: !t.done && k < today ? '#d93025' : '#188038' })),
                  ...(items?.reminders ?? []).map((r) => ({ key: r.id, label: `⏰ ${r.note}`, color: '#f29900' })),
                ];
                return (
                  <button
                    key={k}
                    className={`calendar-day ${other ? 'other' : ''} ${k === today ? 'today' : ''} ${k === selected ? 'selected' : ''} ${i % 7 >= 5 ? 'weekend' : ''}`}
                    onClick={() => setSelected(k)}
                    onDoubleClick={() => setEditing({ day: k, kind: 'event', color: 'blue', remind: true, start: '09:00', end: '10:00' })}
                    type="button"
                    aria-label={`${d.toDateString()}${chips.length ? `, ${chips.length} items` : ''}`}
                  >
                    <span className="calendar-num">{d.getDate()}</span>
                    {chips.slice(0, 2).map((c) => (
                      <span key={c.key} className="cal-chip" style={{ '--c': c.color } as React.CSSProperties}>
                        {c.label}
                      </span>
                    ))}
                    {chips.length > 2 && <span className="calendar-more">+{chips.length - 2} more</span>}
                  </button>
                );
              })}
            </div>
            <p className="cal-hint muted small">Tip: double-click a day to add an event on it.</p>
          </section>

          <aside className="calendar-side">
            <div className="day-hero">
              <span className="day-hero-num">{sel.getDate()}</span>
              <span>
                <strong>{sel.toLocaleDateString(undefined, { weekday: 'long' })}</strong>
                <span className="muted small">{sel.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
              </span>
              <button className="btn btn-outline btn-sm" onClick={() => setEditing({ day: selected, kind: 'event', color: 'blue', remind: true, start: '09:00', end: '10:00' })} type="button">
                + Add
              </button>
            </div>
            {!day?.events.length && !day?.tasks.length && !day?.reminders.length && <p className="muted small">Nothing scheduled. Add an event, a deadline or a reminder.</p>}
            <ul className="day-list">
              {day?.events.map((e) => (
                <li key={e.id} className="day-event" style={{ '--c': EVENT_COLORS[e.color] ?? EVENT_COLORS.blue } as React.CSSProperties}>
                  <button className="day-event-btn" onClick={() => (e.id.startsWith('g:') ? window.open(e.notes, '_blank', 'noopener') : setEditing(e))} title={e.id.startsWith('g:') ? 'From Google Calendar: opens in Google' : undefined} type="button">
                    <span className="day-time">{e.start ? `${fmtTime(e.start)}${e.end ? ` – ${fmtTime(e.end)}` : ''}` : 'All day'}</span>
                    <strong>
                      {kindOf(e.kind).icon} {e.title}
                    </strong>
                    {e.notes && <span className="muted small">{e.notes}</span>}
                  </button>
                  {gcalWrite && !e.id.startsWith('g:') && (
                    <button className="link-btn to-google" disabled={sent.has(e.id)} onClick={() => void toGoogle(e.id)} title="Add this event to your Google Calendar" type="button">
                      {sent.has(e.id) ? '✓ In Google' : '→ Google'}
                    </button>
                  )}
                </li>
              ))}
              {day?.tasks.map((t) => (
                <li key={t.docId + t.key} className={`day-event ${t.done ? 'done' : ''}`} style={{ '--c': '#188038' } as React.CSSProperties}>
                  <Link className="day-event-btn" to={`/d/${t.docId}`}>
                    <span className="day-time">Task · {t.docTitle}</span>
                    <strong>
                      {t.done ? '☑' : '☐'} {t.text}
                    </strong>
                  </Link>
                </li>
              ))}
              {day?.reminders.map((r) => (
                <li key={r.id} className="day-event" style={{ '--c': '#f29900' } as React.CSSProperties}>
                  <span className="day-event-btn">
                    <span className="day-time">{new Date(r.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                    <strong>⏰ {r.note}</strong>
                  </span>
                  <button className="link-btn" onClick={() => void api(`/reminders/${r.id}`, { method: 'DELETE' }).then(() => setReminders((x) => x.filter((y) => y.id !== r.id)))} aria-label="Delete reminder" type="button">
                    ×
                  </button>
                </li>
              ))}
            </ul>
            {upcoming.length > 0 && (
              <>
                <h3 className="side-h">Upcoming</h3>
                <ul className="upcoming">
                  {upcoming.map((e) => (
                    <li key={e.id}>
                      <button onClick={() => goTo(e.day)} type="button">
                        <span className="up-date" style={{ background: EVENT_COLORS[e.color] ?? EVENT_COLORS.blue }}>
                          <b>{parse(e.day).getDate()}</b>
                          {parse(e.day).toLocaleDateString(undefined, { month: 'short' })}
                        </span>
                        <span>
                          {kindOf(e.kind).icon} {e.title}
                          <small className="muted">{e.start ? fmtTime(e.start) : 'All day'}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        </div>

        <section className="assigned" id="tasks">
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
                  {t.due && (
                    <button className={`due ${!t.done && t.due < today ? 'due-overdue' : t.due === today ? 'due-today' : ''}`} onClick={() => goTo(t.due!)} type="button">
                      {parse(t.due).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </button>
                  )}
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
      {editing && (
        <EventDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (e) => {
            await save(e);
            setEditing(null);
          }}
          onDelete={
            editing.id
              ? async () => {
                  await api(`/events/${editing.id}`, { method: 'DELETE' });
                  setEditing(null);
                  loadEvents();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/** Create or edit an event on any date. */
function EventDialog({ initial, onClose, onSave, onDelete }: { initial: Partial<CalEvent>; onClose(): void; onSave(e: Partial<CalEvent>): Promise<void>; onDelete?(): Promise<void> }) {
  const [e, setE] = useState<Partial<CalEvent>>({ remind: true, color: 'blue', kind: 'event', ...initial });
  const [allDay, setAllDay] = useState(!initial.start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<CalEvent>) => setE((x) => ({ ...x, ...p }));
  return (
    <Modal title={e.id ? 'Edit event' : 'New event'} onClose={onClose}>
      <form
        className="event-form"
        onSubmit={async (ev) => {
          ev.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onSave({ ...e, start: allDay ? null : e.start, end: allDay ? null : e.end });
          } catch (err) {
            setError(errorText(err));
            setBusy(false);
          }
        }}
      >
        <input className="event-title" value={e.title ?? ''} onChange={(x) => set({ title: x.target.value })} placeholder="Add a title" autoFocus required maxLength={200} />
        <div className="kind-row">
          {EVENT_KINDS.map((k) => (
            <button key={k.id} type="button" className={`kind-chip ${e.kind === k.id ? 'on' : ''}`} onClick={() => set({ kind: k.id, color: k.color })}>
              {k.icon} {k.label}
            </button>
          ))}
        </div>
        <div className="event-when">
          <label className="field">
            <span>Date</span>
            <input type="date" value={e.day ?? ''} onChange={(x) => set({ day: x.target.value })} required />
          </label>
          {!allDay && (
            <>
              <label className="field">
                <span>Starts</span>
                <input type="time" value={e.start ?? ''} onChange={(x) => set({ start: x.target.value })} required />
              </label>
              <label className="field">
                <span>Ends</span>
                <input type="time" value={e.end ?? ''} onChange={(x) => set({ end: x.target.value })} />
              </label>
            </>
          )}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={allDay} onChange={(x) => setAllDay(x.target.checked)} /> All day
        </label>
        <div className="field">
          <span>Colour</span>
          <div className="event-colors">
            {Object.entries(EVENT_COLORS).map(([name, c]) => (
              <button key={name} type="button" className={`event-color ${e.color === name ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ color: name })} aria-label={name} />
            ))}
          </div>
        </div>
        <label className="field">
          <span>Notes</span>
          <textarea rows={3} value={e.notes ?? ''} onChange={(x) => set({ notes: x.target.value })} placeholder="Location, agenda, link…" maxLength={2000} />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={e.remind !== false} onChange={(x) => set({ remind: x.target.checked })} /> Notify me {allDay ? 'at 9:00 that day' : '10 minutes before'}
        </label>
        {error && <p className="error-text small">{error}</p>}
        <div className="row-actions end">
          {onDelete && (
            <button className="btn btn-text btn-sm danger" onClick={() => void onDelete()} type="button">
              Delete
            </button>
          )}
          <span className="tb-flex" />
          <button className="btn btn-outline btn-sm" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy} type="submit">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
