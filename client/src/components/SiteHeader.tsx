import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api, timeAgo, type Notification, type Prefs, type ThemeId } from '../api.ts';
import { APPS } from '../lib/apps.ts';
import { APP_THEMES, effectiveTheme, localPrefs, savePrefs } from '../lib/prefs.ts';
import { ThemeIcon } from './ThemeIcon.tsx';
import { ProductIcon } from './ProductIcon.tsx';
import { AppLogo } from './AppLogo.tsx';
import { useWindows, WINDOW_APPS, type WindowApp } from './Windows.tsx';
import { useAuth } from '../auth.tsx';
import { Link, navigate } from '../router.ts';
import { Brand } from './Brand.tsx';
import { Avatar, Dropdown, Icon } from './ui.tsx';

const SECTIONS = [
  { to: '/#features', label: 'Features', icon: 'sparkle' },
  { to: '/#playground', label: 'Live Demo', icon: 'play' },
  { to: '/#how', label: 'How It Works', icon: 'book' },
  { to: '/#about', label: 'About', icon: 'info' },
  { to: '/#contact', label: 'Contact', icon: 'phone' },
];

/** The nine-dot app launcher. */
export function AppLauncher() {
  const windows = useWindows();
  return (
    <Dropdown className="icon-button app-launcher" ariaLabel="CoWrite apps" label={<Icon name="grid" size={20} />}>
      {(close) => (
        <div className="launcher-wrap">
          <p className="launcher-h">Your Google &amp; GitHub</p>
          <div className="launcher" role="menu">
            {(Object.keys(WINDOW_APPS) as WindowApp[]).map((k) => (
              <button key={k} role="menuitem" className="launcher-app" onClick={() => (close(), windows.open(k))} title={`Open ${WINDOW_APPS[k].title} in a window`} type="button">
                <span className="launcher-icon">
                  <AppLogo name={WINDOW_APPS[k].logo} size={30} />
                </span>
                <span>{WINDOW_APPS[k].title.replace('Google ', '')}</span>
              </button>
            ))}
          </div>
          <p className="launcher-h">CoWrite</p>
        <div className="launcher" role="menu">
          {APPS.map((a) => (
            <Link key={a.id} role="menuitem" className="launcher-app" to={a.to} onClick={close} title={a.blurb}>
              <span className="launcher-icon">
                <ProductIcon id={a.id} size={34} />
              </span>
              <span>{a.name}</span>
            </Link>
          ))}
        </div>
        </div>
      )}
    </Dropdown>
  );
}

export function UserMenu() {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <Dropdown
      className="user-button"
      ariaLabel="Account menu"
      label={
        <>
          <Avatar name={user.name} src={user.avatar} size={30} />
          <span className="user-name">{user.name}</span>
          <span aria-hidden="true">▾</span>
        </>
      }
    >
      {(close) => (
        <>
          <div className="menu-head">
            <strong>{user.name}</strong>
            <span className="muted small">@{user.username}</span>
          </div>
          <Link role="menuitem" to="/documents" onClick={close}>
            My documents
          </Link>
          <Link role="menuitem" to="/calendar" onClick={close}>
            Calendar &amp; tasks
          </Link>
          <Link role="menuitem" to="/workspaces" onClick={close}>
            Teams &amp; workspaces
          </Link>
          <Link role="menuitem" to="/ask" onClick={close}>
            Ask your documents (AI)
          </Link>
          <Link role="menuitem" to="/activity" onClick={close}>
            Activity, streaks &amp; goals
          </Link>
          <Link role="menuitem" to={`/u/${user.username}`} onClick={close}>
            Public profile
          </Link>
          <Link role="menuitem" to="/account" onClick={close}>
            Account settings
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={async () => {
              close();
              await signOut();
              navigate('/');
            }}
          >
            Sign out
          </button>
        </>
      )}
    </Dropdown>
  );
}

