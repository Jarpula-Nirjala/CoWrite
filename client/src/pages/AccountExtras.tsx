import { AI_PROVIDER_NAMES } from '../auth.tsx';
import { useEffect, useState } from 'react';
import { api, errorText, type Brand, type Prefs, type User } from '../api.ts';
import { downscale, pickFile } from '../editor/useFiles.ts';
import { SLIDE_THEMES } from '../kinds/slides/themes.ts';
import { APP_THEMES, DEFAULT_PREFS, localPrefs, savePrefs } from '../lib/prefs.ts';
import { ThemeIcon } from '../components/ThemeIcon.tsx';

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
  const seg = <K extends 'textSize' | 'spacing' | 'appFont'>(key: K, options: [NonNullable<Prefs[K]>, string][]) => (
    <span className="seg">
      {options.map(([v, label]) => (
        <button key={v} className={(p[key] ?? DEFAULT_PREFS[key]) === v ? 'on' : ''} onClick={() => set({ [key]: v } as Partial<Prefs>)} type="button">
          {label}
        </button>
      ))}
    </span>
  );
  const toggles: [keyof Prefs, string, string][] = [
    ['dyslexic', 'Dyslexia-friendly font', 'OpenDyslexic with extra spacing, everywhere in CoWrite'],
    ['reduceMotion', 'Reduce motion', 'Turns off animations, sliding carousels and smooth scrolling'],
    ['underlineLinks', 'Underline links', 'Makes every link easy to spot without relying on colour'],
    ['strongFocus', 'Strong focus outline', 'A thick, high-visibility outline for keyboard navigation'],
    ['bigCursor', 'Large mouse pointer', 'A bigger, high-contrast cursor that is easier to follow'],
    ['grayscale', 'Grayscale', 'Removes colour, which some people find calmer or easier to read'],
  ];
  const card = (t: (typeof APP_THEMES)[number]) => (
    <button key={t.id} className={`theme-pick ${p.theme === t.id ? 'active' : ''}`} style={{ background: t.bg, color: t.fg, borderBottom: `4px solid ${t.accent}` }} onClick={() => set({ theme: t.id })} aria-pressed={p.theme === t.id} type="button">
      <span className="theme-pick-icon" style={{ color: t.accent }}>
        <ThemeIcon name={t.icon} size={24} />
      </span>
      {t.name}
    </button>
  );
  return (
    <div className="panel appearance" id="appearance">
      <h2>Appearance &amp; accessibility</h2>
      <h3 className="appearance-h">Light themes</h3>
      <div className="theme-picks">{APP_THEMES.filter((t) => !t.dark).map(card)}</div>
      <h3 className="appearance-h">Dark themes</h3>
      <div className="theme-picks">{APP_THEMES.filter((t) => t.dark).map(card)}</div>

      <h3 className="appearance-h">Reading</h3>
      <div className="a11y-rows">
        <div className="a11y-row">
          <span>
            <b>Text size</b>
            <small>Scales the whole interface</small>
          </span>
          {seg('textSize', [
            ['sm', 'A−'],
            ['md', 'A'],
            ['lg', 'A+'],
            ['xl', 'A++'],
          ])}
        </div>
        <div className="a11y-row">
          <span>
            <b>Line spacing</b>
            <small>More room between lines and letters</small>
          </span>
          {seg('spacing', [
            ['normal', 'Normal'],
            ['relaxed', 'Relaxed'],
          ])}
        </div>
        <div className="a11y-row">
          <span>
            <b>Interface font</b>
            <small>Documents keep their own fonts</small>
          </span>
          {seg('appFont', [
            ['default', 'Classic'],
            ['sans', 'Modern'],
            ['readable', 'Readable'],
            ['mono', 'Mono'],
          ])}
        </div>
      </div>

      <h3 className="appearance-h">Comfort &amp; accessibility</h3>
      <div className="a11y-toggles">
        {toggles.map(([key, label, hint]) => (
          <label key={key} className="a11y-toggle">
            <input type="checkbox" role="switch" checked={!!p[key]} onChange={(e) => set({ [key]: e.target.checked } as Partial<Prefs>)} />
            <span className="switch" aria-hidden />
            <span>
              <b>{label}</b>
              <small>{hint}</small>
            </span>
          </label>
        ))}
      </div>

      <label className="field">
        <span>Daily writing goal (words)</span>
        <input className="input" type="number" min={0} max={20000} step={50} value={p.dailyGoal} onChange={(e) => set({ dailyGoal: Number(e.target.value) })} />
      </label>
      <p className="muted small">Your streak and progress towards the goal are on the Activity page. These settings follow your account to every device.</p>
      <button className="btn btn-outline btn-sm" onClick={() => set({ ...DEFAULT_PREFS, dailyGoal: p.dailyGoal })} type="button">
        Reset appearance
      </button>
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

const KEY_GUIDES = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    tag: 'Recommended · free',
    url: 'https://aistudio.google.com/app/apikey',
    prefix: 'AIza… or AQ.…',
    steps: (email: string) => [
      <>
        Open{' '}
        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
          aistudio.google.com/app/apikey
        </a>{' '}
        and sign in with your Google account (for example <strong>{email}</strong> if it is a Gmail address).
      </>,
      <>
        Press <strong>Create API key</strong> (or <strong>Get API key</strong>). If asked, pick or create a project; the free tier needs no card.
      </>,
      <>
        Open the key and press <strong>Copy key</strong>. New keys start with <code>AQ.</code>, older ones with <code>AIza</code>. Both work.
      </>,
    ],
    note: 'Also powers the MP3 narration (Gemini voices).',
  },
  {
    id: 'groq',
    name: 'Groq',
    tag: 'Free · very fast',
    url: 'https://console.groq.com/keys',
    prefix: 'gsk_…',
    steps: () => [
      <>
        Open{' '}
        <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
          console.groq.com/keys
        </a>{' '}
        and sign in with Google, GitHub or email.
      </>,
      <>
        Press <strong>Create API Key</strong>, give it a name and copy it right away (it starts with <code>gsk_</code>).
      </>,
      <>Paste it below. Groq runs open models (Llama) on its free tier with generous daily limits.</>,
    ],
    note: 'No voice narration with Groq.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    tag: 'Free models',
    url: 'https://openrouter.ai/keys',
    prefix: 'sk-or-…',
    steps: () => [
      <>
        Open{' '}
        <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
          openrouter.ai/keys
        </a>{' '}
        and sign in.
      </>,
      <>
        Press <strong>Create Key</strong> and copy it (it starts with <code>sk-or-</code>).
      </>,
      <>Paste it below. CoWrite uses OpenRouter’s free models, so no credits are needed.</>,
    ],
    note: 'Free models have lower daily limits.',
  },
  {
    id: 'other',
    name: 'Any other key',
    tag: 'Auto-detected',
    url: 'https://cloud.cerebras.ai',
    prefix: 'any',
    steps: () => [
      <>
        Paste a key from any of these and CoWrite works out which service it belongs to: <strong>Cerebras</strong> (free, <code>csk-</code>), <strong>Mistral</strong> (free tier at console.mistral.ai),{' '}
        <strong>Hugging Face</strong> (free, <code>hf_</code>), <strong>GitHub Models</strong> (free, a <code>github_pat_</code> token), <strong>Together AI</strong>, <strong>DeepSeek</strong>,{' '}
        <strong>ChatGPT / OpenAI</strong> (<code>sk-</code>) or <strong>Claude</strong> (<code>sk-ant-</code>).
      </>,
      <>Paid services (OpenAI, Claude, DeepSeek) only work if your account has credit.</>,
      <>Photo and PDF tools work best with Gemini; text tools, Smart Create and the assistant work with every service.</>,
    ],
    note: 'Keys are encrypted before they are stored and are only used for your own requests.',
  },
];

