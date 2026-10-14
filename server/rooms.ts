import { WebSocket } from 'ws';
import { Doc, type Op, type Snapshot } from '../shared/crdt.ts';
import {
  canEdit,
  type ChatMessage,
  type ClientMsg,
  type NotifyTopic,
  type PeerInfo,
  type Role,
  type ServerMsg,
} from '../shared/protocol.ts';
import { DELETED_CODE, FORBIDDEN_CODE, batches } from '../shared/sync-client.ts';

export interface RoomLimits {
  /** Max items (characters incl. tombstones) per document. */
  maxItems: number;
  /** Max rooms held in memory at once. */
  maxRooms: number;
  /** Unload a room this long after its last client leaves. */
  idleMs: number;
}

export const DEFAULT_LIMITS: RoomLimits = { maxItems: 200_000, maxRooms: 500, idleMs: 5 * 60_000 };

export interface Connection {
  role: Role;
  userId: string | null;
}

/** Persistence and side effects, supplied by the app. */
export interface RoomHooks {
  load(roomId: string): Promise<{ snapshot: Snapshot | null; encrypted: boolean }>;
  save(roomId: string, snapshot: Snapshot, text: string | null): Promise<void>;
  /** A connected peer said hello (record its site for authorship). */
  joined(roomId: string, peer: PeerInfo): void;
  left(roomId: string, peer: PeerInfo): void;
  /** Ops from a peer changed the document. */
  edited(roomId: string, peer: PeerInfo | null, inserts: number, deletes: number): void;
  chat(roomId: string, peer: PeerInfo, body: string): Promise<ChatMessage>;
}

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

const countOps = (ops: Op[]) => {
  let inserts = 0;
  for (const op of ops) if (op.k === 'i') inserts++;
  return { inserts, deletes: ops.length - inserts };
};

/**
 * One shared document. The server holds a replica of the CRDT like any
 * client; it relays ops, answers catch-up requests from state vectors and
 * persists snapshots. It never needs to read the text, which is what makes
 * end-to-end encrypted documents possible.
 */
export class Room {
  readonly id: string;
  readonly doc: Doc;
  readonly encrypted: boolean;
  readonly peers = new Map<WebSocket, PeerInfo>();
  readonly conns = new Map<WebSocket, Connection>();
  /** Presence of server-side peers such as the AI co-writer. */
  readonly virtualPeers = new Map<string, PeerInfo>();
  dirty = false;
  removed = false;

  private readonly limits: RoomLimits;
  private readonly hooks: RoomHooks;

  constructor(id: string, limits: RoomLimits, hooks: RoomHooks, snapshot: Snapshot | null, encrypted: boolean) {
    this.id = id;
    this.limits = limits;
    this.hooks = hooks;
    this.encrypted = encrypted;
    this.doc = snapshot ? Doc.fromSnapshot('server', snapshot) : new Doc('server');
    this.doc.maxPending = 10_000;
  }

  attach(ws: WebSocket, conn: Connection): void {
    this.conns.set(ws, conn);
  }

  handle(ws: WebSocket, msg: ClientMsg): void {
    const conn = this.conns.get(ws);
    if (!conn) return;
    const me = this.peers.get(ws);
    if (msg.t === 'hello') {
      if (me) return;
      const peer: PeerInfo = {
        site: msg.site,
        name: msg.name,
        color: msg.color,
        sel: null,
        userId: conn.userId,
        state: 'active',
        typing: false,
      };
      send(ws, {
        t: 'welcome',
        ops: this.doc.missingFor(msg.vector),
        vector: this.doc.vector,
        peers: [...this.peers.values(), ...this.virtualPeers.values()],
        role: conn.role,
        encrypted: this.encrypted,
      });
      this.peers.set(ws, peer);
      this.hooks.joined(this.id, peer);
      this.broadcast(ws, { t: 'presence', peer });
      return;
    }
    if (!me) return send(ws, { t: 'error', message: 'say hello first' });

    switch (msg.t) {
      case 'ops': {
        if (!canEdit(conn.role)) return send(ws, { t: 'error', message: 'You have view-only access; edits are not saved.' });
        // A client may only author ops under its own site id.
        if (!msg.ops.every((op) => op.id[0] === me.site)) return send(ws, { t: 'error', message: 'foreign op id' });
        if (!this.encrypted && !msg.ops.every((op) => op.k !== 'i' || op.ch.length === 1)) {
          return send(ws, { t: 'error', message: 'malformed op' });
        }
        const { inserts } = countOps(msg.ops);
        if (this.doc.size + inserts > this.limits.maxItems) {
          return send(ws, { t: 'error', message: 'This document reached its size limit; new edits are not saved.' });
        }
        const applied = this.doc.apply(msg.ops);
        if (applied.length) {
          this.dirty = true;
          const c = countOps(applied);
          this.hooks.edited(this.id, me, c.inserts, c.deletes);
          this.broadcastOps(ws, applied);
        }
        send(ws, { t: 'ack', clock: this.doc.vector[me.site] ?? 0 });
        return;
      }
      case 'relay': {
        // Ops other peers made while this client synced with them directly.
        if (!canEdit(conn.role)) return;
        if (!this.encrypted && !msg.ops.every((op) => op.k !== 'i' || op.ch.length === 1)) return;
        const applied = this.doc.apply(msg.ops);
        if (applied.length) {
          this.dirty = true;
          const c = countOps(applied);
          this.hooks.edited(this.id, null, c.inserts, c.deletes);
          this.broadcastOps(ws, applied);
        }
        return;
      }
      case 'signal':
        for (const [peerWs, p] of this.peers) {
          if (p.site === msg.to) send(peerWs, { t: 'signal', from: me.site, data: msg.data });
        }
        return;
      case 'presence':
        me.name = msg.name;
        me.color = msg.color;
        me.sel = msg.sel;
        me.state = msg.state;
        me.typing = msg.typing;
        me.ext = msg.ext;
        this.broadcast(ws, { t: 'presence', peer: me });
        return;
      case 'chat':
        void this.hooks
          .chat(this.id, me, msg.body)
          .then((message) => this.broadcast(null, { t: 'chat', message }))
          .catch((err) => console.error('chat failed:', err));
        return;
    }
  }

