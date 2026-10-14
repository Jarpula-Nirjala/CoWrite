import { useEffect, useState } from 'react';
import { api, errorText } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Icon, Spinner } from '../components/ui.tsx';
import { renderMarkdown } from '../lib/text.ts';
import { Link, navigate } from '../router.ts';

interface Answer {
  question: string;
  answer: string;
  sources: { id: string; title: string }[];
}

const EXAMPLES = ['What did we decide in last week’s meeting?', 'Summarise my project proposal in three bullet points', 'Which tasks are still open across my documents?', 'What budget did I plan for groceries?'];

/** Chat with your documents: questions answered from everything you can open. */
export function Ask() {
  const { user, ready, aiReady, aiName } = useAuth();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Answer[]>([]);

  // Questions can arrive from the Home page as /ask?q=…
  useEffect(() => {
    const q0 = new URLSearchParams(window.location.search).get('q');
    if (q0 && user && aiReady) {
      window.history.replaceState(null, '', '/ask');
      void ask(q0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, aiReady]);

  useEffect(() => {
    document.title = 'Ask your documents · CoWrite';
    if (ready && !user) navigate('/signin?next=/ask');
  }, [ready, user]);

  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ answer: string; sources: Answer['sources'] }>('/ai/ask', { method: 'POST', body: { question } });
      setHistory((h) => [{ question, ...r }, ...h]);
      setQ('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !user) return <Spinner />;
  return (
    <div className="page">
      <SiteHeader />
      <main className="container ask-page">
        <p className="kicker">AI</p>
        <h1>Ask your documents</h1>
        <p className="lead muted">
          Ask a question in plain words. {aiName} reads the documents you own or that were shared with you, answers, and links to its sources.</p>
        {!aiReady && (
          <p className="notice">
            AI is not set up yet. <Link to="/account#ai">Connect your free Gemini key</Link> in Account settings; it takes a minute.
          </p>
        )}
        <form
          className="ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
        >
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What are the action items from my meetings this month?" maxLength={1000} aria-label="Your question" autoFocus />
          <button className="btn btn-primary" disabled={busy || !q.trim() || !aiReady} type="submit">
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </form>
        {!history.length && (
          <div className="ask-examples">
            {EXAMPLES.map((x) => (
              <button key={x} className="ask-chip" onClick={() => void ask(x)} disabled={busy || !aiReady} type="button">
                {x}
              </button>
            ))}
          </div>
        )}
        {busy && <Spinner label="Reading your documents…" />}
        {error && <p className="error-text">{error}</p>}
        {history.map((h, i) => (
          <article key={i} className="ask-answer">
            <h2>{h.question}</h2>
            <div className="ask-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(h.answer) }} />
            {h.sources.length > 0 && (
              <p className="small muted">
                Sources:{' '}
                {h.sources.map((s, j) => (
                  <span key={s.id}>
                    {j > 0 && ' · '}
                    <Link to={`/d/${s.id}`}>{s.title}</Link>
                  </span>
                ))}
              </p>
            )}
          </article>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}
