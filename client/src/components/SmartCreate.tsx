import { useRef, useState } from 'react';
import { markdownToTokens } from '../../../shared/rich.ts';
import { api, errorText } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { fileToText } from '../lib/aiFiles.ts';
import { createAndOpen } from '../lib/create.ts';
import { aiDeck, type AiOutline } from '../lib/proTemplates.ts';
import type { DocSettings } from '../rich/settings.ts';
import { Link } from '../router.ts';
import { Icon } from './ui.tsx';

const STYLES = [
  { id: 'pro', name: 'Pro', hint: 'Corporate, clean, data-led' },
  { id: 'creative', name: 'Creative', hint: 'Bold colour and gradients' },
  { id: 'classic', name: 'Classic', hint: 'Formal serif and quiet colour' },
] as const;

const IDEAS: Record<'doc' | 'slides', string[]> = {
  slides: ['Quarterly sales review for a retail chain', 'Lesson on photosynthesis for class 8', 'Investor pitch for a healthy café', 'Onboarding for new employees', 'Benefits of solar energy for homes'],
  doc: ['Business plan for a small bakery', 'Project proposal for a college library app', 'Two-week study timetable for exams', 'Monthly marketing report template', 'Leave policy for a 50-person company'],
};

/** WPS-style “Smart Create”: describe a document or deck and the AI writes and designs it. */
export function SmartCreate({ initialKind = 'slides', compact = false }: { initialKind?: 'doc' | 'slides'; compact?: boolean }) {
  const { user, aiReady, aiName } = useAuth();
  const [kind, setKind] = useState<'doc' | 'slides'>(initialKind);
  const [style, setStyle] = useState<'pro' | 'creative' | 'classic'>('pro');
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(9);
  const [source, setSource] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setBusy('Reading your document…');
    try {
      const text = (await fileToText(f)).trim();
      if (text.length < 20) throw new Error('We could not find any text in that file.');
      setSource({ name: f.name, text: text.slice(0, 60_000) });
    } catch (e) {
      setError(e instanceof Error ? e.message : errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const go = async () => {
    setError(null);
    setBusy(kind === 'slides' ? 'Designing your slides…' : 'Writing your document…');
    try {
      const r = await api<{ kind: 'doc'; title: string; theme: string; markdown: string } | { kind: 'slides'; deck: AiOutline }>('/ai/create', {
        method: 'POST',
        body: { kind, style, prompt, slides: count, source: source?.text ?? '' },
      });
      if (r.kind === 'slides') await createAndOpen(r.deck.title, 'slides', aiDeck(r.deck));
      else {
        const settings: Partial<DocSettings> = { theme: r.theme as DocSettings['theme'], font: r.theme === 'luxe' || r.theme === 'paperback' ? 'georgia' : r.theme === 'executive' || r.theme === 'simple' || r.theme === 'modern' || r.theme === 'report' ? 'sans' : 'serif', pageNumbers: true };
        await createAndOpen(r.title, 'doc', { tokens: markdownToTokens(r.markdown), settings });
      }
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  };

  return (
    <section className={`smart-create ${compact ? 'compact' : ''}`} aria-label="Smart Create">
      <div className="sc-head">
        <span className="sc-badge">
          <Icon name="sparkle" size={16} /> Smart Create
        </span>
        <div className="sc-kinds" role="tablist">
          <button role="tab" aria-selected={kind === 'slides'} className={kind === 'slides' ? 'on' : ''} onClick={() => setKind('slides')} type="button">
            📊 Slides
          </button>
          <button role="tab" aria-selected={kind === 'doc'} className={kind === 'doc' ? 'on' : ''} onClick={() => setKind('doc')} type="button">
            📄 Docs
          </button>
        </div>
      </div>
      <h2 className="sc-title">{kind === 'slides' ? 'Create slides with AI' : 'Create a document with AI'}</h2>
      <div className="sc-box">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={kind === 'slides' ? 'Describe your presentation: topic, audience and anything it must include…' : 'Describe your document: what it is for, who will read it and what it must cover…'}
          rows={compact ? 2 : 3}
          maxLength={4000}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !busy) void go();
          }}
          aria-label="What should the AI create?"
        />
        {source && (
          <span className="sc-file">
            📎 {source.name} <small>({Math.round(source.text.length / 1000)}k characters)</small>
            <button onClick={() => setSource(null)} type="button" aria-label="Remove file">
              ×
            </button>
          </span>
        )}
        <div className="sc-bar">
          <button className="sc-tool" onClick={() => fileRef.current?.click()} disabled={!!busy} type="button">
            <Icon name="upload" size={16} /> Upload document
          </button>
          <input ref={fileRef} type="file" hidden accept=".txt,.md,.docx,.pdf,.html,.htm,image/*" onChange={(e) => (void upload(e.target.files?.[0]), (e.target.value = ''))} />
          <div className="sc-styles" role="radiogroup" aria-label="Style">
            {STYLES.map((s) => (
              <button key={s.id} role="radio" aria-checked={style === s.id} className={style === s.id ? 'on' : ''} title={s.hint} onClick={() => setStyle(s.id)} type="button">
                {s.name}
              </button>
            ))}
          </div>
          {kind === 'slides' && (
            <label className="sc-count">
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of slides">
                {[6, 8, 9, 10, 12, 15].map((n) => (
                  <option key={n} value={n}>
                    {n} slides
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="btn btn-primary sc-go" disabled={!!busy || !user || (prompt.trim().length < 4 && !source)} onClick={() => void go()} type="button">
            {busy ? <span className="sc-spin" /> : <Icon name="sparkle" size={16} />} {busy ?? 'Generate'}
          </button>
        </div>
      </div>
      {!compact && (
        <div className="sc-ideas">
          {IDEAS[kind].map((i) => (
            <button key={i} onClick={() => setPrompt(i)} type="button">
              {i}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      {!user ? (
        <p className="muted small">
          <Link to="/signin?next=/templates">Sign in</Link> to create with AI.
        </p>
      ) : (
        !aiReady && (
          <p className="muted small">
            AI needs a free key: <Link to="/account#ai">connect Gemini in a minute →</Link>
          </p>
        )
      )}
      {user && aiReady && <p className="muted small sc-powered">Powered by {aiName}. You can edit everything afterwards.</p>}
    </section>
  );
}
