import { Link } from '../router.ts';
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
];
const PLACES = [
  { id: 'starred', to: '/documents?view=starred', label: 'Starred', icon: 'star' },
  { id: 'shared', to: '/documents?view=shared', label: 'Shared', icon: 'users' },
  { id: 'cloud', to: '/drive', label: 'Cloud', icon: 'folder' },
  { id: 'recent', to: '/documents?view=recent', label: 'Recent', icon: 'clock' },
];

/** WPS-style left rail of apps and places. */
export function AppRail({ active }: { active: string }) {
  return (
    <nav className="app-rail" aria-label="Apps">
      {MAIN.map((a) => (
        <Link key={a.id} to={a.to} className={`rail-item ${active === a.id ? 'on' : ''}`} aria-current={active === a.id ? 'page' : undefined}>
          <Icon name={a.icon} size={20} />
          <span>{a.label}</span>
        </Link>
      ))}
      <hr />
      {PLACES.map((a) => (
        <Link key={a.id} to={a.to} className={`rail-item ${active === a.id ? 'on' : ''}`}>
          <Icon name={a.icon} size={18} />
          <span>{a.label}</span>
        </Link>
      ))}
    </nav>
  );
}