/** Connect a personal AI key from any supported service; the server detects which one it is. */
export function AiKeySection({ user, onChange }: { user: User; onChange(connected: boolean, provider?: string | null): void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState('gemini');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const connected = !!user.aiConnected;
  const g = KEY_GUIDES.find((x) => x.id === guide)!;
  const providerName = AI_PROVIDER_NAMES[user.aiProvider ?? 'gemini'] ?? 'Gemini';

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ aiProvider: string; verified: boolean }>('/auth/me/ai-key', { method: 'PUT', body: { key: key.replace(/[\s​-‍⁠﻿]+/g, '') } });
      setKey('');
      onChange(true, r.aiProvider);
      setMsg({ ok: true, text: r.verified ? `Connected to ${AI_PROVIDER_NAMES[r.aiProvider] ?? 'your AI'}. Every AI feature now runs on your own key.` : `Saved. ${AI_PROVIDER_NAMES[r.aiProvider] ?? 'The service'} was too busy to confirm the key just now; it will be used as soon as it answers.` });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel ai-key" id="ai">
      <h2>AI assistant (free)</h2>
      {msg && <div className={msg.ok ? 'alert success' : 'alert'}>{msg.text}</div>}
      {connected ? (
        <>
          <p className="ai-status-line">
            <span className="ai-badge on">● Connected</span> AI features use <strong>your own {providerName} key</strong>.
          </p>
          <button
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={async () => {
              await api('/auth/me/ai-key', { method: 'DELETE' });
              onChange(false, null);
              setMsg({ ok: true, text: 'Disconnected. Your key was deleted from CoWrite.' });
            }}
            type="button"
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <p className="muted">Pick any one of these free services, get a key in about a minute, and paste it below. Every AI feature (writing, Smart Create, slides, translation, meeting notes, ask your documents) then runs on your own free quota.</p>
          <div className="key-tabs" role="tablist">
            {KEY_GUIDES.map((x) => (
              <button key={x.id} role="tab" aria-selected={guide === x.id} className={`key-tab ${guide === x.id ? 'on' : ''}`} onClick={() => setGuide(x.id)} type="button">
                <strong>{x.name}</strong>
                <span>{x.tag}</span>
              </button>
            ))}
          </div>
          <ol className="ai-steps">
            {g.steps(user.email).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
            <li>Paste it below and press Connect. CoWrite checks it, then stores it encrypted.</li>
          </ol>
          <p className="muted small">
            Key looks like <code>{g.prefix}</code>. {g.note}{' '}
            <a href={g.url} target="_blank" rel="noreferrer">
              Open {g.name} →
            </a>
          </p>
          <div className="inline-form">
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key here" autoComplete="off" aria-label="AI API key" />
            <button className="btn btn-primary btn-sm" disabled={busy || key.trim().length < 20} onClick={() => void save()} type="button">
              {busy ? 'Checking…' : 'Connect'}
            </button>
          </div>
          <details className="small key-help">
            <summary>Key still not accepted?</summary>
            <ul>
              <li>Copy it with the provider’s own copy button: the key is long and easy to cut short.</li>
              <li>Make sure there are no spaces before or after it.</li>
              <li>For Gemini, a brand-new key can take a minute to start working.</li>
              <li>Free tiers have daily limits. If one service is busy, try another.</li>
            </ul>
          </details>
          <p className="muted small">Free tiers may use your prompts to improve their products, so avoid pasting secrets into AI requests. You can disconnect at any time.</p>
        </>
      )}
    </section>
  );
}
