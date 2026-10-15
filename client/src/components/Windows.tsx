import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { navigate } from '../router.ts';
import { AppLogo, type AppLogoName } from './AppLogo.tsx';
import { Spinner } from './ui.tsx';

/** Apps that open as floating windows inside CoWrite. */
export const WINDOW_APPS = {
  gmail: { title: 'Gmail', logo: 'gmail', page: '/connections?tab=gmail', size: [980, 620] },
  youtube: { title: 'YouTube', logo: 'youtube', page: '/connections?tab=youtube', size: [900, 600] },
  drive: { title: 'Google Drive', logo: 'drive', page: '/connections?tab=drive', size: [1000, 620] },
  calendar: { title: 'Google Calendar', logo: 'calendar', page: '/connections?tab=calendar', size: [1040, 660] },
  tasks: { title: 'Google Tasks', logo: 'tasks', page: '/connections?tab=tasks', size: [760, 560] },
  github: { title: 'GitHub', logo: 'github', page: '/connections?tab=repos', size: [1000, 640] },
} as const satisfies Record<string, { title: string; logo: AppLogoName; page: string; size: readonly [number, number] }>;
export type WindowApp = keyof typeof WINDOW_APPS;

const Gmail = lazy(() => import('./GmailApp.tsx').then((m) => ({ default: m.GmailApp })));
const YouTube = lazy(() => import('./YouTubeApp.tsx').then((m) => ({ default: m.YouTubeApp })));
const Drive = lazy(() => import('./DriveApp.tsx').then((m) => ({ default: m.DriveApp })));
const Calendar = lazy(() => import('./GCalendarApp.tsx').then((m) => ({ default: m.GCalendarApp })));
const Tasks = lazy(() => import('./TasksApp.tsx').then((m) => ({ default: m.TasksApp })));
const GitHub = lazy(() => import('./GitHubApp.tsx').then((m) => ({ default: m.GitHubApp })));
const BODY: Record<WindowApp, () => ReactNode> = {
  gmail: () => <Gmail />,
  youtube: () => <YouTube />,
  drive: () => <Drive />,
  calendar: () => <Calendar />,
  tasks: () => <Tasks />,
  github: () => <GitHub />,
};

interface Win {
  app: WindowApp;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  min: boolean;
  max: boolean;
}

const STORE = 'cowrite:windows';
const Ctx = createContext<{ open(app: WindowApp): void }>({ open: () => {} });
export const useWindows = () => useContext(Ctx);

/** Holds the open app windows; they stay open while you move around CoWrite. */
export function WindowsProvider({ children }: { children: ReactNode }) {
  // Open windows come back after a reload (this tab only).
  const [wins, setWins] = useState<Win[]>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) ?? '[]') as Win[];
      return saved.filter((w) => w.app in WINDOW_APPS).map((w) => ({ ...w, x: Math.min(w.x, innerWidth - 160), y: Math.min(Math.max(0, w.y), innerHeight - 60) }));
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(wins));
    } catch {
      // Storage blocked: windows simply are not restored.
    }
  }, [wins]);
  const top = useRef(Math.max(100, ...wins.map((w) => w.z)));

  const focus = useCallback((app: WindowApp, patch: Partial<Win> = {}) => setWins((ws) => ws.map((w) => (w.app === app ? { ...w, ...patch, z: ++top.current } : w))), []);
  const open = useCallback(
    (app: WindowApp) =>
      setWins((ws) => {
        if (ws.some((w) => w.app === app)) return ws.map((w) => (w.app === app ? { ...w, min: false, z: ++top.current } : w));
        const [w0, h0] = WINDOW_APPS[app].size;
        const w = Math.min(w0, innerWidth - 40);
        const h = Math.min(h0, innerHeight - 110);
        const n = ws.length;
        return [...ws, { app, w, h, x: Math.max(10, innerWidth - w - 40 - n * 34), y: Math.max(70, 90 + n * 30), z: ++top.current, min: false, max: false }];
      }),
    [],
  );
  const close = (app: WindowApp) => setWins((ws) => ws.filter((w) => w.app !== app));
  const value = useMemo(() => ({ open }), [open]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* One layer above the page but below the header, its menus and dialogs. */}
      <div className="win-layer">
        {wins.map((w) => (
          <AppWindow key={w.app} win={w} onFocus={() => focus(w.app)} onChange={(p) => focus(w.app, p)} onClose={() => close(w.app)} />
        ))}
      {wins.some((w) => w.min) && (
        <div className="win-taskbar" role="toolbar" aria-label="Minimised windows">
          {wins
            .filter((w) => w.min)
            .map((w) => (
              <button key={w.app} onClick={() => focus(w.app, { min: false })} type="button">
                <AppLogo name={WINDOW_APPS[w.app].logo} size={18} /> {WINDOW_APPS[w.app].title}
              </button>
            ))}
        </div>
      )}
      </div>
    </Ctx.Provider>
  );
}

function AppWindow({ win, onFocus, onChange, onClose }: { win: Win; onFocus(): void; onChange(p: Partial<Win>): void; onClose(): void }) {
  const app = WINDOW_APPS[win.app];
  const drag = (e: React.PointerEvent, mode: 'move' | 'size') => {
    if (win.max || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    onFocus();
    const start = { px: e.clientX, py: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      if (mode === 'move') onChange({ x: Math.min(innerWidth - 120, Math.max(-start.w + 160, start.x + dx)), y: Math.min(innerHeight - 40, Math.max(0, start.y + dy)) });
      else onChange({ w: Math.max(380, start.w + dx), h: Math.max(260, start.h + dy) });
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  const style: CSSProperties = win.max ? { zIndex: win.z } : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z };
  return (
    <section className={`app-window ${win.max ? 'max' : ''} ${win.min ? 'min' : ''}`} style={style} onPointerDown={onFocus} role="dialog" aria-label={app.title}>
      <header className="win-bar" onPointerDown={(e) => drag(e, 'move')} onDoubleClick={() => onChange({ max: !win.max })}>
        <AppLogo name={app.logo} size={18} />
        <b>{app.title}</b>
        <span className="win-buttons">
          <button onClick={() => onChange({ min: true })} title="Minimise" aria-label="Minimise" type="button">
            ─
          </button>
          <button onClick={() => onChange({ max: !win.max })} title={win.max ? 'Restore' : 'Maximise'} aria-label={win.max ? 'Restore' : 'Maximise'} type="button">
            {win.max ? '❐' : '□'}
          </button>
          <button onClick={() => (onClose(), navigate(app.page))} title="Open as a full page" aria-label="Open as a full page" type="button">
            ↗
          </button>
          <button className="win-close" onClick={onClose} title="Close" aria-label="Close" type="button">
            ✕
          </button>
        </span>
      </header>
      <div className="win-body">
        <Suspense fallback={<Spinner />}>{BODY[win.app]()}</Suspense>
      </div>
      {!win.max && <span className="win-resize" onPointerDown={(e) => drag(e, 'size')} aria-hidden />}
    </section>
  );
}
