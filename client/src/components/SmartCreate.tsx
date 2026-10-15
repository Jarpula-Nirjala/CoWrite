import { useRef, useState } from 'react';
import { markdownToTokens } from '../../../shared/rich.ts';
import { api, errorText } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { fileToText } from '../lib/aiFiles.ts';
import { createAndOpen } from '../lib/create.ts';
import { aiDeck, type AiOutline } from '../lib/proTemplates.ts';
import { designedDeck, type DesignedDeck } from '../lib/designedDeck.ts';
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
  // 0 = Auto: follow the slide list in the description.
  const [count, setCount] = useState(0);
  const [backdrop, setBackdrop] = useState<{ url: string; preview: string; tone: 'dark' | 'light' } | null>(null);
  const bgRef = useRef<HTMLInputElement>(null);
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

  /** A background picture for every slide: uploaded once, and its brightness decides the text colour. */
  const pickBackdrop = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return setError('Choose an image (PNG or JPG) for the slide background.');
    setError(null);
    setBusy('Uploading your background…');
    try {
      const preview = URL.createObjectURL(f);
      const tone = await brightness(preview);
      const res = await fetch('/api/files', { method: 'POST', headers: { 'content-type': f.type, 'x-file-name': encodeURIComponent(f.name) }, body: f, credentials: 'same-origin' });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !j.url) throw new Error(j.error ?? 'Upload failed.');
      setBackdrop({ url: j.url, preview, tone });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(null);
    }
  };

  const go = async () => {
    setError(null);
    setBusy(kind === 'slides' ? 'Designing your slides…' : 'Writing your document…');
    try {
      const r = await api<{ kind: 'doc'; title: string; theme: string; markdown: string } | { kind: 'slides'; designed?: boolean; deck: AiOutline & DesignedDeck }>('/ai/create', {
        method: 'POST',
        body: { kind, style, prompt, slides: count, source: source?.text ?? '', backdrop: backdrop?.tone ?? null },
      });
      if (r.kind === 'slides')
        await createAndOpen(r.deck.title, 'slides', r.designed ? designedDeck(r.deck, { backgroundImage: backdrop?.url, backdrop: backdrop?.tone }) : aiDeck(r.deck, { cover: count !== 1 }));
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
          placeholder={kind === 'slides' ? 'Describe your presentation, or paste a full brief: slide list, colours (hex), fonts, layouts and diagrams. It is followed exactly.' : 'Describe your document: what it is for, who will read it and what it must cover…'}
          rows={compact ? 2 : 3}
          maxLength={30_000}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !busy) void go();
          }}
          aria-label="What should the AI create?"
        />
        {backdrop && kind === 'slides' && (
          <span className="sc-file">
            <img className="sc-bg-thumb" src={backdrop.preview} alt="" /> Background for every slide · {backdrop.tone === 'dark' ? 'light' : 'dark'} text
            <button onClick={() => setBackdrop(null)} type="button" aria-label="Remove background">
              ×
            </button>
          </span>
        )}
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
          {kind === 'slides' && (
            <>
              <button className="sc-tool" onClick={() => bgRef.current?.click()} disabled={!!busy} title="Use your own background or template picture on every slide" type="button">
                <Icon name="crop" size={16} /> Background image
              </button>
              <input ref={bgRef} type="file" hidden accept="image/*" onChange={(e) => (void pickBackdrop(e.target.files?.[0]), (e.target.value = ''))} />
            </>
          )}
          <div className="sc-styles" role="radiogroup" aria-label="Style">
            {STYLES.map((s) => (
              <button key={s.id} role="radio" aria-checked={style === s.id} className={style === s.id ? 'on' : ''} title={s.hint} onClick={() => setStyle(s.id)} type="button">
                {s.name}
              </button>
            ))}
          </div>
          {kind === 'slides' && (
            <span className="sc-count" role="group" aria-label="Number of slides">
              <button onClick={() => setCount(Math.max(0, count - 1))} disabled={count <= 0} aria-label="Fewer slides" type="button">
                −
              </button>
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of slides">
                <option value={0}>Auto slides</option>
                {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} slide{n === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
              <button onClick={() => setCount(Math.min(30, count + 1))} disabled={count >= 30} aria-label="More slides" type="button">
                +
              </button>
            </span>
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

/** Whether a picture is mostly dark or light (sampled on a small canvas). */
async function brightness(src: string): Promise<'dark' | 'light'> {
  const im = new Image();
  im.src = src;
  await im.decode();
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 18;
  const g = c.getContext('2d')!;
  g.drawImage(im, 0, 0, 32, 18);
  const d = g.getImageData(0, 0, 32, 18).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / (d.length / 4) < 140 ? 'dark' : 'light';
}