/** In-app notifications: mentions, comments, replies, merges. */
export function NotificationBell() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(() => {
    api<{ notifications: Notification[]; unread: number }>('/notifications')
      .then((r) => {
        setItems(r.notifications);
        setUnread(r.unread);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
    const t = setInterval(load, 30_000);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', load);
    };
  }, [user, load]);

  if (!user) return null;
  const markAll = async () => {
    await api('/notifications/read', { method: 'POST', body: {} }).catch(() => {});
    load();
  };

  return (
    <Dropdown
      className="icon-button bell"
      ariaLabel={`Notifications${unread ? ` (${unread} unread)` : ''}`}
      label={
        <>
          <Icon name="bell" />
          {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
        </>
      }
    >
      {(close) => (
        <div className="notifications">
          <div className="menu-head row-between">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button className="btn btn-text btn-sm" onClick={markAll} type="button">
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 && <p className="muted small pad">You are all caught up.</p>}
          {items.map((n) => (
            <button
              key={n.id}
              className={n.read ? 'notification' : 'notification unread'}
              role="menuitem"
              type="button"
              onClick={() => {
                close();
                void api('/notifications/read', { method: 'POST', body: { id: n.id } }).then(load, () => {});
                if (n.docId) navigate(`/d/${n.docId}`);
              }}
            >
              <span>
                <strong>{n.actorName}</strong> {n.body}
              </span>
              <span className="muted small">{timeAgo(n.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

/** Colour theme picker; the choice follows your account. */
export function ThemeToggle() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState(localPrefs);
  useEffect(() => {
    const on = (e: Event) => setPrefs((e as CustomEvent<Prefs>).detail);
    window.addEventListener('cowrite:prefs', on);
    return () => window.removeEventListener('cowrite:prefs', on);
  }, []);
  const cur = APP_THEMES.find((t) => t.id === prefs.theme) ?? APP_THEMES[1];
  const shown = effectiveTheme(prefs.theme);
  const pick = (id: ThemeId, close: () => void) => {
    void savePrefs({ ...prefs, theme: id }, !!user);
    close();
  };
  const group = (title: string, list: typeof APP_THEMES, close: () => void) => (
    <>
      <span className="menu-label">{title}</span>
      <div className="theme-grid-menu">
        {list.map((t) => (
          <button
            key={t.id}
            role="menuitemradio"
            aria-checked={t.id === prefs.theme}
            className={`theme-option ${t.id === prefs.theme ? 'on' : ''}`}
            style={{ '--sw-bg': t.bg, '--sw-fg': t.fg, '--sw-ac': t.accent } as CSSProperties}
            onClick={() => pick(t.id, close)}
            type="button"
          >
            <span className="theme-swatch">
              <ThemeIcon name={t.icon} size={18} />
            </span>
            {t.name}
            {t.id === prefs.theme && <span className="theme-check">✓</span>}
          </button>
        ))}
      </div>
    </>
  );
  return (
    <Dropdown className="icon-button theme-toggle" ariaLabel={`Colour theme: ${cur.name}`} label={<ThemeIcon name={prefs.theme === 'auto' ? 'auto' : shown.icon} size={20} color={shown.dark ? '#f5c451' : '#e8a317'} />}>
      {(close) => (
        <div className="theme-menu wide" role="menu">
          {group('Light themes', APP_THEMES.filter((t) => !t.dark), close)}
          {group('Dark themes', APP_THEMES.filter((t) => t.dark), close)}
          <Link className="theme-more" to="/account#appearance" onClick={close}>
            Text size, spacing and accessibility →
          </Link>
        </div>
      )}
    </Dropdown>
  );
}

export function SiteHeader() {
  const { user, ready } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="header-inner">
        <Brand />
        <button className="nav-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="Menu" type="button">
          <span />
          <span />
          <span />
        </button>
        <nav className={`site-nav ${menuOpen ? 'open' : ''}`} aria-label="Main">
          <Link to={user ? '/home' : '/'} onClick={() => setMenuOpen(false)} className="nav-home">
            <Icon name="home" size={16} /> Home
          </Link>
          {SECTIONS.map((s) => (
            <Link key={s.to} to={s.to} onClick={() => setMenuOpen(false)}>
              <Icon name={s.icon} size={15} /> {s.label}
            </Link>
          ))}
          {user && (
            <Link to="/documents" onClick={() => setMenuOpen(false)}>
              <Icon name="folder" size={15} /> My Documents
            </Link>
          )}
        </nav>
        <div className="header-actions">
          {ready && !user && (
            <>
              <Link className="btn btn-text" to="/signin">
                Sign in
              </Link>
              <Link className="btn btn-primary" to="/signup">
                Get started
              </Link>
            </>
          )}
          <AppLauncher />
          <ThemeToggle />
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
