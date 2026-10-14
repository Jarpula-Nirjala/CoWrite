import type { Request, Response } from 'express';
import type { Role } from '../shared/protocol.ts';
import type { AiWriter } from './ai.ts';
import type { Auth, User } from './auth.ts';
import type { Db } from './db.ts';
import type { DocRow, Docs } from './docs.ts';
import { HttpError, currentUser } from './http.ts';
import type { Notifier } from './notify.ts';
import type { RoomManager } from './rooms.ts';

export interface AppCtx {
  db: Db;
  auth: Auth;
  docs: Docs;
  rooms: RoomManager;
  notifier: Notifier;
  ai: AiWriter;
}

const RANK: Record<Role, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
export const atLeast = (role: Role | null, min: Role) => role !== null && RANK[role] >= RANK[min];

export interface Access {
  doc: DocRow | null;
  role: Role;
  user: User | null;
  docId: string;
}

/** Resolves the caller's role in document `:id`, or throws 403/404. */
export async function docAccess(ctx: AppCtx, req: Request, res: Response, min: Role, opts: { registered?: boolean } = {}): Promise<Access> {
  const docId = String(req.params.id);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(docId)) throw new HttpError(404, 'Document not found.');
  const user = currentUser(res);
  const share = req.get('x-share-token') ?? (typeof req.query.s === 'string' ? req.query.s : null);
  const { role, doc } = await ctx.docs.roleFor(docId, user, share);
  if (opts.registered && !doc) throw new HttpError(404, 'Document not found.');
  if (!role) throw new HttpError(doc?.deleted_at ? 404 : 403, doc?.deleted_at ? 'This document is in the trash.' : 'You do not have access to this document.');
  if (!atLeast(role, min)) throw new HttpError(403, 'You do not have permission to do that.');
  return { doc, role, user, docId };
}

/** Display name for whoever is making the request. */
export const actorName = (a: Access, fallback?: unknown) =>
  a.user?.name ?? (typeof fallback === 'string' && fallback.trim() ? fallback.trim().slice(0, 40) : 'A guest');
