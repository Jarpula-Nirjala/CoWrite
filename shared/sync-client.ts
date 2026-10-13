import { Doc, type Op } from './crdt.ts';
import { MAX_BATCH, type ClientMsg, type PeerInfo, type Selection, type ServerMsg } from './protocol.ts';

export type SyncStatus = 'connecting' | 'online' | 'offline';
export type SyncEvent = 'doc' | 'peers' | 'status' | 'error';

export function randomSite(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

export interface SyncClientOptions {
  url: string;
  name: string;
  color: string;
  site?: string;
}

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
  name: string;
  color: string;

  private readonly url: string;
  private ws: WebSocket | null = null;
  private outbox: Op[] = [];
  private sel: Selection = null;
  private wantOnline = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<(e: SyncEvent) => void>();

  constructor(opts: SyncClientOptions) {
    this.url = opts.url;
    this.name = opts.name;
    this.color = opts.color;
    this.doc = new Doc(opts.site ?? randomSite());
  }

  /** Unacknowledged local ops. */
  get pending(): number {
    return this.outbox.length;
  }

  on(cb: (e: SyncEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
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

  setName(name: string): void {
    this.name = name;
    this.sendPresence();
  }

  // ------------------------------------------------------------ transport

  private open(): void {
    if (this.ws || !this.wantOnline) return;
    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: 'hello', site: this.doc.site, vector: this.doc.vector, name: this.name, color: this.color });
    };
    ws.onmessage = (ev) => {
      if (this.ws === ws) this.receive(JSON.parse(String(ev.data)) as ServerMsg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.dropPeers();
      if (!this.wantOnline) return this.setStatus('offline');
      this.setStatus('connecting');
      const delay = Math.min(10_000, 500 * 2 ** this.attempts++);
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
  }

  private receive(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome': {
        this.attempts = 0;
        this.error = null;
        const changed = this.doc.apply(msg.ops).length > 0;
        this.ack(msg.vector[this.doc.site] ?? 0);
        this.peers.clear();
        for (const p of msg.peers) this.peers.set(p.site, p);
        this.setStatus('online');
        if (this.outbox.length) this.sendOps(this.outbox);
        this.sendPresence();
        if (changed) this.emit('doc');
        this.emit('peers');
        break;
      }
      case 'ops':
        if (this.doc.apply(msg.ops).length) this.emit('doc');
        break;
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
      case 'error':
        this.error = msg.message;
        this.emit('error');
        break;
    }
  }

  /** Drop outbox entries the server has confirmed (all own ops up to `clock`). */
  private ack(clock: number): void {
    this.outbox = this.outbox.filter((op) => op.id[1] > clock);
  }

  private sendOps(ops: Op[]): void {
    for (let i = 0; i < ops.length; i += MAX_BATCH) this.send({ t: 'ops', ops: ops.slice(i, i + MAX_BATCH) });
  }

  private sendPresence(): void {
    if (this.status === 'online') this.send({ t: 'presence', name: this.name, color: this.color, sel: this.sel });
  }

  private send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
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

  private emit(e: SyncEvent): void {
    for (const cb of this.listeners) cb(e);
  }
}
