import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText } from '../api.ts';
import { allowUrl, appApi } from '../lib/google.ts';
import { AppLogo } from './AppLogo.tsx';
import { GoogleGate } from './GoogleGate.tsx';
import { Modal, Spinner } from './ui.tsx';

interface Cal {
  id: string;
  summary: string;
  backgroundColor: string;
  primary?: boolean;
  accessRole: string;
}
interface Ev {
  id: string;
  calendarId: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  hangoutLink?: string;
}
type Mode = 'month' | 'week' | 'day';

const DAY = 86_400_000;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOf = (e: Ev) => new Date(e.start.dateTime ?? `${e.start.date}T00:00:00`);
const endOf = (e: Ev) => new Date(e.end.dateTime ?? `${e.end.date}T00:00:00`);
const allDay = (e: Ev) => !!e.start.date;
const hm = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monday = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));

/** Google Calendar inside CoWrite: month, week and day views of every calendar, with create, edit and delete. */
export function GCalendarApp() {
  return (
    <GoogleGate feature={null} tab="calendar">
      <Calendar />
    </GoogleGate>
  );
}

function Calendar() {
  const [mode, setMode] = useState<Mode>('week');
  const [cursor, setCursor] = useState(() => new Date());
  const [cals, setCals] = useState<Cal[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [open, setOpen] = useState<Ev | null>(null);
  const [edit, setEdit] = useState<Partial<Ev> & { calendarId: string } | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    if (mode === 'day') {
      const a = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      return [a, new Date(a.getTime() + DAY)];
    }
    if (mode === 'week') {
      const a = monday(cursor);
      return [a, new Date(a.getTime() + 7 * DAY)];
    }
    const a = monday(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    return [a, new Date(a.getTime() + 42 * DAY)];
  }, [mode, cursor]);

  useEffect(() => {
    appApi<{ items: Cal[] }>('calendar', 'users/me/calendarList?maxResults=50').then((r) => setCals(r.items.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0))), (e) => setError(errorText(e)));
    api<{ google: { features: { calendar?: boolean } } }>('/integrations').then((r) => setCanWrite(!!r.google.features.calendar), () => {});
  }, []);

  const load = useCallback(() => {
    if (!cals.length) return;
    setEvents(null);
    const params = new URLSearchParams({ timeMin: range[0].toISOString(), timeMax: range[1].toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '500' });
    Promise.all(
      cals
        .filter((c) => !hidden.has(c.id))
        .map((c) => appApi<{ items: Ev[] }>('calendar', `calendars/${encodeURIComponent(c.id)}/events?${params}`).then((r) => r.items.map((e) => ({ ...e, calendarId: c.id })), () => [] as Ev[])),
    ).then((lists) => setEvents(lists.flat()));
  }, [cals, hidden, range]);
  useEffect(() => load(), [load]);

  const color = (e: Ev) => cals.find((c) => c.id === e.calendarId)?.backgroundColor ?? '#1a73e8';
  const on = (d: Date) => (events ?? []).filter((e) => startOf(e) < new Date(d.getTime() + DAY) && endOf(e) > d && !(allDay(e) && endOf(e).getTime() === d.getTime()));
  const step = (n: number) =>
    setCursor((c) => (mode === 'month' ? new Date(c.getFullYear(), c.getMonth() + n, 1) : new Date(c.getTime() + n * (mode === 'week' ? 7 : 1) * DAY)));
  const label =
    mode === 'month'
      ? cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })
      : mode === 'week'
        ? `${range[0].toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${new Date(range[1].getTime() - DAY).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`
        : cursor.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const primary = cals.find((c) => c.primary)?.id ?? cals[0]?.id ?? 'primary';
  const newAt = (d: Date, hour?: number) => {
    if (!canWrite) return setError('Allow CoWrite to add events to Google Calendar first (button on the left).');
    const s = new Date(d);
    if (hour !== undefined) s.setHours(hour, 0, 0, 0);
    setEdit(
      hour === undefined
        ? { calendarId: primary, start: { date: ymd(d) }, end: { date: ymd(new Date(d.getTime() + DAY)) } }
        : { calendarId: primary, start: { dateTime: s.toISOString() }, end: { dateTime: new Date(s.getTime() + 3_600_000).toISOString() } },
    );
  };
  const del = async (e: Ev) => {
    if (!confirm(`Delete “${e.summary ?? 'this event'}”?`)) return;
    await appApi('calendar', `calendars/${encodeURIComponent(e.calendarId)}/events/${e.id}`, { method: 'DELETE' }).catch((err) => setError(errorText(err)));
    setOpen(null);
    load();
  };

  const days = Array.from({ length: Math.round((range[1].getTime() - range[0].getTime()) / DAY) }, (_, i) => new Date(range[0].getFullYear(), range[0].getMonth(), range[0].getDate() + i));
  const today = ymd(new Date());

  return (
    <div className="gm gc">
      <header className="gm-top">
        <span className="gm-brand">
          <AppLogo name="calendar" size={30} /> <b>Calendar</b>
        </span>
        <button className="gc-today" onClick={() => setCursor(new Date())} type="button">
          Today
        </button>
        <button className="gm-icon" onClick={() => step(-1)} aria-label="Previous" type="button">
          ‹
        </button>
        <button className="gm-icon" onClick={() => step(1)} aria-label="Next" type="button">
          ›
        </button>
        <b className="gc-label">{label}</b>
        <span className="gc-modes">
          {(['day', 'week', 'month'] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} type="button">
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </span>
      </header>
      <aside className="gm-side">
        <button className="gm-compose" onClick={() => newAt(new Date(), new Date().getHours() + 1)} type="button">
          ＋ <span>Create</span>
        </button>
        {!canWrite && (
          <a className="dr-allow" href={allowUrl('calendar', 'calendar')}>
            Allow creating and editing events
          </a>
        )}
        <Mini cursor={cursor} onPick={(d) => setCursor(d)} />
        <p className="gm-sub">My calendars</p>
        {cals.map((c) => (
          <label key={c.id} className="gc-cal">
            <input
              type="checkbox"
              checked={!hidden.has(c.id)}
              onChange={() => {
                const n = new Set(hidden);
                if (n.has(c.id)) n.delete(c.id);
                else n.add(c.id);
                setHidden(n);
              }}
              style={{ accentColor: c.backgroundColor }}
            />
            <span className="gm-lname">{c.summary}</span>
          </label>
        ))}
      </aside>
      <main className="gm-main gc-main">
        {error && (
          <p className="error-text gm-error" onClick={() => setError(null)}>
            {error}
          </p>
        )}
        {!events ? (
          <Spinner />
        ) : mode === 'month' ? (
          <div className="gc-month">
            {WD.map((w) => (
              <div key={w} className="gc-wd">
                {w}
              </div>
            ))}
            {days.map((d) => {
              const list = on(d);
              return (
                <div key={d.toISOString()} className={`gc-cell ${d.getMonth() !== cursor.getMonth() ? 'other' : ''}`} onDoubleClick={() => newAt(d)}>
                  <button className={`gc-num ${ymd(d) === today ? 'today' : ''}`} onClick={() => (setCursor(d), setMode('day'))} type="button">
                    {d.getDate() === 1 ? d.toLocaleDateString([], { day: 'numeric', month: 'short' }) : d.getDate()}
                  </button>
                  {list.slice(0, 4).map((e) => (
                    <button key={e.id + e.calendarId} className={`gc-chip ${allDay(e) ? 'all' : ''}`} style={{ '--c': color(e) } as React.CSSProperties} onClick={() => setOpen(e)} type="button">
                      {!allDay(e) && <span>{hm(startOf(e))}</span>} {e.summary ?? '(No title)'}
                    </button>
                  ))}
                  {list.length > 4 && <small className="muted">+{list.length - 4} more</small>}
                </div>
              );
            })}
          </div>
        ) : (
          <TimeGrid days={days} events={events} color={color} today={today} onOpen={setOpen} onNew={newAt} />
        )}
      </main>
      {open && (
        <Modal title={open.summary ?? '(No title)'} onClose={() => setOpen(null)}>
          <div className="gc-detail">
            <p>
              <span className="gc-dot" style={{ background: color(open) }} />
              {allDay(open)
                ? startOf(open).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
                : `${startOf(open).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · ${hm(startOf(open))} – ${hm(endOf(open))}`}
            </p>
            {open.location && <p>📍 {open.location}</p>}
            {open.hangoutLink && (
              <p>
                🎥{' '}
                <a href={open.hangoutLink} target="_blank" rel="noreferrer">
                  Join Google Meet
                </a>
              </p>
            )}
            {open.description && <p className="gc-desc">{open.description.replace(/<[^>]+>/g, ' ')}</p>}
            <p className="muted small">📅 {cals.find((c) => c.id === open.calendarId)?.summary}</p>
            <div className="row-actions">
              {canWrite && (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => (setEdit(open), setOpen(null))} type="button">
                    Edit
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => void del(open)} type="button">
                    Delete
                  </button>
                </>
              )}
              <a className="btn btn-text btn-sm" href={open.htmlLink} target="_blank" rel="noreferrer">
                Open in Google ↗
              </a>
            </div>
          </div>
        </Modal>
      )}
      {edit && <EventEditor ev={edit} cals={cals.filter((c) => ['owner', 'writer'].includes(c.accessRole))} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), load())} />}
    </div>
  );
}

