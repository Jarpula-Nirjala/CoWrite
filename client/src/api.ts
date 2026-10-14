import type { Id } from '../../shared/crdt.ts';
import type { Role } from '../../shared/protocol.ts';

export interface User {
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
  brand?: Brand | null;
  prefs?: Prefs | null;
  /** They connected their own free Gemini key. */
  aiConnected?: boolean;
}

export interface Brand {
  name: string;
  logo: string | null;
  accent: string;
  font: string;
  deckTheme: string;
}

export type ThemeId = 'light' | 'dark' | 'sepia' | 'ocean' | 'forest' | 'rose' | 'midnight';

export interface Prefs {
  theme: ThemeId;
  dyslexic: boolean;
  dailyGoal: number;
}

export interface DocMeta {
  id: string;
  title: string;
  ownerId: string;
  folderId: string | null;
  tags: string[];
  starred: boolean;
  encrypted: boolean;
  published: boolean;
  parentId: string | null;
  wordGoal: number | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  snippet?: string;
  role?: Role;
  ownerName?: string;
  kind: DocKind;
  status: string;
  workspaceId: string | null;
  translatedFrom: string | null;
  lang: string | null;
  isTemplate: boolean;
}

export type DocKind = 'doc' | 'slides' | 'board' | 'kanban' | 'sheet';

export interface DocDetails extends DocMeta {
  ownerName: string;
  ownerUsername: string | null;
  parentTitle: string | null;
}

export interface Folder {
  id: string;
  name: string;
  count: number;
}

export interface Comment {
  id: string;
  parentId: string | null;
  anchorStart: Id | null;
  anchorEnd: Id | null;
  quote: string;
  body: string;
  authorId: string | null;
  authorName: string;
  color: string;
  resolved: boolean;
  createdAt: number;
}

export interface Suggestion {
  id: string;
  kind: 'insert' | 'delete';
  keys: string[];
  authorId: string | null;
  authorName: string;
  color: string;
  status: string;
  createdAt: number;
}

export interface Version {
  id: string;
  name: string;
  size: number;
  authorName: string;
  createdAt: number;
}

export interface Author {
  site: string;
  userId: string | null;
  name: string;
  color: string;
}

export interface Person {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
}

export interface Notification {
  id: string;
  kind: string;
  docId: string | null;
  actorName: string;
  body: string;
  read: boolean;
  createdAt: number;
}

export interface Providers {
  providers: ('google' | 'github')[];
  passwordReset: boolean;
  emailDelivery: boolean;
  ai: boolean;
  /** Which model the site's own key uses ('Gemini' or 'Claude'), if any. */
  aiName?: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; share?: string | null } = {}): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.share) headers['x-share-token'] = init.share;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status}).`);
  return data as T;
}

export const errorText = (e: unknown, fallback = 'Something went wrong. Please try again.') => (e instanceof ApiError ? e.message : fallback);

export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const formatDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Share tokens from invite links, remembered per document on this device. */
export const shareTokens = {
  get(docId: string): string | null {
    try {
      return localStorage.getItem(`cowrite:share:${docId}`);
    } catch {
      return null;
    }
  },
  set(docId: string, token: string) {
    try {
      localStorage.setItem(`cowrite:share:${docId}`, token);
    } catch {
      // ignore
    }
  },
};

/** Small JSON cache in localStorage for offline fallbacks. */
export const cache = {
  get<T>(key: string): T | null {
    try {
      const v = localStorage.getItem(`cowrite:cache:${key}`);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`cowrite:cache:${key}`, JSON.stringify(value));
    } catch {
      // ignore (quota or private mode)
    }
  },
};
