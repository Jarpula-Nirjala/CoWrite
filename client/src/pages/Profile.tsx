import { useEffect, useState } from 'react';
import { api, errorText, formatDate } from '../api.ts';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Avatar, Spinner } from '../components/ui.tsx';
import { Link } from '../router.ts';

interface ProfileData {
  profile: { name: string; username: string; bio: string; avatar: string | null; createdAt: number };
  stats: { documents: number; written: number };
  published: { id: string; title: string; updatedAt: number; excerpt: string }[];
}

export function Profile({ username }: { username: string }) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ProfileData>(`/users/${encodeURIComponent(username)}`).then(
      (d) => {
        setData(d);
        document.title = `${d.profile.name} · CoWrite`;
      },
      (e) => setError(errorText(e)),
    );
  }, [username]);

  return (
    <div className="page">
      <SiteHeader />
      <main className="container profile-page">
        {error && (
          <div className="not-found">
            <h1>Profile not found</h1>
            <p className="muted">{error}</p>
          </div>
        )}
        {!data && !error && <Spinner />}
        {data && (
          <>
            <header className="profile-head">
              <Avatar name={data.profile.name} src={data.profile.avatar} size={112} />
              <div>
                <h1>{data.profile.name}</h1>
                <p className="muted">@{data.profile.username} · Writing on CoWrite since {formatDate(data.profile.createdAt)}</p>
                {data.profile.bio && <p className="profile-bio">{data.profile.bio}</p>}
                <p className="small">
                  <strong>{data.stats.documents}</strong> documents · <strong>{data.stats.written.toLocaleString()}</strong> characters written ·{' '}
                  <strong>{data.published.length}</strong> published
                </p>
              </div>
            </header>
            <h2 className="section-title">Published writing</h2>
            {!data.published.length && <p className="muted">Nothing published yet.</p>}
            <div className="project-grid">
              {data.published.map((p) => (
                <Link key={p.id} className="project" to={`/p/${p.id}`}>
                  <h4>{p.title}</h4>
                  <p>{p.excerpt.replace(/[#*_>`-]/g, '').slice(0, 180)}…</p>
                  <span className="project-tags">Updated {formatDate(p.updatedAt)}</span>
                </Link>
              ))}
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
