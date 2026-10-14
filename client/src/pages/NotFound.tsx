import { useEffect } from 'react';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Link } from '../router.ts';

export function NotFound() {
  useEffect(() => {
    document.title = 'Page not found · CoWrite';
  }, []);
  return (
    <div className="page">
      <SiteHeader />
      <main className="container narrow not-found">
        <p className="kicker">Error 404</p>
        <h1>Page not found</h1>
        <p className="muted">The page you are looking for does not exist or has been moved.</p>
        <Link className="btn btn-primary" to="/">
          Return home
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
