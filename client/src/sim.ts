import { Doc, type Op } from '../../shared/crdt.ts';
import type { Selection } from '../../shared/protocol.ts';

export interface SimReplica {
  name: string;
  color: string;
  doc: Doc;
  online: boolean;
  sel: Selection;
  /** Other replicas' selections as last delivered to this replica. */
  seen: Map<string, Selection>;
}

/**
 * An in-browser network between replicas that talk peer to peer. Each link
 * is FIFO like a TCP connection, but every message gets its own random delay,
 * so ops from different peers routinely race each other (Carol's reply can
 * reach Bob before the Alice edit it depends on). An offline replica neither
 * sends nor receives and catches up with state vectors when it comes back.
 */
export class SimNetwork {
  readonly replicas: SimReplica[];
  latency = 600;
  jitter = true;
  inFlight = 0;

  private listeners = new Set<() => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  /** Time the last message on each link is due, to keep links FIFO. */
  private linkDue = new Map<string, number>();

  constructor(people: { name: string; color: string }[], seedText: string) {
    const seed = new Doc('seed');
    seed.insert(0, seedText);
    const ops = seed.snapshot().ops;
    this.replicas = people.map(({ name, color }) => {
      const doc = new Doc(name.toLowerCase());
      doc.apply(ops);
      return { name, color, doc, online: true, sel: null, seen: new Map() };
    });
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  converged(): boolean {
    const text = this.replicas[0].doc.text();
    return this.inFlight === 0 && this.replicas.every((r) => r.online && r.doc.text() === text);
  }

  /** Call after applying `ops` to `from.doc` locally. */
  sendOps(from: SimReplica, ops: Op[]): void {
    if (ops.length && from.online) {
      for (const to of this.replicas) if (to !== from) this.deliver(from, to, () => to.doc.apply(ops));
    }
    this.emit();
  }

  sendSelection(from: SimReplica, sel: Selection): void {
    from.sel = sel;
    if (!from.online) return;
    const site = from.doc.site;
    for (const to of this.replicas) if (to !== from) this.deliver(from, to, () => to.seen.set(site, sel));
  }

  setOnline(r: SimReplica, online: boolean): void {
    r.online = online;
    if (online) {
      // Anti-entropy: each side sends exactly what the other is missing.
      for (const peer of this.replicas) {
        if (peer === r || !peer.online) continue;
        const toR = peer.doc.missingFor(r.doc.vector);
        const toPeer = r.doc.missingFor(peer.doc.vector);
        this.deliver(peer, r, () => r.doc.apply(toR));
        this.deliver(r, peer, () => peer.doc.apply(toPeer));
        this.deliver(r, peer, () => peer.seen.set(r.doc.site, r.sel));
        this.deliver(peer, r, () => r.seen.set(peer.doc.site, peer.sel));
      }
    }
    this.emit();
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.listeners.clear();
  }

  private deliver(from: SimReplica, to: SimReplica, action: () => void): void {
    const link = `${from.doc.site}>${to.doc.site}`;
    const now = performance.now();
    const delay = this.jitter ? this.latency * (0.25 + Math.random() * 1.5) : this.latency;
    const due = Math.max(now + delay, this.linkDue.get(link) ?? 0);
    this.linkDue.set(link, due);
    this.inFlight++;
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.inFlight--;
      // Messages to a replica that went offline are lost; it resyncs later.
      if (to.online) action();
      this.emit();
    }, due - now);
    this.timers.add(t);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}
