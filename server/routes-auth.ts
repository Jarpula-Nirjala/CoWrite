import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { SESSION_TTL_MS, toPublic, type User } from './auth.ts';
import type { AppCtx } from './context.ts';
import { HttpError, SESSION_COOKIE, publicUrl, rateLimit, readCookie, requireUser } from './http.ts';
import { mailEnabled, sendMail } from './mail.ts';
import { detectProvider, keyCandidates, PROVIDER_NAMES } from './llm.ts';
import { authorizeUrl, enabledProviders, fetchProfile, type Provider } from './oauth.ts';

const STATE_COOKIE = 'cowrite_oauth';

export function authRoutes(ctx: AppCtx) {
  const r = express.Router();
  const { auth, vault } = ctx;
  const limiter = rateLimit(20, 10 * 60_000);

  const startSession = async (req: Request, res: Response, user: User) => {
    res.cookie(SESSION_COOKIE, await auth.createSession(user.id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  };

  r.get('/providers', (_req, res) => {
    res.json({ providers: enabledProviders(), passwordReset: true, emailDelivery: mailEnabled(), ai: ctx.ai.enabled, aiName: ctx.ai.serverName });
  });

  r.post('/signup', limiter, async (req, res) => {
    const user = await auth.signUp(req.body?.name, req.body?.email, req.body?.password);
    await startSession(req, res, user);
    res.json({ user: toPublic(user) });
  });

  r.post('/signin', limiter, async (req, res) => {
    const user = await auth.signIn(req.body?.email, req.body?.password);
    await startSession(req, res, user);
    res.json({ user: toPublic(user) });
  });

  r.post('/signout', async (req, res) => {
    await auth.endSession(readCookie(req.headers.cookie, SESSION_COOKIE));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.get('/me', (_req, res) => {
    const user = res.locals.user as User | null;
    res.json({ user: user ? toPublic(user) : null });
  });

  r.patch('/me', async (req, res) => {
    const user = requireUser(res);
    const { name, username, bio, avatar } = req.body ?? {};
    res.json({ user: toPublic(await auth.updateProfile(user.id, { name, username, bio, avatar })) });
  });

  r.put('/me/prefs', async (req, res) => {
    const user = requireUser(res);
    const b = req.body ?? {};
    const prefs = {
      theme: ['dark', 'sepia', 'ocean', 'forest', 'rose', 'midnight'].includes(b.theme) ? b.theme : 'light',
      dyslexic: b.dyslexic === true,
      dailyGoal: Math.max(0, Math.min(20_000, Math.round(Number(b.dailyGoal) || 0))),
    };
    await ctx.db.query('update users set prefs = $2::jsonb where id = $1', [user.id, JSON.stringify(prefs)]);
    res.json({ prefs });
  });

  /** Connect your own free Gemini key: AI then runs on your own quota. */
  r.put('/me/ai-key', limiter, async (req, res) => {
    const user = requireUser(res);
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (key.length < 16 || key.length > 400 || /\s/.test(key)) throw new HttpError(400, 'That does not look like an API key. Copy the whole key with its Copy button and paste it here.');
    const provider = await detectProvider(key);
    if (!provider) {
      const names = keyCandidates(key).map((p) => PROVIDER_NAMES[p]);
      throw new HttpError(400, `${names.join(', ')} did not accept this key. Copy it again with the Copy key button (no spaces), and check that the key is active.`);
    }
    await ctx.db.query('update users set ai_key = $2, ai_provider = $3 where id = $1', [user.id, await vault.seal(key), provider]);
    res.json({ aiConnected: true, aiProvider: provider, aiName: PROVIDER_NAMES[provider] });
  });

  r.delete('/me/ai-key', async (_req, res) => {
    const user = requireUser(res);
    await ctx.db.query('update users set ai_key = null, ai_provider = null where id = $1', [user.id]);
    res.json({ aiConnected: false });
  });

  r.put('/me/brand', async (req, res) => {
    const user = requireUser(res);
    const b = req.body ?? {};
    const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
    const logo = typeof b.logo === 'string' && /^\/api\/files\/[\w-]+$/.test(b.logo) ? b.logo : null;
    const brand = {
      name: typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '',
      logo,
      accent: hex(b.accent, '#1f3a68'),
      font: typeof b.font === 'string' && /^[a-z]{2,12}$/.test(b.font) ? b.font : 'serif',
      deckTheme: typeof b.deckTheme === 'string' && /^[a-z-]{2,20}$/.test(b.deckTheme) ? b.deckTheme : 'navy',
    };
    await ctx.db.query('update users set brand = $2::jsonb where id = $1', [user.id, JSON.stringify(brand)]);
    res.json({ brand });
  });

  r.post('/password', limiter, async (req, res) => {
    const user = requireUser(res);
    await auth.changePassword(user.id, req.body?.current, req.body?.password);
    await auth.endAllSessions(user.id, readCookie(req.headers.cookie, SESSION_COOKIE));
    res.json({ ok: true });
  });

  r.delete('/me', limiter, async (req, res) => {
    const user = requireUser(res);
    if (user.password) await auth.signIn(user.email, req.body?.password).catch(() => {
      throw new HttpError(400, 'Enter your password to delete your account.');
    });
    const owned = await ctx.db.query<{ id: string }>('select id from documents where owner_id = $1', [user.id]);
    for (const d of owned) ctx.rooms.remove(d.id);
    await ctx.docs.purge(owned.map((d) => d.id));
    await auth.deleteAccount(user.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ reset

  r.post('/forgot', limiter, async (req, res) => {
    const reset = await auth.createReset(req.body?.email);
    if (reset) {
      const link = `${publicUrl(req)}/reset?token=${reset.token}`;
      await sendMail(
        reset.user.email,
        'Reset your CoWrite password',
        `Hi ${reset.user.name},\n\nUse this link within one hour to choose a new password:\n${link}\n\nIf you did not ask for this, you can ignore this email.\n\n— CoWrite`,
      ).catch((err) => console.error(err));
    }
    // Same answer either way, so the form cannot be used to discover accounts.
    res.json({ ok: true });
  });

  r.post('/reset', limiter, async (req, res) => {
    const user = await auth.resetPassword(req.body?.token, req.body?.password);
    await startSession(req, res, user);
    res.json({ user: toPublic(user) });
  });

  // ------------------------------------------------------------ OAuth

  const provider = (req: Request): Provider => {
    const p = req.params.provider;
    if ((p !== 'google' && p !== 'github') || !enabledProviders().includes(p)) throw new HttpError(404, 'Sign-in provider not available.');
    return p;
  };
  const redirectUri = (req: Request, p: Provider) => `${publicUrl(req)}/api/auth/oauth/${p}/callback`;

  r.get('/oauth/:provider', (req, res) => {
    const p = provider(req);
    const state = crypto.randomBytes(16).toString('base64url');
    const next = typeof req.query.next === 'string' && req.query.next.startsWith('/') && !req.query.next.startsWith('//') ? req.query.next : '/home';
    res.cookie(STATE_COOKIE, `${state}|${next}`, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 10 * 60_000, path: '/' });
    res.redirect(authorizeUrl(p, redirectUri(req, p), state));
  });

  r.get('/oauth/:provider/callback', async (req, res) => {
    const fail = (msg: string) => res.redirect(`/signin?error=${encodeURIComponent(msg)}`);
    try {
      const p = provider(req);
      const [state, next] = (readCookie(req.headers.cookie, STATE_COOKIE) ?? '').split('|');
      res.clearCookie(STATE_COOKIE, { path: '/' });
      if (!state || state !== req.query.state || typeof req.query.code !== 'string') return fail('Sign-in was cancelled or expired. Please try again.');
      const profile = await fetchProfile(p, req.query.code, redirectUri(req, p));
      const user = await auth.oauthUser(p, profile.id, profile.email, profile.name, profile.avatar);
      await startSession(req, res, user);
      res.redirect(next || '/home');
    } catch (err) {
      console.error('oauth failed:', err);
      fail(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  });

  return r;
}