  leave(ws: WebSocket): void {
    this.conns.delete(ws);
    const peer = this.peers.get(ws);
    if (!peer) return;
    this.peers.delete(ws);
    this.hooks.left(this.id, peer);
    this.broadcast(ws, { t: 'leave', site: peer.site });
  }

  /** Ops authored on the server (AI co-writer, merges) go to every client. */
  applyServerOps(ops: Op[], author: PeerInfo | null): Op[] {
    const applied = this.doc.apply(ops);
    if (applied.length) {
      this.dirty = true;
      const c = countOps(applied);
      this.hooks.edited(this.id, author, c.inserts, c.deletes);
      this.broadcastOps(null, applied);
    }
    return applied;
  }

  /** Broadcasts ops the server already applied to `doc` itself (e.g. via doc.insert). */
  publish(ops: Op[], author: PeerInfo | null): void {
    if (!ops.length) return;
    this.dirty = true;
    const c = countOps(ops);
    this.hooks.edited(this.id, author, c.inserts, c.deletes);
    this.broadcastOps(null, ops);
  }

  setVirtualPeer(site: string, peer: PeerInfo | null): void {
    if (peer) {
      this.virtualPeers.set(site, peer);
      this.broadcast(null, { t: 'presence', peer });
    } else if (this.virtualPeers.delete(site)) {
      this.broadcast(null, { t: 'leave', site });
    }
  }

  notify(topic: NotifyTopic): void {
    this.broadcast(null, { t: 'notify', topic });
  }

  /** Disconnect a user's sockets (their access changed); they may reconnect. */
  kick(userId: string | null, code = FORBIDDEN_CODE): void {
    for (const [ws, conn] of this.conns) if (userId === null || conn.userId === userId) ws.close(code, 'access changed');
  }

  private broadcastOps(from: WebSocket | null, ops: Op[]): void {
    for (const part of batches(ops)) this.broadcast(from, { t: 'ops', ops: part });
  }

  private broadcast(from: WebSocket | null, msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const ws of this.peers.keys()) {
      if (ws !== from && ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }
}

/** Opens rooms on demand, saves dirty ones and unloads idle ones. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly loading = new Map<string, Promise<Room>>();
  private readonly idleSince = new Map<string, number>();
  private readonly limits: RoomLimits;
  private readonly hooks: RoomHooks;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(hooks: RoomHooks, limits: RoomLimits = DEFAULT_LIMITS) {
    this.hooks = hooks;
    this.limits = limits;
    this.timer = setInterval(() => void this.sweep(), 2_000);
    this.timer.unref();
  }

  get count(): number {
    return this.rooms.size;
  }

  /** The room if it is loaded in memory. */
  loaded(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** Loads (or returns) the room; null when the server is at capacity. */
  async open(id: string): Promise<Room | null> {
    this.idleSince.delete(id);
    const existing = this.rooms.get(id);
    if (existing) return existing;
    if (this.rooms.size >= this.limits.maxRooms) return null;
    let p = this.loading.get(id);
    if (!p) {
      p = this.hooks.load(id).then(({ snapshot, encrypted }) => {
        const room = new Room(id, this.limits, this.hooks, snapshot, encrypted);
        this.rooms.set(id, room);
        this.loading.delete(id);
        return room;
      });
      p.catch(() => this.loading.delete(id));
      this.loading.set(id, p);
    }
    return p;
  }

  release(room: Room): void {
    if (room.conns.size === 0) this.idleSince.set(room.id, Date.now());
  }

  /** Deletes a document: disconnects everyone in it. */
  remove(id: string): void {
    const room = this.rooms.get(id);
    if (!room) return;
    room.removed = true;
    room.dirty = false;
    room.kick(null, DELETED_CODE);
    this.rooms.delete(id);
    this.idleSince.delete(id);
  }

  /** Saves every dirty room and unloads rooms idle longer than the limit. */
  async sweep(force = false): Promise<void> {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.dirty) await this.save(room);
      const since = this.idleSince.get(room.id);
      if (room.conns.size === 0 && since !== undefined && (force || now - since >= this.limits.idleMs)) {
        this.rooms.delete(room.id);
        this.idleSince.delete(room.id);
      }
    }
  }

  async save(room: Room): Promise<void> {
    if (room.removed) return;
    room.dirty = false;
    try {
      await this.hooks.save(room.id, room.doc.snapshot(), room.encrypted ? null : room.doc.text());
    } catch (err) {
      room.dirty = true;
      console.error(`failed to save room ${room.id}:`, err);
    }
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    for (const room of this.rooms.values()) if (room.dirty) await this.save(room);
  }
}
