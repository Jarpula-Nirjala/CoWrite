import { useEffect, useState } from 'react';
import { api, errorText, timeAgo, type DocMeta } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Icon, Spinner } from '../components/ui.tsx';
import { createAndOpen } from '../lib/create.ts';
import { GALLERY } from '../lib/gallery.ts';
import { markdownToTokens } from '../../../shared/rich.ts';
import { Link, navigate, useSearch } from '../router.ts';
import { Glyph } from '../components/Glyph.tsx';
import { ProductIcon } from '../components/ProductIcon.tsx';

/** Meet and Chat: rooms are documents with a built-in call and chat, so notes and the meeting live together. */
export function Meet() {
  const { user, ready } = useAuth();
  const chat = new URLSearchParams(useSearch()).get('chat') === '1';
  const [code, setCode] = useState('');
  const [recent, setRecent] = useState<DocMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${chat ? 'Chat' : 'Meet'} · CoWrite`;
    if (!ready) return;
    if (!user) return navigate(`/signin?next=${chat ? '/meet?chat=1' : '/meet'}`, { replace: true });
    api<{ documents: DocMeta[] }>('/docs?view=recent').then((r) => setRecent(r.documents.filter((d) => /^(Meeting|Chat room)/.test(d.title)).slice(0, 8)), () => setRecent([]));
  }, [ready, user, chat]);

  const start = async (kind: 'meet' | 'chat') => {
    setBusy(true);
    setError(null);
    const when = new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    try {
      if (kind === 'meet') {
        const tpl = GALLERY.find((g) => g.id === 'meeting');
        await createAndOpen(`Meeting – ${when}`, 'doc', tpl ? tpl.build() : { tokens: markdownToTokens('# Meeting notes') }, '?meet=1');
      } else {
        await createAndOpen(`Chat room – ${when}`, 'doc', { tokens: markdownToTokens('# Chat room\nShare this page’s link to invite people. Messages are in the Chat panel on the right; shared notes go here.') }, '?panel=chat');
      }
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const join = () => {
    const m = /(?:\/d\/)?([A-Za-z0-9_-]{6,64})(?:[?#].*)?$/.exec(code.trim());
    if (!m) return setError('Paste a meeting link or code.');
    navigate(`/d/${m[1]}?meet=1`);
  };

  if (!ready || !user) return <Spinner />;
  return (
    <div className="page">
      <SiteHeader />
      <main className="meet container">
        <section className="meet-hero">
          <div>
            <h1>{chat ? 'Chat with your team, next to your work' : 'Video calls and meetings for everyone'}</h1>
            <p className="muted">
              {chat
                ? 'Open a chat room: a shared page with live chat, mentions and notes everyone can edit.'
                : 'Start a meeting with video, voice and shared notes that everyone writes together. Peer-to-peer, no downloads.'}
            </p>
            <div className="meet-actions">
              <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => void start(chat ? 'chat' : 'meet')} type="button">
                <Icon name={chat ? 'chat' : 'video'} size={18} /> {chat ? 'New chat room' : 'New meeting'}
              </button>
              <form
                className="meet-join"
                onSubmit={(e) => {
                  e.preventDefault();
                  join();
                }}
              >
                <Icon name="keyboard" size={18} />
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter a code or link" aria-label="Meeting code or link" />
                <button className="btn btn-text" disabled={!code.trim()} type="submit">
                  Join
                </button>
              </form>
            </div>
            {error && <p className="error-text">{error}</p>}
            <p className="muted small">
              {chat ? <Link to="/meet">Need a video call instead? →</Link> : <Link to="/meet?chat=1">Just want to chat? Open a chat room →</Link>}
            </p>
          </div>
          <div className="meet-art" aria-hidden>
            <img src="/features/calls.jpg" alt="" />
            <span className="meet-badge">
              <Glyph e="🔒" size={14} /> Peer-to-peer · <Glyph e="🎥" size={14} /> Video · <Glyph e="🎙️" size={14} /> Voice · <Glyph e="💬" size={14} /> Chat · <Glyph e="📝" size={14} /> Shared notes
            </span>
          </div>
        </section>
        <section>
          <h2>Recent rooms</h2>
          {!recent ? (
            <Spinner />
          ) : !recent.length ? (
            <p className="muted">Meetings and chat rooms you open appear here.</p>
          ) : (
            <ul className="meet-recent">
              {recent.map((d) => (
                <li key={d.id}>
                  <Link to={`/d/${d.id}${d.title.startsWith('Meeting') ? '?meet=1' : '?panel=chat'}`}>
                    <span>
                      <ProductIcon id={d.title.startsWith('Meeting') ? 'meet' : 'chat'} size={30} />
                    </span>
                    <b>{d.title}</b>
                    <small className="muted">{timeAgo(d.updatedAt)}</small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
