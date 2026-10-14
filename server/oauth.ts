/**
 * "Continue with Google / GitHub" via the OAuth 2.0 authorization-code flow.
 * A provider is enabled when its client id and secret are set in the
 * environment (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID /
 * GITHUB_CLIENT_SECRET). The redirect URI to register with the provider is
 * <PUBLIC_URL>/api/auth/oauth/<provider>/callback.
 */

export type Provider = 'google' | 'github';

export interface OAuthProfile {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
}

const creds = (p: Provider) =>
  p === 'google'
    ? { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET }
    : { id: process.env.GITHUB_CLIENT_ID, secret: process.env.GITHUB_CLIENT_SECRET };

export function enabledProviders(): Provider[] {
  return (['google', 'github'] as const).filter((p) => creds(p).id && creds(p).secret);
}

export function authorizeUrl(p: Provider, redirectUri: string, state: string): string {
  const { id } = creds(p);
  if (p === 'google') {
    const q = new URLSearchParams({ client_id: id!, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  const q = new URLSearchParams({ client_id: id!, redirect_uri: redirectUri, scope: 'read:user user:email', state });
  return `https://github.com/login/oauth/authorize?${q}`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`OAuth request failed (${res.status})`);
  return (await res.json()) as T;
}

export async function fetchProfile(p: Provider, code: string, redirectUri: string): Promise<OAuthProfile> {
  const { id, secret } = creds(p);
  if (p === 'google') {
    const token = await json<{ access_token: string }>(
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
    return { id: info.sub, email: info.email, name: info.name ?? '', avatar: info.picture ?? null };
  }
  const token = await json<{ access_token?: string; error?: string }>(
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
  return { id: String(user.id), email: email.email, name: user.name ?? user.login, avatar: user.avatar_url };
}
