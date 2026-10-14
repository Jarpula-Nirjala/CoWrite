import type { NextFunction, Request, Response } from 'express';
import type { User } from './auth.ts';

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const SESSION_COOKIE = 'cowrite_session';

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** The signed-in user, attached by middleware in app.ts. */
export function currentUser(res: Response): User | null {
  return (res.locals.user as User | null) ?? null;
}

export function requireUser(res: Response): User {
  const user = currentUser(res);
  if (!user) throw new HttpError(401, 'Please sign in to continue.');
  return user;
}

/** Fixed-window limiter keyed by client IP. */
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    let h = hits.get(key);
    if (!h || h.reset < now) {
      h = { n: 0, reset: now + windowMs };
      hits.set(key, h);
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    }
    if (++h.n > max) {
      res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
      return;
    }
    next();
  };
}

export const str = (x: unknown, max: number): string => (typeof x === 'string' ? x.slice(0, max) : '');

/** Base URL the browser used, e.g. https://cowrite.onrender.com */
export function publicUrl(req: Request): string {
  return process.env.PUBLIC_URL?.replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
}
