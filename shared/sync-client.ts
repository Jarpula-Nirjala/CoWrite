import { Doc, type Op, type Snapshot } from './crdt.ts';
import {
  MAX_BATCH,
  type ChatMessage,
  type ClientMsg,
  type NotifyTopic,
  type PeerInfo,
  type PresenceExt,
  type PresenceState,
  type Role,
  type Selection,
  type ServerMsg,
} from './protocol.ts';

/** WebSocket close code the server uses when a document is deleted. */
export const DELETED_CODE = 4404;
/** WebSocket close code for "you may not open this document". */
export const FORBIDDEN_CODE = 4403;

export type SyncStatus = 'connecting' | 'online' | 'offline';
export type SyncEvent = 'doc' | 'peers' | 'status' | 'error' | 'chat' | 'notify' | 'role' | 'stats' | 'signal';

export function randomSite(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

/** End-to-end encryption hooks: ops leave the browser encrypted. */
export interface OpCipher {
  encryptOps(ops: Op[]): Promise<Op[]>;
  decryptOps(ops: Op[]): Promise<Op[]>;
  encryptText(text: string): Promise<string>;
  decryptText(text: string): Promise<string>;
}

export interface SavedState {
  site: string;
  snapshot: Snapshot;
  outbox: Op[];
}

export interface SyncClientOptions {
  url: string;
  name: string;
  color: string;
  site?: string;
  /** Previously persisted state (offline support). */
  saved?: SavedState;
  cipher?: OpCipher;
  /** Custom socket constructor (tests use it to send cookies). */
  createSocket?: (url: string) => WebSocket;
}

export interface NetworkStats {
  sentOps: number;
  receivedOps: number;
  inFlight: number;
}

type Listener = (e: SyncEvent, payload?: unknown) => void;

/**
 * Keeps a local Doc in sync with a room on the server.
 *
 * Local edits are applied immediately and queued in an outbox until the
 * server acknowledges them, so editing keeps working while offline. On
 * (re)connect the client sends its state vector, receives exactly the ops it
 * missed, and resends anything still unacknowledged. The server ignores
 * duplicates, so resending is always safe.
 */
export class SyncClient {
  readonly doc: Doc;
  readonly peers = new Map<string, PeerInfo>();
  status: SyncStatus = 'offline';
  error: string | null = null;
  role: Role | null = null;
  encrypted = false;
  name: string;
  color: string;
  /** Artificial one-way delay in ms (chaos panel). */
  latency = 0;
  jitter = false;
  readonly stats: NetworkStats = { sentOps: 0, receivedOps: 0, inFlight: 0 };

  private readonly url: string;
  private readonly cipher: OpCipher | null;
  private readonly createSocket: (url: string) => WebSocket;
  private ws: WebSocket | null = null;
  private outbox: Op[] = [];
  private sel: Selection = null;
  private presenceState: PresenceState = 'active';
  private typing = false;
  private ext: PresenceExt = {};
  private wantOnline = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<Listener>();
  // Encryption is async; these chains keep messages in their original order.
  private recvChain: Promise<void> = Promise.resolve();
  private sendChain: Promise<void> = Promise.resolve();
  private linkDue = { up: 0, down: 0 };

  constructor(opts: SyncClientOptions) {
    this.url = opts.url;
    this.name = opts.name;
    this.color = opts.color;
    this.cipher = opts.cipher ?? null;
    this.createSocket = opts.createSocket ?? ((url) => new WebSocket(url));
    if (opts.saved) {
      this.doc = Doc.fromSnapshot(opts.saved.site, opts.saved.snapshot);
      this.outbox = opts.saved.outbox.slice();
      this.doc.apply(this.outbox);
    } else {
      this.doc = new Doc(opts.site ?? randomSite());
    }
  }

  /** Unacknowledged local ops. */
  get pending(): number {
    return this.outbox.length;
  }

  on(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  savedState(): SavedState {
    return { site: this.doc.site, snapshot: this.doc.snapshot(), outbox: this.outbox.slice() };
  }

  connect(): void {
    this.wantOnline = true;
    this.open();
  }

  disconnect(): void {
    this.wantOnline = false;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.dropPeers();
    this.setStatus('offline');
  }

  /** Report ops that were already applied to `this.doc` locally. */
  edit(ops: Op[]): void {
    if (!ops.length) return;
    for (const op of ops) this.outbox.push(op);
    if (this.status === 'online') this.sendOps(ops);
    this.emit('status');
  }

  setSelection(sel: Selection): void {
    this.sel = sel;
    this.sendPresence();
  }

  setPresence(state: PresenceState, typing: boolean): void {
    if (state === this.presenceState && typing === this.typing) return;
    this.presenceState = state;
    this.typing = typing;
    this.sendPresence();
  }

  /** Canvas presence: pointer, focused object, call state (merged). */
  setExt(ext: PresenceExt): void {
    this.ext = { ...this.ext, ...ext };
    this.sendPresence();
  }

  sendSignal(to: string, data: unknown): void {
    this.send({ t: 'signal', to, data });
  }

  /** Forward ops from other sites (received peer-to-peer) to the server. */
  relay(ops: Op[]): void {
    if (this.status !== 'online' || !ops.length) return;
    this.sendChain = this.sendChain.then(async () => {
      const wire = this.cipher ? await this.cipher.encryptOps(ops) : ops;
      for (const batch of batches(wire)) this.send({ t: 'relay', ops: batch });
    });
  }

  setName(name: string): void {
    this.name = name;
    this.sendPresence();
  }

  sendChat(body: string): void {
    if (this.status !== 'online') return;
    this.sendChain = this.sendChain.then(async () => {
      const wire = this.cipher ? await this.cipher.encryptText(body) : body;
      this.send({ t: 'chat', body: wire });
    });
  }

  // ------------------------------------------------------------ transport

  private open(): void {
    if (this.ws || !this.wantOnline) return;
    this.setStatus('connecting');
    const ws = this.createSocket(this.url);
    this.ws = ws;
    this.linkDue = { up: 0, down: 0 };
    ws.onopen = () => {
      this.send({ t: 'hello', site: this.doc.site, vector: this.doc.vector, name: this.name, color: this.color });
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMsg;
      this.delay('down', () => {
        if (this.ws !== ws) return;
        this.recvChain = this.recvChain.then(() => this.receive(msg)).catch((err) => {
          this.error = `Could not process an update: ${(err as Error).message}`;
          this.emit('error');
        });
      });
    };
    // Errors are followed by a close event, which handles reconnecting.
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.dropPeers();
      if (ev.code === DELETED_CODE || ev.code === FORBIDDEN_CODE) {
        this.wantOnline = false;
        this.error =
          ev.code === DELETED_CODE ? 'This document was deleted by its owner.' : 'You do not have access to this document.';
        this.emit('error');
      }
      if (!this.wantOnline) return this.setStatus('offline');
      this.setStatus('connecting');
      const delay = Math.min(10_000, 500 * 2 ** this.attempts++);
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
  }

  private async receive(msg: ServerMsg): Promise<void> {
    switch (msg.t) {
      case 'welcome': {
        this.attempts = 0;
        this.error = null;
        this.role = msg.role;
        this.encrypted = msg.encrypted;
        const ops = await this.decrypt(msg.ops);
        const changed = this.doc.apply(ops).length > 0;
        this.ack(msg.vector[this.doc.site] ?? 0);
        this.peers.clear();
        for (const p of msg.peers) this.peers.set(p.site, p);
        this.setStatus('online');
        if (this.outbox.length) this.sendOps(this.outbox);
        this.sendPresence();
        this.emit('role');
        if (changed) this.emit('doc');
        this.emit('peers');
        break;
      }
      case 'ops': {
        const ops = await this.decrypt(msg.ops);
        this.stats.receivedOps += ops.length;
        if (this.doc.apply(ops).length) this.emit('doc');
        this.emit('stats');
        break;
      }
      case 'ack':
        this.ack(msg.clock);
        this.emit('status');
        break;
      case 'presence':
        this.peers.set(msg.peer.site, msg.peer);
        this.emit('peers');
        break;
      case 'leave':
        this.peers.delete(msg.site);
        this.emit('peers');
        break;
      case 'chat': {
        const body = this.cipher ? await this.cipher.decryptText(msg.message.body).catch(() => '[could not decrypt]') : msg.message.body;
        this.emit('chat', { ...msg.message, body } satisfies ChatMessage);
        break;
      }
      case 'notify':
        this.emit('notify', msg.topic satisfies NotifyTopic);
        break;
      case 'signal':
        this.emit('signal', { from: msg.from, data: msg.data });
        break;
      case 'error':
        this.error = msg.message;
        this.emit('error');
        break;
    }
  }

  private decrypt(ops: Op[]): Promise<Op[]> {
    return this.cipher && ops.length ? this.cipher.decryptOps(ops) : Promise.resolve(ops);
  }

  /** Drop outbox entries the server has confirmed (all own ops up to `clock`). */
  private ack(clock: number): void {
    this.outbox = this.outbox.filter((op) => op.id[1] > clock);
  }

  private sendOps(ops: Op[]): void {
    const batch = ops.slice();
    this.stats.sentOps += batch.length;
    this.emit('stats');
    this.sendChain = this.sendChain.then(async () => {
      const wire = this.cipher ? await this.cipher.encryptOps(batch) : batch;
      for (const part of batches(wire)) this.send({ t: 'ops', ops: part });
    });
  }

  private sendPresence(): void {
    if (this.status === 'online') {
      this.send({ t: 'presence', name: this.name, color: this.color, sel: this.sel, state: this.presenceState, typing: this.typing, ext: this.ext });
    }
  }

  private send(msg: ClientMsg): void {
    const ws = this.ws;
    this.delay('up', () => {
      if (ws && ws === this.ws && ws.readyState === 1 /* OPEN */) ws.send(JSON.stringify(msg));
    });
  }

  /** Runs `fn` after the simulated latency, keeping each direction FIFO. */
  private delay(dir: 'up' | 'down', fn: () => void): void {
    if (this.latency <= 0) return fn();
    const now = Date.now();
    const d = this.jitter ? this.latency * (0.25 + Math.random() * 1.5) : this.latency;
    const due = Math.max(now + d, this.linkDue[dir]);
    this.linkDue[dir] = due;
    this.stats.inFlight++;
    this.emit('stats');
    setTimeout(() => {
      this.stats.inFlight--;
      fn();
      this.emit('stats');
    }, due - now);
  }

  private dropPeers(): void {
    if (!this.peers.size) return;
    this.peers.clear();
    this.emit('peers');
  }

  private setStatus(s: SyncStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit('status');
  }

  private emit(e: SyncEvent, payload?: unknown): void {
    for (const cb of this.listeners) cb(e, payload);
  }
}

/** Splits ops into messages under the server's size limits. */
export function batches(ops: Op[], maxBytes = 300_000): Op[][] {
  const out: Op[][] = [];
  let cur: Op[] = [];
  let size = 0;
  for (const op of ops) {
    const n = JSON.stringify(op).length;
    if (cur.length && (cur.length >= MAX_BATCH || size + n > maxBytes)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(op);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}
