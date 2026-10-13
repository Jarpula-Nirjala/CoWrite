import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { Doc, type Op, type Snapshot } from '../shared/crdt.ts';
import { MAX_BATCH, type ClientMsg, type PeerInfo, type ServerMsg } from '../shared/protocol.ts';

export interface RoomLimits {
  /** Max items (characters incl. tombstones) per document. */
  maxItems: number;
  /** Max rooms held in memory at once. */
  maxRooms: number;
  /** Unload a room this long after its last client leaves. */
  idleMs: number;
}

export const DEFAULT_LIMITS: RoomLimits = { maxItems: 200_000, maxRooms: 500, idleMs: 5 * 60_000 };

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/**
 * One shared document. The server holds a replica of the CRDT like any
 * client; it relays ops, answers catch-up requests from state vectors and
 * persists snapshots.
 */
export class Room {
  readonly id: string;
  readonly doc: Doc;
  readonly peers = new Map<WebSocket, PeerInfo>();
  dirty = false;

  private readonly limits: RoomLimits;

  constructor(id: string, limits: RoomLimits, snapshot?: Snapshot) {
    this.id = id;
    this.limits = limits;
    this.doc = snapshot ? Doc.fromSnapshot('server', snapshot) : new Doc('server');
    this.doc.maxPending = 10_000;
  }

  handle(ws: WebSocket, msg: ClientMsg): void {
    const me = this.peers.get(ws);
    if (msg.t === 'hello') {
      if (me) return;
      const peer: PeerInfo = { site: msg.site, name: msg.name, color: msg.color, sel: null };
      send(ws, {
        t: 'welcome',
        ops: this.doc.missingFor(msg.vector),
        vector: this.doc.vector,
        peers: [...this.peers.values()],
      });
      this.peers.set(ws, peer);
      this.broadcast(ws, { t: 'presence', peer });
      return;
    }
    if (!me) return send(ws, { t: 'error', message: 'say hello first' });

    if (msg.t === 'ops') {
      // A client may only author ops under its own site id.
      if (!msg.ops.every((op) => op.id[0] === me.site)) return send(ws, { t: 'error', message: 'foreign op id' });
      const inserts = msg.ops.reduce((n, op) => n + (op.k === 'i' ? 1 : 0), 0);
      if (this.doc.size + inserts > this.limits.maxItems) {
        return send(ws, { t: 'error', message: 'This document reached its size limit; new edits are not saved.' });
      }
      const applied = this.doc.apply(msg.ops);
      if (applied.length) {
        this.dirty = true;
        this.broadcastOps(ws, applied);
      }
      send(ws, { t: 'ack', clock: this.doc.vector[me.site] ?? 0 });
      return;
    }

    me.name = msg.name;
    me.color = msg.color;
    me.sel = msg.sel;
    this.broadcast(ws, { t: 'presence', peer: me });
  }

  leave(ws: WebSocket): void {
    const peer = this.peers.get(ws);
    if (!peer) return;
    this.peers.delete(ws);
    this.broadcast(ws, { t: 'leave', site: peer.site });
  }

  private broadcastOps(from: WebSocket, ops: Op[]): void {
    for (let i = 0; i < ops.length; i += MAX_BATCH) this.broadcast(from, { t: 'ops', ops: ops.slice(i, i + MAX_BATCH) });
  }

  private broadcast(from: WebSocket, msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const ws of this.peers.keys()) {
      if (ws !== from && ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }
}

/** Opens rooms on demand, saves dirty ones and unloads idle ones. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly idleSince = new Map<string, number>();
  private readonly dataDir: string | null;
  private readonly limits: RoomLimits;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(dataDir: string | null, limits: RoomLimits = DEFAULT_LIMITS) {
    this.dataDir = dataDir;
    this.limits = limits;
    if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
    this.timer = setInterval(() => void this.sweep(), 2_000);
    this.timer.unref();
  }

  get count(): number {
    return this.rooms.size;
  }

  /** Returns the room, or null when the server is at capacity. */
  open(id: string): Room | null {
    let room = this.rooms.get(id);
    if (!room) {
      if (this.rooms.size >= this.limits.maxRooms) return null;
      room = new Room(id, this.limits, this.load(id));
      this.rooms.set(id, room);
    }
    this.idleSince.delete(id);
    return room;
  }

  release(room: Room): void {
    if (room.peers.size === 0) this.idleSince.set(room.id, Date.now());
  }

  /** Saves every dirty room and unloads rooms idle longer than the limit. */
  async sweep(force = false): Promise<void> {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.dirty) await this.save(room);
      const since = this.idleSince.get(room.id);
      if (room.peers.size === 0 && since !== undefined && (force || now - since >= this.limits.idleMs)) {
        this.rooms.delete(room.id);
        this.idleSince.delete(room.id);
      }
    }
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    for (const room of this.rooms.values()) if (room.dirty) await this.save(room);
  }

  private file(id: string): string {
    return path.join(this.dataDir!, `${id}.json`);
  }

  private load(id: string): Snapshot | undefined {
    if (!this.dataDir) return undefined;
    try {
      return JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as Snapshot;
    } catch {
      return undefined;
    }
  }

  private async save(room: Room): Promise<void> {
    room.dirty = false;
    if (!this.dataDir) return;
    const file = this.file(room.id);
    const tmp = `${file}.tmp`;
    try {
      await fs.promises.writeFile(tmp, JSON.stringify(room.doc.snapshot()));
      await fs.promises.rename(tmp, file);
    } catch (err) {
      room.dirty = true;
      console.error(`failed to save room ${room.id}:`, err);
    }
  }
}
