import { useCallback, useEffect, useState } from 'react';
import { api, timeAgo, type Notification, type Prefs } from '../api.ts';
import { localPrefs, savePrefs } from '../lib/prefs.ts';
import { useAuth } from '../auth.tsx';
import { Link, navigate } from '../router.ts';
import { Brand } from './Brand.tsx';
import { Avatar, Dropdown, Icon } from './ui.tsx';

const SECTIONS = [
  { to: '/#features', label: 'Features' },
  { to: '/#playground', label: 'Live Demo' },
  { to: '/#how', label: 'How It Works' },
  { to: '/#about', label: 'About' },
  { to: '/#contact', label: 'Contact' },
];

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

const THEME_NEXT = { light: 'dark', dark: 'sepia', sepia: 'light' } as const;
const THEME_LABEL = { light: 'Light theme', dark: 'Dark theme', sepia: 'Sepia reading theme' } as const;

/** Cycles light → dark → sepia; the choice follows your account. */
export function ThemeToggle() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState(localPrefs);
  useEffect(() => {
    const on = (e: Event) => setPrefs((e as CustomEvent<Prefs>).detail);
    window.addEventListener('cowrite:prefs', on);
    return () => window.removeEventListener('cowrite:prefs', on);
  }, []);
  const next = THEME_NEXT[prefs.theme];
  return (
    <button
      className="icon-button theme-toggle"
      onClick={() => void savePrefs({ ...prefs, theme: next }, !!user)}
      title={`${THEME_LABEL[prefs.theme]} · switch to ${THEME_LABEL[next].toLowerCase()}`}
      aria-label={`Switch to ${THEME_LABEL[next].toLowerCase()}`}
      type="button"
    >
      {prefs.theme === 'light' ? <Icon name="moon" size={18} /> : prefs.theme === 'dark' ? <span aria-hidden>📜</span> : <span aria-hidden>☀️</span>}
    </button>
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
          {SECTIONS.map((s) => (
            <Link key={s.to} to={s.to} onClick={() => setMenuOpen(false)}>
              {s.label}
            </Link>
          ))}
          {user && (
            <Link to="/documents" onClick={() => setMenuOpen(false)}>
              My Documents
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
          <ThemeToggle />
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
