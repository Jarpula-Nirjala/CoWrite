import type { Id, Op, Vector } from './crdt.ts';

/** A selection as stable anchors: [anchor, head]. Equal anchors = a caret. */
export type Selection = [anchor: Id | null, head: Id | null] | null;

export type Role = 'viewer' | 'commenter' | 'editor' | 'owner';
export type PresenceState = 'active' | 'idle' | 'away';

export const canEdit = (r: Role | null | undefined) => r === 'editor' || r === 'owner';
export const canComment = (r: Role | null | undefined) => r === 'commenter' || canEdit(r);

export interface PeerInfo {
  site: string;
  name: string;
  color: string;
  sel: Selection;
  userId: string | null;
  state: PresenceState;
  typing: boolean;
}

export interface ChatMessage {
  id: string;
  authorId: string | null;
  authorName: string;
  color: string;
  body: string;
  createdAt: number;
}

/** Things that changed elsewhere; clients refetch the matching data. */
export type NotifyTopic = 'comments' | 'suggestions' | 'versions' | 'meta' | 'members';

export type ClientMsg =
  | { t: 'hello'; site: string; vector: Vector; name: string; color: string }
  | { t: 'ops'; ops: Op[] }
  | { t: 'presence'; name: string; color: string; sel: Selection; state: PresenceState; typing: boolean }
  | { t: 'chat'; body: string };

export type ServerMsg =
  | { t: 'welcome'; ops: Op[]; vector: Vector; peers: PeerInfo[]; role: Role; encrypted: boolean }
  | { t: 'ops'; ops: Op[] }
  | { t: 'ack'; clock: number }
  | { t: 'presence'; peer: PeerInfo }
  | { t: 'leave'; site: string }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'notify'; topic: NotifyTopic }
  | { t: 'error'; message: string };

export const SITE_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** Max ops per message; clients split larger batches. */
export const MAX_BATCH = 2000;
/** Plain documents hold one UTF-16 unit per item; encrypted ones hold ciphertext. */
export const MAX_CIPHER_CHARS = 64;
export const MAX_CHAT = 4000;

// ---------------------------------------------------------------- validation
// The server is public, so every incoming message is checked before use.

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function isId(x: unknown): x is Id {
  return (
    Array.isArray(x) &&
    x.length === 2 &&
    typeof x[0] === 'string' &&
    SITE_RE.test(x[0]) &&
    Number.isSafeInteger(x[1]) &&
    (x[1] as number) > 0
  );
}

export function isOp(x: unknown): x is Op {
  if (!isObj(x) || !isId(x.id)) return false;
  if (x.k === 'i') {
    return (x.o === null || isId(x.o)) && typeof x.ch === 'string' && x.ch.length >= 1 && x.ch.length <= MAX_CIPHER_CHARS;
  }
  if (x.k === 'd') return isId(x.t);
  return false;
}

export function isSelection(x: unknown): x is Selection {
  return x === null || (Array.isArray(x) && x.length === 2 && x.every((a) => a === null || isId(a)));
}

function isVector(x: unknown): x is Vector {
  if (!isObj(x)) return false;
  const entries = Object.entries(x);
  return entries.length <= 10_000 && entries.every(([k, v]) => SITE_RE.test(k) && Number.isSafeInteger(v) && (v as number) >= 0);
}

const isName = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 40;
const isColor = (x: unknown): x is string => typeof x === 'string' && COLOR_RE.test(x);
const STATES = new Set(['active', 'idle', 'away']);

export function parseClientMsg(raw: string): ClientMsg | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m)) return null;
  switch (m.t) {
    case 'hello':
      return typeof m.site === 'string' && SITE_RE.test(m.site) && isVector(m.vector) && isName(m.name) && isColor(m.color)
        ? (m as ClientMsg)
        : null;
    case 'ops':
      return Array.isArray(m.ops) && m.ops.length <= MAX_BATCH && m.ops.every(isOp) ? (m as ClientMsg) : null;
    case 'presence':
      return isName(m.name) &&
        isColor(m.color) &&
        isSelection(m.sel) &&
        typeof m.state === 'string' &&
        STATES.has(m.state) &&
        typeof m.typing === 'boolean'
        ? (m as ClientMsg)
        : null;
    case 'chat':
      return typeof m.body === 'string' && m.body.trim().length > 0 && m.body.length <= MAX_CHAT ? (m as ClientMsg) : null;
    default:
      return null;
  }
}
