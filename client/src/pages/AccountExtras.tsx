import { useEffect, useState } from 'react';
import { api, errorText, type Brand, type User } from '../api.ts';
import { downscale, pickFile } from '../editor/useFiles.ts';
import { SLIDE_THEMES } from '../kinds/slides/themes.ts';
import { APP_THEMES, DEFAULT_PREFS, localPrefs, savePrefs } from '../lib/prefs.ts';

const FONTS: [string, string][] = [
  ['serif', 'Times New Roman'],
  ['georgia', 'Georgia'],
  ['garamond', 'Garamond'],
  ['sans', 'Arial'],
  ['verdana', 'Verdana'],
  ['trebuchet', 'Trebuchet'],
  ['mono', 'Courier New'],
  ['hand', 'Handwriting'],
];

export const DEFAULT_BRAND: Brand = { name: '', logo: null, accent: '#1f3a68', font: 'serif', deckTheme: 'navy' };

/** Reading theme, dyslexia-friendly font and daily writing goal. */
export function AppearanceSection({ signedIn }: { signedIn: boolean }) {
  const [p, setP] = useState(localPrefs);
  const set = (patch: Partial<typeof p>) => {
    const next = { ...DEFAULT_PREFS, ...p, ...patch };
    setP(next);
    void savePrefs(next, signedIn);
  };
  return (
    <div className="panel">
      <h2>Appearance &amp; accessibility</h2>
      <div className="theme-picks">
        {APP_THEMES.map((t) => (
          <button key={t.id} className={`theme-pick ${p.theme === t.id ? 'active' : ''}`} style={{ background: t.bg, color: t.fg, borderBottom: `4px solid ${t.accent}` }} onClick={() => set({ theme: t.id })} aria-pressed={p.theme === t.id} type="button">
            <span>Aa</span>
            {t.name}
          </button>
        ))}
      </div>
      <label className="check-row">
        <input type="checkbox" checked={p.dyslexic} onChange={(e) => set({ dyslexic: e.target.checked })} /> Dyslexia-friendly font (OpenDyslexic) with extra spacing
      </label>
      <label className="field">
        <span>Daily writing goal (words)</span>
        <input className="input" type="number" min={0} max={20000} step={50} value={p.dailyGoal} onChange={(e) => set({ dailyGoal: Number(e.target.value) })} />
      </label>
      <p className="muted small">Your streak and progress towards the goal are on the Activity page.</p>
    </div>
  );
}

