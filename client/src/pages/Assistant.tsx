import { useEffect, useRef, useState } from 'react';
import type { Token } from '../../../shared/crdt.ts';
import { markdownToTokens } from '../../../shared/rich.ts';
import { useAuth } from '../auth.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Icon } from '../components/ui.tsx';
import { createAndOpen } from '../lib/create.ts';
import { StaticDoc } from '../rich/StaticDoc.tsx';
import { Link, navigate } from '../router.ts';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}
interface Chat {
  id: string;
  title: string;
  at: number;
  messages: Msg[];
}

const STORE = 'cowrite:assistant';
const same = (s: string) => Promise.resolve(s);
const toTokens = (md: string): Token[] => markdownToTokens(md).map((t, i) => ({ id: ['as', i + 1], ch: t.ch, attrs: (t.a ?? {}) as Token['attrs'] }));
const SUGGESTIONS = [
  ['✉️', 'Write an email', 'Write a polite email to my manager asking for two days of leave next week.'],
  ['🧠', 'Explain a concept', 'Explain how a CRDT works to a first-year student, with an example.'],
  ['🗺️', 'Plan a trip', 'Plan a 3-day budget trip to Goa for four friends in December.'],
  ['💡', 'Brainstorm ideas', 'Give me 10 ideas for a final-year computer science project.'],
] as const;

function loadChats(): Chat[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '[]') as Chat[];
  } catch {
    return [];
  }
}
function saveChats(chats: Chat[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(chats.slice(0, 30)));
  } catch {
    // Storage full or blocked: chats simply are not remembered.
  }
}

/** A Gemini-style chat assistant, using the person's own AI key or the site's. */
export function Assistant() {
  const { user, ready, aiReady, aiName } = useAuth();
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [cur, setCur] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const chat = chats.find((c) => c.id === cur) ?? null;

  useEffect(() => {
    document.title = `${aiName === 'AI' ? 'Assistant' : aiName} · CoWrite`;
  }, [aiName]);
  useEffect(() => {
    if (ready && !user) navigate('/signin?next=/assistant', { replace: true });
  }, [ready, user]);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [chat?.messages.length, chat?.messages.at(-1)?.text.length]);

  const update = (id: string, f: (c: Chat) => Chat) =>
    setChats((all) => {
      const next = all.map((c) => (c.id === id ? f(c) : c));
      saveChats(next);
      return next;
    });

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    setError(null);
    let id = cur;
    let history: Msg[] = chat?.messages ?? [];
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      const fresh: Chat = { id, title: q.slice(0, 60), at: Date.now(), messages: [] };
      setChats((all) => [fresh, ...all]);
      setCur(id);
      history = [];
    }
    const messages: Msg[] = [...history, { role: 'user', text: q }];
    update(id, (c) => ({ ...c, at: Date.now(), messages: [...messages, { role: 'assistant', text: '' }] }));
    setBusy(true);
    try {
      const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages }), credentials: 'same-origin' });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed (${res.status}).`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let answer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += dec.decode(value, { stream: true });
        const a = answer;
        update(id, (c) => ({ ...c, messages: [...messages, { role: 'assistant', text: a }] }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      update(id, (c) => ({ ...c, messages }));
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) => {
    const next = chats.filter((c) => c.id !== id);
    setChats(next);
    saveChats(next);
    if (cur === id) setCur(null);
  };

  return (
    <div className="page assistant-page">
      <SiteHeader />
      <div className="assistant">
        <aside className="as-side">
          <button className="btn btn-outline as-new" onClick={() => setCur(null)} type="button">
            <Icon name="plus" size={16} /> New chat
          </button>
          <p className="side-h">Recent</p>
          <ul>
            {chats.map((c) => (
              <li key={c.id} className={c.id === cur ? 'on' : ''}>
                <button onClick={() => setCur(c.id)} type="button">
                  <Icon name="chat" size={14} /> {c.title}
                </button>
                <button className="as-del" onClick={() => remove(c.id)} aria-label="Delete chat" type="button">
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">Chats are kept in this browser only.</p>
        </aside>
        <main className="as-main">
          <div className="as-scroll">
            {!chat ? (
              <div className="as-welcome">
                <h1>
                  <span className="as-grad">Hello, {user?.name.split(' ')[0] ?? 'there'}</span>
                  <br />
                  How can I help you today?
                </h1>
                <div className="as-cards">
                  {SUGGESTIONS.map(([icon, label, q]) => (
                    <button key={label} onClick={() => void send(q)} disabled={!aiReady} type="button">
                      <span>{q}</span>
                      <b>
                        {icon} {label}
                      </b>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="as-thread">
                {chat.messages.map((m, i) => (
                  <div key={i} className={`as-msg ${m.role}`}>
                    {m.role === 'assistant' && <span className="as-avatar">✦</span>}
                    <div className="as-bubble">
                      {m.role === 'user' ? m.text : m.text ? <StaticDoc tokens={toTokens(m.text)} resolve={same} /> : <span className="as-typing"><i /><i /><i /></span>}
                      {m.role === 'assistant' && m.text && !(busy && i === chat.messages.length - 1) && (
                        <span className="as-actions">
                          <button onClick={() => void navigator.clipboard.writeText(m.text)} type="button">
                            Copy
                          </button>
                          <button onClick={() => void createAndOpen(chat.messages[i - 1]?.text.slice(0, 60) || 'From the assistant', 'doc', { tokens: markdownToTokens(m.text), settings: { theme: 'simple', font: 'sans' } })} type="button">
                            Save as document
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={end} />
              </div>
            )}
          </div>
          {error && <p className="error-text as-error">{error}</p>}
          <form
            className="as-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder={aiReady ? `Message ${aiName}…` : 'Connect a free AI key to start chatting'}
              disabled={!aiReady}
              aria-label="Message"
            />
            <button className="as-send" disabled={busy || !input.trim() || !aiReady} aria-label="Send" type="submit">
              ➤
            </button>
          </form>
          <p className="muted small as-foot">
            {aiReady ? (
              <>
                {aiName} can make mistakes, so check important facts. Searching your own documents? Use <Link to="/ask">Ask your documents</Link>.
              </>
            ) : (
              <Link to="/account#ai">Connect a free Gemini, Groq or OpenRouter key →</Link>
            )}
          </p>
        </main>
      </div>
    </div>
  );
}
