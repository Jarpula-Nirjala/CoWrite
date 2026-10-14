import { AUTHOR, REPO_URL } from '../content.ts';
import { Link } from '../router.ts';
import { APPS, MANAGEMENT, SOLUTIONS } from '../lib/apps.ts';
import { Brand } from './Brand.tsx';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Brand />
          <p>A real-time collaborative editor built on a conflict-free replicated data type, written from scratch.</p>
        </div>
        <div className="footer-col footer-apps">
          <h4>Included applications</h4>
          <div className="footer-apps-grid">
            {APPS.map((a) => (
              <Link key={a.id} to={a.to}>
                {a.name}
              </Link>
            ))}
          </div>
        </div>
        <div className="footer-col footer-apps">
          <h4>Solutions</h4>
          <div className="footer-apps-grid">
            {SOLUTIONS.map((x) => (
              <Link key={x.name} to={`/templates?cat=${encodeURIComponent(x.cat)}`}>
                {x.name}
              </Link>
            ))}
          </div>
        </div>
        <div className="footer-col">
          <h4>Security and management</h4>
          {MANAGEMENT.map((m) => (
            <Link key={m.name} to={m.to}>
              {m.name}
            </Link>
          ))}
          <h4 className="footer-sub">Product</h4>
          <Link to="/#features">Features</Link>
          <Link to="/#playground">Live demo</Link>
          <Link to="/templates">Templates</Link>
          <Link to="/signup">Create an account</Link>
        </div>
        <div className="footer-col">
          <h4>Project</h4>
          <Link to="/#how">How it works</Link>
          <Link to="/#about">About</Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source code
          </a>
          <h4 className="footer-sub">Contact</h4>
          <a href={`mailto:${AUTHOR.email}`}>{AUTHOR.email}</a>
          <a href={AUTHOR.linkedin} target="_blank" rel="noreferrer">
            LinkedIn
          </a>
          <a href={AUTHOR.github} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
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
