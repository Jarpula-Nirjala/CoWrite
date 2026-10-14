import { api, type Prefs } from '../api.ts';

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
  root.toggleAttribute('data-dyslexic', p.dyslexic);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', p.theme === 'dark' ? '#14171c' : p.theme === 'sepia' ? '#f4ecd8' : '#ffffff');
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
