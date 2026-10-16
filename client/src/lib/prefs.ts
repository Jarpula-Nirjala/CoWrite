import { api, type Prefs, type ThemeId } from '../api.ts';

export interface AppTheme {
  id: ThemeId;
  name: string;
  bg: string;
  accent: string;
  fg: string;
  dark: boolean;
  /** Icon shown in the header switcher and on the theme cards. */
  icon: ThemeIconName;
}

export type ThemeIconName = 'auto' | 'sun' | 'book' | 'wave' | 'tree' | 'flower' | 'sprig' | 'leaf' | 'sunset' | 'cloud' | 'moon' | 'stars' | 'gem';

/** Colour themes: name, swatch colours (background, accent), whether the theme is dark, and its icon. */
export const APP_THEMES: AppTheme[] = [
  { id: 'auto', name: 'Match my device', bg: 'linear-gradient(135deg, #ffffff 58%, #d5dbe6 58%)', accent: '#1f3a68', fg: '#111418', dark: false, icon: 'auto' },
  { id: 'light', name: 'Classic white', bg: '#ffffff', accent: '#1f3a68', fg: '#111418', dark: false, icon: 'sun' },
  { id: 'sepia', name: 'Sepia', bg: '#f8f1e0', accent: '#7a4b1e', fg: '#3b2f22', dark: false, icon: 'book' },
  { id: 'ocean', name: 'Ocean', bg: '#f0f7fb', accent: '#0b6e99', fg: '#0f2a36', dark: false, icon: 'wave' },
  { id: 'forest', name: 'Forest', bg: '#f3f7f1', accent: '#2f6b3f', fg: '#1d2b20', dark: false, icon: 'tree' },
  { id: 'rose', name: 'Rose', bg: '#fdf4f6', accent: '#b23a66', fg: '#3a1d27', dark: false, icon: 'flower' },
  { id: 'lavender', name: 'Lavender', bg: '#f6f3fd', accent: '#6b4fbb', fg: '#251d3d', dark: false, icon: 'sprig' },
  { id: 'mint', name: 'Mint', bg: '#f0faf6', accent: '#0f8a6a', fg: '#11302a', dark: false, icon: 'leaf' },
  { id: 'sunset', name: 'Sunset', bg: '#fff5ee', accent: '#d2551c', fg: '#3b1f12', dark: false, icon: 'sunset' },
  { id: 'slate', name: 'Slate', bg: '#f3f5f8', accent: '#3d5a80', fg: '#1b2430', dark: false, icon: 'cloud' },
  { id: 'dark', name: 'Dark', bg: '#1f242c', accent: '#8fb0ea', fg: '#e7e9ee', dark: true, icon: 'moon' },
  { id: 'midnight', name: 'Midnight', bg: '#111a2e', accent: '#c7a6ff', fg: '#e6e9f5', dark: true, icon: 'stars' },
  { id: 'grape', name: 'Amethyst', bg: '#221a2e', accent: '#e08cf0', fg: '#f1e8f7', dark: true, icon: 'gem' },
];
export const THEME_IDS = APP_THEMES.map((t) => t.id);
/** Themes that were removed; anyone who had one sees Dark instead. */
const RETIRED: Record<string, ThemeId> = { coffee: 'dark', nord: 'dark', contrast: 'dark' };

export const DEFAULT_PREFS: Prefs = {
  theme: 'light',
  dyslexic: false,
  dailyGoal: 500,
  textSize: 'md',
  spacing: 'normal',
  appFont: 'default',
  reduceMotion: false,
  underlineLinks: false,
  strongFocus: false,
  bigCursor: false,
  grayscale: false,
};
const KEY = 'cowrite:prefs';

export function localPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

const darkQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** The theme actually shown: "Match my device" resolves to Classic white or Dark. */
export function effectiveTheme(id: ThemeId): AppTheme {
  const want = id === 'auto' ? (darkQuery?.matches ? 'dark' : 'light') : (RETIRED[id] ?? id);
  return APP_THEMES.find((t) => t.id === want) ?? APP_THEMES[1];
}

let current: Prefs = DEFAULT_PREFS;
darkQuery?.addEventListener('change', () => current.theme === 'auto' && applyPrefs(current));

/** Applies the theme, font and accessibility settings to the whole app. */
export function applyPrefs(p: Prefs) {
  current = { ...DEFAULT_PREFS, ...p };
  const root = document.documentElement;
  const t = effectiveTheme(current.theme);
  root.dataset.theme = t.id;
  root.dataset.tone = t.dark ? 'dark' : 'light';
  root.toggleAttribute('data-dyslexic', current.dyslexic);
  root.dataset.textSize = current.textSize ?? 'md';
  root.dataset.spacing = current.spacing ?? 'normal';
  root.dataset.appFont = current.appFont ?? 'default';
  root.toggleAttribute('data-reduce-motion', !!current.reduceMotion);
  root.toggleAttribute('data-underline-links', !!current.underlineLinks);
  root.toggleAttribute('data-strong-focus', !!current.strongFocus);
  root.toggleAttribute('data-big-cursor', !!current.bigCursor);
  root.toggleAttribute('data-grayscale', !!current.grayscale);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', t.bg);
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
