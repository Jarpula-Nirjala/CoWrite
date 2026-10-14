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