/** Logo, colours and fonts you apply to any document or deck in one click. */
export function BrandKitSection({ user, onSaved }: { user: User; onSaved(b: Brand): void }) {
  const [b, setB] = useState<Brand>({ ...DEFAULT_BRAND, ...(user.brand ?? {}) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(b.logo);
  useEffect(() => setLogoUrl(b.logo), [b.logo]);

  const save = async (next: Brand) => {
    try {
      const r = await api<{ brand: Brand }>('/auth/me/brand', { method: 'PUT', body: next });
      setB(r.brand);
      onSaved(r.brand);
      setMsg({ ok: true, text: 'Brand kit saved. Apply it from a document’s Page panel or a deck’s Deck menu.' });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        void save(b);
      }}
    >
      <h2>Brand kit</h2>
      <p className="muted small">Upload your logo and pick colours and a font once. Then apply them to any document (letterhead, accent colour, font) or presentation (logo on every slide, theme) in one click.</p>
      {msg && <div className={msg.ok ? 'alert success' : 'alert'}>{msg.text}</div>}
      <div className="brand-row">
        <div className="brand-logo-box">{logoUrl ? <img src={logoUrl} alt="Your logo" /> : <span className="muted small">No logo</span>}</div>
        <div className="row-actions">
          <button
            className="btn btn-outline btn-sm"
            onClick={async () => {
              const f = await pickFile('image/*');
              if (!f) return;
              const blob = await downscale(f, 600);
              const res = await fetch('/api/files', { method: 'POST', headers: { 'content-type': blob.type || 'image/png', 'x-file-name': encodeURIComponent(f.name) }, body: blob });
              const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
              if (!res.ok || !j.url) return setMsg({ ok: false, text: j.error ?? 'Upload failed.' });
              setB({ ...b, logo: j.url });
            }}
            type="button"
          >
            Upload logo
          </button>
          {b.logo && (
            <button className="btn btn-text btn-sm" onClick={() => setB({ ...b, logo: null })} type="button">
              Remove
            </button>
          )}
        </div>
      </div>
      <label className="field">
        <span>Brand or company name</span>
        <input className="input" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} maxLength={60} placeholder="e.g. Nirjala Studio" />
      </label>
      <div className="brand-grid">
        <label className="field">
          <span>Accent colour</span>
          <input type="color" value={b.accent} onChange={(e) => setB({ ...b, accent: e.target.value })} />
        </label>
        <label className="field">
          <span>Document font</span>
          <select className="input" value={b.font} onChange={(e) => setB({ ...b, font: e.target.value })}>
            {FONTS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Presentation theme</span>
          <select className="input" value={b.deckTheme} onChange={(e) => setB({ ...b, deckTheme: e.target.value })}>
            {SLIDE_THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="brand-preview" style={{ borderTopColor: b.accent }}>
        {logoUrl && <img src={logoUrl} alt="" />}
        <strong style={{ color: b.accent }}>{b.name || 'Your brand'}</strong>
        <span className="muted small">Letterhead preview</span>
      </div>
      <button className="btn btn-primary" type="submit">
        Save brand kit
      </button>
    </form>
  );
}

/** Connect a personal (free) Gemini key, so AI runs on the person's own Google quota. */
export function AiKeySection({ user, onChange }: { user: User; onChange(connected: boolean): void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const connected = !!user.aiConnected;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api('/auth/me/ai-key', { method: 'PUT', body: { key } });
      setKey('');
      onChange(true);
      setMsg({ ok: true, text: 'Connected. Every AI feature now runs on your own free Gemini quota.' });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel ai-key" id="ai">
      <h2>AI assistant (free with Gemini)</h2>
      {msg && <div className={msg.ok ? 'alert success' : 'alert'}>{msg.text}</div>}
      {connected ? (
        <>
          <p className="ai-status-line">
            <span className="ai-badge on">● Connected</span> AI features use <strong>your own Gemini key</strong>, linked to the Google account you used in AI Studio.
          </p>
          <button
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={async () => {
              await api('/auth/me/ai-key', { method: 'DELETE' });
              onChange(false);
              setMsg({ ok: true, text: 'Disconnected. Your key was deleted from CoWrite.' });
            }}
            type="button"
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <p className="muted">Google gives every Google account a free Gemini API key. Connect yours once and every AI feature (writing, slides, translation, meeting notes, ask your documents, read-aloud MP3) runs on your own free quota.</p>
          <ol className="ai-steps">
            <li>
              Open{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
                Google AI Studio → API keys
              </a>{' '}
              and sign in with <strong>{user.email}</strong> (the same email you use for CoWrite) or any Google account.
            </li>
            <li>
              Click <strong>Create API key</strong> and copy it. It starts with <code>AIza</code>.
            </li>
            <li>Paste it below and press Connect. CoWrite checks it with Google, then stores it encrypted.</li>
          </ol>
          <div className="inline-form">
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza…" autoComplete="off" aria-label="Gemini API key" />
            <button className="btn btn-primary btn-sm" disabled={busy || key.trim().length < 20} onClick={() => void save()} type="button">
              {busy ? 'Checking…' : 'Connect'}
            </button>
          </div>
          <p className="muted small">The free tier has daily limits, and Google may use free-tier prompts to improve its products, so avoid pasting secrets into AI requests. You can disconnect at any time.</p>
        </>
      )}
    </section>
  );
}
