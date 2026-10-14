import { useEffect } from 'react';
import { Link, navigate, usePath, useSearch } from '../router.ts';
import { Icon } from './ui.tsx';

const MAIN = [
  { id: 'home', to: '/home', label: 'Home', icon: 'home' },
  { id: 'ai', to: '/ai', label: 'AI', icon: 'sparkle' },
  { id: 'docs', to: '/documents?kind=doc', label: 'Docs', icon: 'file' },
  { id: 'slides', to: '/documents?kind=slides', label: 'Slides', icon: 'play' },
  { id: 'sheets', to: '/documents?kind=sheet', label: 'Sheets', icon: 'table' },
  { id: 'pdf', to: '/ai?tool=pdf-word', label: 'PDF', icon: 'book' },
  { id: 'ai-slides', to: '/ai?tool=slides-create', label: 'AI Slides', icon: 'wand' },
  { id: 'templates', to: '/templates', label: 'Templates', icon: 'grid' },
  { id: 'calendar', to: '/calendar', label: 'Calendar', icon: 'calendar' },
];
const PLACES = [
  { id: 'starred', to: '/documents?view=starred', label: 'Starred', icon: 'star' },
  { id: 'shared', to: '/documents?view=shared', label: 'Shared', icon: 'users' },
  { id: 'cloud', to: '/drive', label: 'Cloud', icon: 'folder' },
  { id: 'recent', to: '/documents?view=recent', label: 'Recent', icon: 'clock' },
];

/** Pages without the rail: sign-in screens and published pages meant for visitors. */
export const railHidden = (path: string) => /^\/(signin|signup|forgot|reset)$/.test(path) || /^\/(p|site)\//.test(path);

function activeId(path: string, search: string): string {
  const q = new URLSearchParams(search);
  if (path === '/home') return 'home';
  if (path === '/ai') return q.get('tool') === 'pdf-word' ? 'pdf' : q.get('tool') === 'slides-create' ? 'ai-slides' : 'ai';
  if (path === '/templates') return 'templates';
  if (path === '/calendar') return 'calendar';
  if (path === '/drive') return 'cloud';
  if (path === '/documents') {
    const view = q.get('view');
    if (view === 'starred' || view === 'shared' || view === 'recent') return view;
    const kind = q.get('kind');
    return kind === 'slides' ? 'slides' : kind === 'sheet' ? 'sheets' : kind === 'doc' ? 'docs' : '';
  }
  return '';
}

/** WPS-style left rail of apps and places, on every page, with a Back button. */
export function AppRail() {
  const path = usePath();
  const search = useSearch();
  const active = activeId(path, search);
  const doc = path.startsWith('/d/');
  useEffect(() => {
    document.body.classList.add('with-rail');
    document.body.classList.toggle('rail-doc', doc);
    return () => document.body.classList.remove('with-rail', 'rail-doc');
  }, [doc]);
  const back = () => {
    // A tab opened straight onto this page has nothing to go back to: go home instead.
    if (history.length > 1) history.back();
    else navigate('/home');
  };
  return (
    <nav className="app-rail" aria-label="Apps">
      <button className="rail-item rail-back" onClick={back} title="Go back" type="button">
        <span className="rail-back-arrow">←</span>
        <span>Back</span>
      </button>
      {MAIN.map((a) => (
        <Link key={a.id} to={a.to} className={`rail-item ${active === a.id ? 'on' : ''}`} aria-current={active === a.id ? 'page' : undefined} title={a.label}>
          <Icon name={a.icon} size={19} />
          <span>{a.label}</span>
        </Link>
      ))}
      <hr />
      {PLACES.map((a) => (
        <Link key={a.id} to={a.to} className={`rail-item ${active === a.id ? 'on' : ''}`} title={a.label}>
          <Icon name={a.icon} size={17} />
          <span>{a.label}</span>
        </Link>
      ))}
    </nav>
  );
}
