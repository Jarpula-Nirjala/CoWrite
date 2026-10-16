import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from './db.ts';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  password: string | null;
  bio: string;
  avatar: string | null;
  google_id: string | null;
  github_id: string | null;
  created_at: number;
  brand?: Brand | null;
  prefs?: Prefs | null;
  ai_key?: string | null;
  ai_provider?: string | null;
}

/** Brand kit: applied to documents and decks in one click. */
export interface Brand {
  name: string;
  logo: string | null;
  accent: string;
  font: string;
  deckTheme: string;
}

/** Personal settings that follow the account across devices. */
export interface Prefs {
  theme: string;
  dyslexic: boolean;
  dailyGoal: number;
  textSize?: string;
  spacing?: string;
  appFont?: string;
  reduceMotion?: boolean;
  underlineLinks?: boolean;
  strongFocus?: boolean;
  bigCursor?: boolean;
  grayscale?: boolean;
}

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  name: string;
  bio: string;
  avatar: string | null;
  hasPassword: boolean;
  google: boolean;
  github: boolean;
  createdAt: number;
  brand: Brand | null;
  prefs: Prefs | null;
  /** Whether they connected their own (free) Gemini key. */
  aiConnected: boolean;
  /** 'gemini', 'groq' or 'openrouter'. */
  aiProvider: string | null;
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** How often an active session's 30 days are started again. */
export const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const MAX_AVATAR = 200_000;

export class AuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const toPublic = (u: User): PublicUser => ({
  id: u.id,
  email: u.email,
  username: u.username,
  name: u.name,
  bio: u.bio,
  avatar: u.avatar,
  hasPassword: u.password !== null,
  google: u.google_id !== null,
  github: u.github_id !== null,
  createdAt: u.created_at,
  brand: u.brand ?? null,
  prefs: u.prefs ?? null,
  aiConnected: !!u.ai_key,
  aiProvider: u.ai_key ? (u.ai_provider ?? 'gemini') : null,
});

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Only hashes of session and reset tokens are stored, so a database leak
// does not hand out working tokens.
const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function validateName(name: unknown): string {
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (clean.length < 1 || clean.length > 40) throw new AuthError(400, 'Name must be 1–40 characters.');
  return clean;
}

function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 200) throw new AuthError(400, 'Password must be at least 8 characters.');
  return pw;
}

function normEmail(email: unknown): string {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(e)) throw new AuthError(400, 'Enter a valid email address.');
  return e;
}

export class Auth {
  private readonly db: Db;
  // A real hash to compare against when the email is unknown, so response
  // time does not reveal which emails have accounts.
  private readonly dummyHash = hashPassword(crypto.randomBytes(16).toString('hex'));

  constructor(db: Db) {
    this.db = db;
  }

  async get(id: string): Promise<User | null> {
    const [u] = await this.db.query<User>('select * from users where id = $1', [id]);
    return u ?? null;
  }

  async byUsername(username: string): Promise<User | null> {
    const [u] = await this.db.query<User>('select * from users where username = $1', [username.toLowerCase()]);
    return u ?? null;
  }

  private async byEmail(email: string): Promise<User | null> {
    const [u] = await this.db.query<User>('select * from users where email = $1', [email]);
    return u ?? null;
  }

