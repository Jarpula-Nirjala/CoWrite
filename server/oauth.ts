/**
 * "Continue with Google / GitHub" via the OAuth 2.0 authorization-code flow, and
 * linking those accounts so CoWrite can read Drive, Calendar and repositories.
 *
 * A provider is enabled when it has an OAuth client: either from the environment
 * (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET)
 * or saved by the site owner in Account settings (stored encrypted in server_secrets).
 * The redirect URI to register with the provider is <PUBLIC_URL>/api/auth/oauth/<provider>/callback.
 */
import type { Db } from './db.ts';
import type { Vault } from './secrets.ts';

export type Provider = 'google' | 'github';

export interface OAuthProfile {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
}

export interface OAuthTokens {
  access: string;
  refresh: string | null;
  /** Epoch milliseconds, or null when the token does not expire (GitHub). */
  expiresAt: number | null;
  scope: string;
}

/** Scopes for linking: read Drive and Calendar, create files in Drive; read repositories and write gists. */
export const LINK_SCOPES: Record<Provider, string> = {
  google: 'openid email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.readonly',
  github: 'read:user user:email repo gist',
};

/** Extra Google permissions, asked for only when someone switches the feature on. */
export const GOOGLE_EXTRAS: Record<string, string[]> = {
  gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
  youtube: ['https://www.googleapis.com/auth/youtube.readonly'],
  sheets: ['https://www.googleapis.com/auth/spreadsheets'],
  tasks: ['https://www.googleapis.com/auth/tasks'],
  calendar: ['https://www.googleapis.com/auth/calendar.events'],
};

const saved: Partial<Record<Provider, { id: string; secret: string }>> = {};
const env = (p: Provider) => (p === 'google' ? { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET } : { id: process.env.GITHUB_CLIENT_ID, secret: process.env.GITHUB_CLIENT_SECRET });
const creds = (p: Provider) => {
  const e = env(p);
  return e.id && e.secret ? e : (saved[p] ?? { id: undefined, secret: undefined });
};

/** Where a provider's OAuth client comes from: the server environment, the owner's settings, or nowhere. */
export function clientSource(p: Provider): 'env' | 'settings' | null {
  const e = env(p);
  return e.id && e.secret ? 'env' : saved[p] ? 'settings' : null;
}

export function enabledProviders(): Provider[] {
  return (['google', 'github'] as const).filter((p) => creds(p).id && creds(p).secret);
}

/** Loads OAuth clients the owner saved in settings. */
export async function loadOAuthClients(db: Db, vault: Vault): Promise<void> {
  const rows = await db.query<{ name: string; value: string }>("select name, value from server_secrets where name in ('oauth:google', 'oauth:github')");
  for (const r of rows) {
    const plain = await vault.open(r.value);
    if (!plain) continue;
    try {
      saved[r.name.slice(6) as Provider] = JSON.parse(plain) as { id: string; secret: string };
    } catch {
      // ignore a damaged entry
    }
  }
}

/** Saves (or with null, removes) an OAuth client entered by the site owner. */
export async function saveOAuthClient(db: Db, vault: Vault, p: Provider, client: { id: string; secret: string } | null): Promise<void> {
  if (!client) {
    await db.query('delete from server_secrets where name = $1', [`oauth:${p}`]);
    delete saved[p];
    return;
  }
  await db.query('insert into server_secrets (name, value) values ($1, $2) on conflict (name) do update set value = excluded.value', [`oauth:${p}`, await vault.seal(JSON.stringify(client))]);
  saved[p] = client;
}

export function authorizeUrl(p: Provider, redirectUri: string, state: string, link = false, extras: string[] = []): string {
  const { id } = creds(p);
  if (p === 'google') {
    const scope = link ? [LINK_SCOPES.google, ...extras.flatMap((x) => GOOGLE_EXTRAS[x] ?? [])].join(' ') : 'openid email profile';
    const q = new URLSearchParams({ client_id: id!, redirect_uri: redirectUri, response_type: 'code', scope, state, prompt: link ? 'consent' : 'select_account' });
    if (link) {
      q.set('access_type', 'offline');
      q.set('include_granted_scopes', 'true');
    }
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  const q = new URLSearchParams({ client_id: id!, redirect_uri: redirectUri, scope: link ? LINK_SCOPES.github : 'read:user user:email', state });
  return `https://github.com/login/oauth/authorize?${q}`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`OAuth request failed (${res.status})`);
  return (await res.json()) as T;
}

/** Exchanges the authorization code for tokens and reads the verified profile. */
export async function exchangeCode(p: Provider, code: string, redirectUri: string): Promise<{ profile: OAuthProfile; tokens: OAuthTokens }> {
  const { id, secret } = creds(p);
  if (p === 'google') {
    const token = await json<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(
      await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: id!, client_secret: secret!, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      }),
    );
    const info = await json<{ sub: string; email: string; email_verified: boolean; name?: string; picture?: string }>(
      await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${token.access_token}` } }),
    );
    if (!info.email_verified) throw new Error('Your Google email address is not verified.');
    return {
      profile: { id: info.sub, email: info.email, name: info.name ?? '', avatar: info.picture ?? null },
      tokens: { access: token.access_token, refresh: token.refresh_token ?? null, expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : null, scope: token.scope ?? '' },
    };
  }
  const token = await json<{ access_token?: string; scope?: string; error?: string }>(
    await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: id, client_secret: secret, code, redirect_uri: redirectUri }),
    }),
  );
  if (!token.access_token) throw new Error(token.error ?? 'GitHub sign-in failed.');
  const headers = { authorization: `Bearer ${token.access_token}`, 'user-agent': 'CoWrite', accept: 'application/vnd.github+json' };
  const user = await json<{ id: number; login: string; name: string | null; avatar_url: string }>(await fetch('https://api.github.com/user', { headers }));
  const emails = await json<{ email: string; primary: boolean; verified: boolean }[]>(await fetch('https://api.github.com/user/emails', { headers }));
  const email = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
  if (!email) throw new Error('Your GitHub account has no verified email address.');
  return {
    profile: { id: String(user.id), email: email.email, name: user.name ?? user.login, avatar: user.avatar_url },
    tokens: { access: token.access_token, refresh: null, expiresAt: null, scope: token.scope ?? '' },
  };
}

export async function fetchProfile(p: Provider, code: string, redirectUri: string): Promise<OAuthProfile> {
  return (await exchangeCode(p, code, redirectUri)).profile;
}

/** A fresh Google access token from a refresh token. */
export async function refreshGoogle(refresh: string): Promise<{ access: string; expiresAt: number }> {
  const { id, secret } = creds('google');
  if (!id || !secret) throw new Error('Google is not set up on this server.');
  const t = await json<{ access_token: string; expires_in: number }>(
    await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
    }),
  );
  return { access: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
}
