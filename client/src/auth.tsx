import { applyPrefs, localPrefs } from './lib/prefs.ts';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, cache, type Providers, type User } from './api.ts';

interface AuthState {
  user: User | null;
  /** False until the first /auth/me answer (or offline fallback) arrives. */
  ready: boolean;
  /** True when the server could not be reached and a cached user is shown. */
  offline: boolean;
  providers: Providers;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  setUser(user: User | null): void;
  /** AI works for this person: the site has a key, or they connected their own. */
  aiReady: boolean;
  /** The model that will answer: 'Gemini', 'Claude' or 'AI'. */
  aiName: string;
}

const NO_PROVIDERS: Providers = { providers: [], passwordReset: true, emailDelivery: false, ai: false };
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [providers, setProviders] = useState<Providers>(() => cache.get<Providers>('providers') ?? NO_PROVIDERS);

  const setUser = useCallback((u: User | null) => {
    setUserState(u);
    cache.set('user', u);
  }, []);

  useEffect(() => {
    api<{ user: User | null }>('/auth/me')
      .then((r) => {
        setUser(r.user);
        // Account preferences win over this device's (they follow you around).
        if (r.user?.prefs) {
          try {
            localStorage.setItem('cowrite:prefs', JSON.stringify(r.user.prefs));
          } catch {
            // ignore
          }
          applyPrefs({ ...localPrefs(), ...r.user.prefs });
        }
      })
      .catch((e) => {
        // Offline: keep working as the last signed-in user.
        if (e instanceof ApiError && e.status === 0) {
          setUserState(cache.get<User>('user'));
          setOffline(true);
        }
      })
      .finally(() => setReady(true));
    api<Providers>('/auth/providers')
      .then((p) => {
        setProviders(p);
        cache.set('providers', p);
      })
      .catch(() => {});
  }, [setUser]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setUser((await api<{ user: User }>('/auth/signin', { method: 'POST', body: { email, password } })).user);
    },
    [setUser],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      setUser((await api<{ user: User }>('/auth/signup', { method: 'POST', body: { name, email, password } })).user);
    },
    [setUser],
  );

  const signOut = useCallback(async () => {
    await api('/auth/signout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, [setUser]);

  const value = useMemo(
    () => ({
      user,
      ready,
      offline,
      providers,
      signIn,
      signUp,
      signOut,
      setUser,
      aiReady: providers.ai || !!user?.aiConnected,
      aiName: user?.aiConnected ? ({ groq: 'Groq', openrouter: 'OpenRouter' } as Record<string, string>)[user.aiProvider ?? ''] ?? 'Gemini' : (providers.aiName ?? 'AI'),
    }),
    [user, ready, offline, providers, signIn, signUp, signOut, setUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
