import { useEffect, useState } from 'react';
import type { Token } from '../../../shared/crdt.ts';
import { api, errorText, formatDate, timeAgo } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Avatar, Spinner } from '../components/ui.tsx';
import { renderMarkdown } from '../lib/text.ts';
import { DEFAULT_SETTINGS, paperProps, type DocSettings } from '../rich/settings.ts';
import { StaticDoc } from '../rich/StaticDoc.tsx';
import { Link } from '../router.ts';

interface PublicData {
  title: string;
  text: string;
  tokens: Token[] | null;
  settings: Partial<DocSettings> | null;
  readMinutes: number;
  updatedAt: number;
  author: { name: string; username: string; avatar: string | null };
}
interface PublicComment {
  id: string;
  body: string;
  createdAt: number;
  name: string;
  username: string;
}

const same = (s: string) => Promise.resolve(s);

/** A published document as a blog post: the document's own design, reading time and comments. */
export function PublicDoc({ id }: { id: string }) {
  const { user } = useAuth();
  const [data, setData] = useState<PublicData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<PublicComment[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const loadComments = () => api<{ comments: PublicComment[] }>(`/public/${id}/comments`).then((r) => setComments(r.comments), () => {});
  useEffect(() => {
    api<PublicData>(`/public/${id}`).then(
      (d) => {
        setData(d);
        document.title = `${d.title} · CoWrite`;
      },
      (e) => setError(errorText(e)),
    );
    void loadComments();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reading progress bar.
  useEffect(() => {
    const on = () => {
      const h = document.documentElement;
      setProgress(Math.min(1, h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)));
    };
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  const settings: DocSettings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}), page: 'full', pageGuides: false };
  const paper = paperProps(settings);

  return (
    <div className="page public-page">
      <div className="read-progress" style={{ transform: `scaleX(${progress})` }} />
      <SiteHeader />
      <main className="container public-doc">
        {error && (
          <div className="not-found">
            <h1>Not available</h1>
            <p className="muted">{error}</p>
          </div>
        )}
        {!data && !error && <Spinner />}
        {data && (
          <>
            <article>
              <h1 className="post-title">{data.title}</h1>
              <header className="byline">
                <Link to={`/u/${data.author.username}`} className="byline-author">
                  <Avatar name={data.author.name} src={data.author.avatar} size={40} />
                  <span>
                    <strong>{data.author.name}</strong>
                    <span className="muted small">
                      {formatDate(data.updatedAt)} · {data.readMinutes} min read
                    </span>
                  </span>
                </Link>
              </header>
              {data.tokens ? (
                <div className={`${paper.className} post-paper`} style={paper.style} data-font={settings.font}>
                  {(settings.logo || settings.brandName) && (
                    <header className="paper-header">
                      {settings.logo && <img className="paper-logo" src={settings.logo} alt="" />}
                      <span className="paper-brand">{settings.brandName}</span>
                    </header>
                  )}
                  <StaticDoc tokens={data.tokens} resolve={same} />
                </div>
              ) : (
                <div className="markdown-preview published" dangerouslySetInnerHTML={{ __html: renderMarkdown(data.text) }} />
              )}
              <p className="muted small made-with">
                Written collaboratively with <Link to="/">CoWrite</Link>.
              </p>
            </article>

            <section className="public-comments" aria-label="Comments">
              <h2>
                {comments.length} comment{comments.length === 1 ? '' : 's'}
              </h2>
              {user ? (
                <form
                  className="public-comment-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!body.trim()) return;
                    setBusy(true);
                    try {
                      await api(`/public/${id}/comments`, { method: 'POST', body: { body } });
                      setBody('');
                      await loadComments();
                    } catch (err) {
                      setError(errorText(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Avatar name={user.name} src={user.avatar} size={36} />
                  <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Share your thoughts…" maxLength={2000} />
                  <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()} type="submit">
                    Comment
                  </button>
                </form>
              ) : (
                <p className="muted">
                  <Link to={`/signin?next=${encodeURIComponent(`/p/${id}`)}`}>Sign in</Link> to join the conversation.
                </p>
              )}
              <ul className="public-comment-list">
                {comments.map((c) => (
                  <li key={c.id}>
                    <Avatar name={c.name} size={32} />
                    <div>
                      <Link to={`/u/${c.username}`}>
                        <strong>{c.name}</strong>
                      </Link>{' '}
                      <span className="muted small">{timeAgo(c.createdAt)}</span>
                      <p>{c.body}</p>
                      {user && (user.username === c.username || user.username === data.author.username) && (
                        <button className="btn btn-text btn-sm" onClick={() => void api(`/public/${id}/comments/${c.id}`, { method: 'DELETE' }).then(loadComments)} type="button">
                          Delete
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
