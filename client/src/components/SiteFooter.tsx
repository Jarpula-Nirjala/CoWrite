import { AUTHOR, REPO_URL } from '../content.ts';
import { Link } from '../router.ts';
import { Brand } from './Brand.tsx';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Brand />
          <p>A real-time collaborative editor built on a conflict-free replicated data type, written from scratch.</p>
        </div>
        <div className="footer-col">
          <h4>Product</h4>
          <Link to="/#features">Features</Link>
          <Link to="/#playground">Live demo</Link>
          <Link to="/documents">My documents</Link>
          <Link to="/signup">Create an account</Link>
        </div>
        <div className="footer-col">
          <h4>Project</h4>
          <Link to="/#how">How it works</Link>
          <Link to="/#about">About</Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source code
          </a>
        </div>
        <div className="footer-col">
          <h4>Contact</h4>
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
