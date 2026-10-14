import { api, type Prefs, type ThemeId } from '../api.ts';

/** Colour themes: name, swatch colours (background, accent) and whether the theme is dark. */
export const APP_THEMES: { id: ThemeId; name: string; bg: string; accent: string; fg: string; dark: boolean }[] = [
  { id: 'light', name: 'Classic white', bg: '#ffffff', accent: '#1f3a68', fg: '#111418', dark: false },
  { id: 'sepia', name: 'Sepia', bg: '#f8f1e0', accent: '#7a4b1e', fg: '#3b2f22', dark: false },
  { id: 'ocean', name: 'Ocean', bg: '#f0f7fb', accent: '#0b6e99', fg: '#0f2a36', dark: false },
  { id: 'forest', name: 'Forest', bg: '#f3f7f1', accent: '#2f6b3f', fg: '#1d2b20', dark: false },
  { id: 'rose', name: 'Rose', bg: '#fdf4f6', accent: '#b23a66', fg: '#3a1d27', dark: false },
  { id: 'dark', name: 'Dark', bg: '#1f242c', accent: '#8fb0ea', fg: '#e7e9ee', dark: true },
  { id: 'midnight', name: 'Midnight', bg: '#111a2e', accent: '#c7a6ff', fg: '#e6e9f5', dark: true },
];

export const DEFAULT_PREFS: Prefs = { theme: 'light', dyslexic: false, dailyGoal: 500 };
const KEY = 'cowrite:prefs';

export function localPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Applies the reading theme and font to the whole app. */
export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  root.dataset.theme = p.theme;
  root.dataset.tone = APP_THEMES.find((t) => t.id === p.theme)?.dark ? 'dark' : 'light';
  root.toggleAttribute('data-dyslexic', p.dyslexic);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', APP_THEMES.find((t) => t.id === p.theme)?.bg ?? '#ffffff');
}

/** Saves preferences on this device and, when signed in, to the account. */
export async function savePrefs(p: Prefs, signedIn: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
  applyPrefs(p);
  window.dispatchEvent(new CustomEvent('cowrite:prefs', { detail: p }));
  if (signedIn) await api('/auth/me/prefs', { method: 'PUT', body: p }).catch(() => {});
}