function TimeGrid({ days, events, color, today, onOpen, onNew }: { days: Date[]; events: Ev[]; color(e: Ev): string; today: string; onOpen(e: Ev): void; onNew(d: Date, h?: number): void }) {
  const HOUR = 44;
  // Open at the working day (7 am) rather than midnight, like Google Calendar.
  const scrolled = useRef(false);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el || scrolled.current) return;
    scrolled.current = true;
    const box = el.closest('.gm-main');
    if (box) box.scrollTop = 7 * HOUR;
  }, []);
  return (
    <div className="gc-time" ref={ref}>
      <div className="gc-head" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
        <span />
        {days.map((d) => (
          <div key={d.toISOString()} className={`gc-dayhead ${ymd(d) === today ? 'today' : ''}`}>
            <small>{d.toLocaleDateString([], { weekday: 'short' })}</small>
            <b>{d.getDate()}</b>
            <div className="gc-allday">
              {events
                .filter((e) => allDay(e) && startOf(e) <= d && endOf(e) > d)
                .map((e) => (
                  <button key={e.id + e.calendarId} className="gc-chip all" style={{ '--c': color(e) } as React.CSSProperties} onClick={() => onOpen(e)} type="button">
                    {e.summary ?? '(No title)'}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="gc-body" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
        <div className="gc-hours">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} style={{ height: HOUR }}>
              {h ? new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' }) : ''}
            </span>
          ))}
        </div>
        {days.map((d) => (
          <div key={d.toISOString()} className="gc-col" style={{ height: HOUR * 24 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="gc-slot" style={{ height: HOUR }} onDoubleClick={() => onNew(d, h)} />
            ))}
            {ymd(d) === today && <span className="gc-now" style={{ top: ((new Date().getHours() * 60 + new Date().getMinutes()) / 60) * HOUR }} />}
            {events
              .filter((e) => !allDay(e) && ymd(startOf(e)) === ymd(d))
              .map((e) => {
                const s = startOf(e);
                const top = ((s.getHours() * 60 + s.getMinutes()) / 60) * HOUR;
                const h = Math.max(20, ((endOf(e).getTime() - s.getTime()) / 3_600_000) * HOUR - 2);
                return (
                  <button key={e.id + e.calendarId} className="gc-block" style={{ top, height: h, background: color(e) }} onClick={() => onOpen(e)} type="button">
                    <b>{e.summary ?? '(No title)'}</b>
                    <small>
                      {hm(s)} – {hm(endOf(e))}
                    </small>
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Mini({ cursor, onPick }: { cursor: Date; onPick(d: Date): void }) {
  const [m, setM] = useState(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  useEffect(() => setM(new Date(cursor.getFullYear(), cursor.getMonth(), 1)), [cursor]);
  const start = monday(m);
  const today = ymd(new Date());
  return (
    <div className="gc-mini">
      <div className="row-between">
        <b>{m.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
        <span>
          <button onClick={() => setM(new Date(m.getFullYear(), m.getMonth() - 1, 1))} aria-label="Previous month" type="button">
            ‹
          </button>
          <button onClick={() => setM(new Date(m.getFullYear(), m.getMonth() + 1, 1))} aria-label="Next month" type="button">
            ›
          </button>
        </span>
      </div>
      <div className="gc-mini-grid">
        {WD.map((w) => (
          <small key={w}>{w[0]}</small>
        ))}
        {Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)).map((d) => (
          <button key={d.toISOString()} className={`${d.getMonth() !== m.getMonth() ? 'other' : ''} ${ymd(d) === today ? 'today' : ''} ${ymd(d) === ymd(cursor) ? 'sel' : ''}`} onClick={() => onPick(d)} type="button">
            {d.getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}

function EventEditor({ ev, cals, onClose, onSaved }: { ev: Partial<Ev> & { calendarId: string }; cals: Cal[]; onClose(): void; onSaved(): void }) {
  const isAll = !!ev.start?.date;
  const local = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${ymd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const [f, setF] = useState({
    summary: ev.summary ?? '',
    allDay: isAll,
    day: ev.start?.date ?? ymd(new Date(ev.start?.dateTime ?? Date.now())),
    start: local(ev.start?.dateTime) || `${ymd(new Date())}T09:00`,
    end: local(ev.end?.dateTime) || `${ymd(new Date())}T10:00`,
    location: ev.location ?? '',
    description: (ev.description ?? '').replace(/<[^>]+>/g, ''),
    calendarId: ev.calendarId,
    meet: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const next = (d: string) => ymd(new Date(new Date(`${d}T00:00:00`).getTime() + DAY));
    const body = {
      summary: f.summary || '(No title)',
      location: f.location,
      description: f.description,
      ...(f.allDay ? { start: { date: f.day }, end: { date: next(f.day) } } : { start: { dateTime: new Date(f.start).toISOString(), timeZone: tz }, end: { dateTime: new Date(f.end).toISOString(), timeZone: tz } }),
      ...(f.meet ? { conferenceData: { createRequest: { requestId: `cw${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
    };
    try {
      const cal = encodeURIComponent(f.calendarId);
      const extra = f.meet ? '?conferenceDataVersion=1' : '';
      if (ev.id && ev.calendarId === f.calendarId) await appApi('calendar', `calendars/${cal}/events/${ev.id}${extra}`, { method: 'PATCH', body });
      else {
        await appApi('calendar', `calendars/${cal}/events${extra}`, { method: 'POST', body });
        if (ev.id) await appApi('calendar', `calendars/${encodeURIComponent(ev.calendarId)}/events/${ev.id}`, { method: 'DELETE' });
      }
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal title={ev.id ? 'Edit event' : 'New event'} onClose={onClose}>
      <div className="event-form">
        <input className="event-title" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder="Add title" autoFocus aria-label="Title" />
        <label className="check-row">
          <input type="checkbox" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} /> All day
        </label>
        <div className="event-when">
          {f.allDay ? (
            <input type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} aria-label="Date" />
          ) : (
            <>
              <input type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} aria-label="Starts" />
              <span>to</span>
              <input type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} aria-label="Ends" />
            </>
          )}
        </div>
        <input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="📍 Add location" aria-label="Location" />
        <label className="check-row">
          <input type="checkbox" checked={f.meet} onChange={(e) => setF({ ...f, meet: e.target.checked })} /> 🎥 Add a Google Meet video call
        </label>
        <textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Add description" aria-label="Description" />
        <select className="input" value={f.calendarId} onChange={(e) => setF({ ...f, calendarId: e.target.value })} aria-label="Calendar">
          {cals.map((c) => (
            <option key={c.id} value={c.id}>
              {c.summary}
            </option>
          ))}
        </select>
        {error && <p className="error-text">{error}</p>}
        <div className="row-between">
          <span />
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()} type="button">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