  /** A free handle derived from the name, e.g. "jarpula-nirjala" or "jarpula-nirjala-2". */
  private async freeUsername(seed: string): Promise<string> {
    let base = seed
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
    if (base.length < 3) base = `writer-${base}`.replace(/-+$/, '');
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      if (!(await this.byUsername(candidate))) return candidate;
    }
  }

  async signUp(nameIn: unknown, emailIn: unknown, passwordIn: unknown): Promise<User> {
    const name = validateName(nameIn);
    const email = normEmail(emailIn);
    const password = validatePassword(passwordIn);
    if (await this.byEmail(email)) throw new AuthError(409, 'An account with this email already exists.');
    return this.create({ name, email, password: await hashPassword(password) });
  }

  private async create(fields: { name: string; email: string; password: string | null; google_id?: string; github_id?: string; avatar?: string | null }): Promise<User> {
    const [u] = await this.db.query<User>(
      `insert into users (id, email, username, name, password, google_id, github_id, avatar, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [
        crypto.randomUUID(),
        fields.email,
        await this.freeUsername(fields.name),
        fields.name,
        fields.password,
        fields.google_id ?? null,
        fields.github_id ?? null,
        fields.avatar ?? null,
        Date.now(),
      ],
    );
    return u;
  }

  async signIn(emailIn: unknown, passwordIn: unknown): Promise<User> {
    const email = typeof emailIn === 'string' ? emailIn.trim().toLowerCase() : '';
    const password = typeof passwordIn === 'string' ? passwordIn.slice(0, 200) : '';
    const user = await this.byEmail(email);
    const ok = await verifyPassword(password, user?.password ?? (await this.dummyHash));
    if (!user || !user.password || !ok) throw new AuthError(401, 'Incorrect email or password.');
    return user;
  }

  /** Finds or creates the account for an OAuth identity, linking by verified email. */
  async oauthUser(provider: 'google' | 'github', providerId: string, email: string, name: string, avatar: string | null): Promise<User> {
    const col = provider === 'google' ? 'google_id' : 'github_id';
    const [linked] = await this.db.query<User>(`select * from users where ${col} = $1`, [providerId]);
    if (linked) return linked;
    const existing = await this.byEmail(email.toLowerCase());
    if (existing) {
      const [u] = await this.db.query<User>(`update users set ${col} = $1 where id = $2 returning *`, [providerId, existing.id]);
      return u;
    }
    return this.create({
      name: validateName(name || email.split('@')[0]),
      email: email.toLowerCase(),
      password: null,
      [col]: providerId,
      avatar,
    });
  }

  async updateProfile(userId: string, patch: { name?: unknown; username?: unknown; bio?: unknown; avatar?: unknown }): Promise<User> {
    const user = await this.get(userId);
    if (!user) throw new AuthError(404, 'Account not found.');
    const name = patch.name === undefined ? user.name : validateName(patch.name);
    let username = user.username;
    if (patch.username !== undefined) {
      const u = typeof patch.username === 'string' ? patch.username.trim().toLowerCase() : '';
      if (!USERNAME_RE.test(u)) throw new AuthError(400, 'Usernames are 3–30 lowercase letters, digits or hyphens.');
      const taken = await this.byUsername(u);
      if (taken && taken.id !== userId) throw new AuthError(409, 'That username is taken.');
      username = u;
    }
    let bio = user.bio;
    if (patch.bio !== undefined) {
      if (typeof patch.bio !== 'string' || patch.bio.length > 500) throw new AuthError(400, 'Bio must be at most 500 characters.');
      bio = patch.bio.trim();
    }
    let avatar = user.avatar;
    if (patch.avatar !== undefined) {
      if (patch.avatar === null) avatar = null;
      else if (typeof patch.avatar === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(patch.avatar) && patch.avatar.length <= MAX_AVATAR) {
        avatar = patch.avatar;
      } else throw new AuthError(400, 'Profile pictures must be a PNG, JPEG or WebP under 150 KB.');
    }
    const [u] = await this.db.query<User>('update users set name = $1, username = $2, bio = $3, avatar = $4 where id = $5 returning *', [
      name,
      username,
      bio,
      avatar,
      userId,
    ]);
    return u;
  }

  async changePassword(userId: string, current: unknown, next: unknown): Promise<void> {
    const user = await this.get(userId);
    if (!user) throw new AuthError(404, 'Account not found.');
    if (user.password && !(typeof current === 'string' && (await verifyPassword(current, user.password)))) {
      throw new AuthError(400, 'Your current password is incorrect.');
    }
    await this.db.query('update users set password = $1 where id = $2', [await hashPassword(validatePassword(next)), userId]);
  }

  async deleteAccount(userId: string): Promise<void> {
    await this.db.query('delete from users where id = $1', [userId]);
  }

  // --------------------------------------------------------------- sessions

  async createSession(userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await this.db.query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [
      tokenHash(token),
      userId,
      Date.now() + SESSION_TTL_MS,
    ]);
    return token;
  }

  async userForToken(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    const [u] = await this.db.query<User>(
      'select u.* from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > $2',
      [tokenHash(token), Date.now()],
    );
    return u ?? null;
  }

  /**
   * Like userForToken, and keeps an active session alive: once a day of use, its 30 days start again, so
   * people who keep using CoWrite stay signed in and only an unused session runs out. Returns whether the
   * session was renewed (the caller then refreshes the browser cookie).
   */
  async sessionForToken(token: string | undefined): Promise<{ user: User; renewed: boolean } | null> {
    if (!token) return null;
    const now = Date.now();
    const [row] = await this.db.query<User & { session_expires_at: number }>(
      'select u.*, s.expires_at as session_expires_at from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > $2',
      [tokenHash(token), now],
    );
    if (!row) return null;
    const { session_expires_at: expires, ...user } = row;
    if (expires - now > SESSION_TTL_MS - SESSION_RENEW_AFTER_MS) return { user: user as User, renewed: false };
    await this.db.query('update sessions set expires_at = $2 where token_hash = $1', [tokenHash(token), now + SESSION_TTL_MS]);
    return { user: user as User, renewed: true };
  }

  async endSession(token: string | undefined): Promise<void> {
    if (token) await this.db.query('delete from sessions where token_hash = $1', [tokenHash(token)]);
  }

  async endAllSessions(userId: string, except?: string): Promise<void> {
    await this.db.query('delete from sessions where user_id = $1 and token_hash <> $2', [userId, except ? tokenHash(except) : '']);
  }

  // --------------------------------------------------------- password reset

  /** Returns a reset token for the email's account, or null (callers must not reveal which). */
  async createReset(emailIn: unknown): Promise<{ user: User; token: string } | null> {
    let email: string;
    try {
      email = normEmail(emailIn);
    } catch {
      return null;
    }
    const user = await this.byEmail(email);
    if (!user) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    await this.db.query('insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, $3)', [
      tokenHash(token),
      user.id,
      Date.now() + RESET_TTL_MS,
    ]);
    return { user, token };
  }

  async resetPassword(token: unknown, password: unknown): Promise<User> {
    const pw = validatePassword(password);
    const [row] = await this.db.query<{ user_id: string }>(
      'update password_resets set used = true where token_hash = $1 and used = false and expires_at > $2 returning user_id',
      [tokenHash(String(token ?? '')), Date.now()],
    );
    if (!row) throw new AuthError(400, 'This reset link is invalid or has expired. Please request a new one.');
    await this.db.query('update users set password = $1 where id = $2', [await hashPassword(pw), row.user_id]);
    await this.db.query('delete from sessions where user_id = $1', [row.user_id]);
    return (await this.get(row.user_id))!;
  }
}
