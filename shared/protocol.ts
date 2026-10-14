import type { Id, Op, Vector } from './crdt.ts';

/** A selection as stable anchors: [anchor, head]. Equal anchors = a caret. */
export type Selection = [anchor: Id | null, head: Id | null] | null;

export type Role = 'viewer' | 'commenter' | 'editor' | 'owner';
export type PresenceState = 'active' | 'idle' | 'away';

export const canEdit = (r: Role | null | undefined) => r === 'editor' || r === 'owner';
export const canComment = (r: Role | null | undefined) => r === 'commenter' || canEdit(r);

/** Extra presence for canvases: pointer position, selected object, call state. */
export interface PresenceExt {
  x?: number;
  y?: number;
  /** Slide id, sheet cell, board item… whatever the editor is focused on. */
  focus?: string | null;
  inCall?: boolean;
}

export interface PeerInfo {
  site: string;
  name: string;
  color: string;
  sel: Selection;
  userId: string | null;
  state: PresenceState;
  typing: boolean;
  ext?: PresenceExt;
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
export type NotifyTopic = 'comments' | 'suggestions' | 'versions' | 'meta' | 'members' | 'locks' | 'reactions' | 'workflow';

export type ClientMsg =
  | { t: 'hello'; site: string; vector: Vector; name: string; color: string }
  | { t: 'ops'; ops: Op[] }
  | { t: 'presence'; name: string; color: string; sel: Selection; state: PresenceState; typing: boolean; ext?: PresenceExt }
  | { t: 'chat'; body: string }
  /** Ops authored by other sites (received peer-to-peer) forwarded to the server. */
  | { t: 'relay'; ops: Op[] }
  /** WebRTC signalling for calls and direct links, forwarded to one peer. */
  | { t: 'signal'; to: string; data: unknown };

export type ServerMsg =
  | { t: 'welcome'; ops: Op[]; vector: Vector; peers: PeerInfo[]; role: Role; encrypted: boolean }
  | { t: 'ops'; ops: Op[] }
  | { t: 'ack'; clock: number }
  | { t: 'presence'; peer: PeerInfo }
  | { t: 'leave'; site: string }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'notify'; topic: NotifyTopic }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'error'; message: string };

export const SITE_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** Max ops per message; clients split larger batches. */
export const MAX_BATCH = 2000;
/** Plain documents hold one UTF-16 unit per item; encrypted ones hold ciphertext. */
export const MAX_CIPHER_CHARS = 64;
export const MAX_CHAT = 4000;
/** Largest attribute / field value accepted (drawings, tables…), as JSON. */
export const MAX_VALUE = 120_000;
const ATTR_RE = /^[A-Za-z0-9_-]{1,32}$/;
const OBJ_KEY_RE = /^[A-Za-z0-9_:.-]{1,96}$/;

function valueOk(v: unknown): boolean {
  if (v === null) return true;
  try {
    const json = JSON.stringify(v);
    return json !== undefined && json.length <= MAX_VALUE;
  } catch {
    return false;
  }
}

function attrsOk(a: unknown): boolean {
  if (a === undefined) return true;
  if (!isObj(a)) return false;
  const entries = Object.entries(a);
  return entries.length <= 24 && entries.every(([k]) => ATTR_RE.test(k)) && valueOk(a);
}

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
  switch (x.k) {
    case 'i':
      return (
        (x.o === null || isId(x.o)) &&
        typeof x.ch === 'string' &&
        x.ch.length >= 1 &&
        (x.ch.length <= MAX_CIPHER_CHARS || (x.a === undefined && x.ch.length <= MAX_VALUE)) &&
        attrsOk(x.a)
      );
    case 'd':
      return isId(x.t);
    case 'f':
      return isId(x.t) && typeof x.a === 'string' && ATTR_RE.test(x.a) && valueOk(x.v ?? null);
    case 'm':
      return typeof x.key === 'string' && OBJ_KEY_RE.test(x.key) && typeof x.f === 'string' && ATTR_RE.test(x.f) && valueOk(x.v ?? null);
    default:
      return false;
  }
}

function isExt(x: unknown): boolean {
  if (x === undefined) return true;
  if (!isObj(x)) return false;
  try {
    return JSON.stringify(x).length <= 400;
  } catch {
    return false;
  }
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
        typeof m.typing === 'boolean' &&
        isExt(m.ext)
        ? (m as ClientMsg)
        : null;
    case 'chat':
      return typeof m.body === 'string' && m.body.trim().length > 0 && m.body.length <= MAX_CHAT ? (m as ClientMsg) : null;
    case 'relay':
      return Array.isArray(m.ops) && m.ops.length <= MAX_BATCH && m.ops.every(isOp) ? (m as ClientMsg) : null;
    case 'signal':
      return typeof m.to === 'string' && SITE_RE.test(m.to) && valueOk(m.data ?? null) && JSON.stringify(m.data ?? null).length <= 20_000
        ? (m as ClientMsg)
        : null;
    default:
      return null;
  }
}
