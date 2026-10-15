import { AUTHOR, REPO_URL } from '../content.ts';
import { Link } from '../router.ts';
import { APPS, SOLUTIONS } from '../lib/apps.ts';
import { Brand } from './Brand.tsx';

type FooterLink = { name: string; to: string; external?: boolean };

const app = (id: string): FooterLink => {
  const a = APPS.find((x) => x.id === id)!;
  return { name: a.name, to: a.to };
};
const solution = (name: string): FooterLink => ({ name, to: `/templates?cat=${encodeURIComponent(SOLUTIONS.find((s) => s.name === name)!.cat)}` });

/** Four columns of five links each, so the footer lines up evenly. */
const COLUMNS: { title: string; links: FooterLink[] }[] = [
  { title: 'Apps', links: ['docs', 'sheets', 'slides', 'forms', 'drive'].map(app) },
  { title: 'Solutions', links: ['Small business', 'Enterprise', 'Education', 'Healthcare', 'Personal & students'].map(solution) },
  {
    title: 'Product',
    links: [
      { name: 'Features', to: '/#features' },
      { name: 'Live demo', to: '/#playground' },
      { name: 'Templates', to: '/templates' },
      { name: 'Security', to: '/account#security' },
      { name: 'Admin & teams', to: '/workspaces' },
    ],
  },
  {
    title: 'Project',
    links: [
      { name: 'How it works', to: '/#how' },
      { name: 'About', to: '/#about' },
      { name: 'Source code', to: REPO_URL, external: true },
      { name: 'LinkedIn', to: AUTHOR.linkedin, external: true },
      { name: 'GitHub', to: AUTHOR.github, external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Brand />
          <p>A real-time collaborative editor built on a conflict-free replicated data type, written from scratch.</p>
          <a className="footer-mail" href={`mailto:${AUTHOR.email}`}>
            {AUTHOR.email}
          </a>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} className="footer-col" aria-label={c.title}>
            <h4>{c.title}</h4>
            {c.links.map((l) =>
              l.external ? (
                <a key={l.name} href={l.to} target="_blank" rel="noreferrer">
                  {l.name}
                </a>
              ) : (
                <Link key={l.name} to={l.to}>
                  {l.name}
                </Link>
              ),
            )}
          </nav>
        ))}
      </div>
      <div className="footer-bottom">
        <span>
          © {new Date().getFullYear()} {AUTHOR.name}. All rights reserved.
        </span>
        <span>Built with React, Node.js and WebSockets.</span>
      </div>
    </footer>
  );
}
