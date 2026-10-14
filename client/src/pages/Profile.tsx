import { useEffect, useState } from 'react';
import { api, errorText, formatDate } from '../api.ts';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Avatar, Spinner } from '../components/ui.tsx';
import { renderMarkdown } from '../lib/text.ts';
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

export function PublicDoc({ id }: { id: string }) {
  const [data, setData] = useState<{ title: string; text: string; updatedAt: number; author: { name: string; username: string; avatar: string | null } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<NonNullable<typeof data>>(`/public/${id}`).then(
      (d) => {
        setData(d);
        document.title = `${d.title} · CoWrite`;
      },
      (e) => setError(errorText(e)),
    );
  }, [id]);
  return (
    <div className="page">
      <SiteHeader />
      <main className="container narrow public-doc">
        {error && (
          <div className="not-found">
            <h1>Not available</h1>
            <p className="muted">{error}</p>
          </div>
        )}
        {!data && !error && <Spinner />}
        {data && (
          <article>
            <header className="byline">
              <Link to={`/u/${data.author.username}`} className="byline-author">
                <Avatar name={data.author.name} src={data.author.avatar} size={40} />
                <span>
                  <strong>{data.author.name}</strong>
                  <span className="muted small">Updated {formatDate(data.updatedAt)}</span>
                </span>
              </Link>
            </header>
            <div className="markdown-preview published" dangerouslySetInnerHTML={{ __html: renderMarkdown(data.text) }} />
            <p className="muted small made-with">
              Written collaboratively with <Link to="/">CoWrite</Link>.
            </p>
          </article>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
