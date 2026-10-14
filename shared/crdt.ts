/**
 * RGA (Replicated Growable Array) — a sequence CRDT — extended with
 * per-character attributes and a key/value object map.
 *
 * Text. Every character ever inserted becomes an item with a globally unique
 * id `[site, clock]`, where `clock` is a Lamport timestamp. An insert names
 * the item it was typed after (its `origin`). To integrate an insert, a
 * replica finds the origin and then skips over every item whose id is greater
 * than the new id. Because ids are totally ordered and a causal successor
 * always has a larger clock than its cause, all replicas end up with the same
 * order no matter in which order they receive concurrent inserts. Deletes
 * never remove items; they mark them as tombstones so later inserts that
 * reference a deleted character still find their origin.
 *
 * Rich text. Each item carries attributes (bold, link, block type…). Every
 * attribute is a last-writer-wins register: a format op sets one attribute of
 * one item and wins if its id is greater than the register's current id.
 * Blocks follow a flat model: a "\n" item ends a paragraph and carries the
 * block's type, and "￼" is an embedded object (image, table, drawing…).
 *
 * Objects. A map of objects with last-writer-wins fields powers slides,
 * whiteboards, boards and sheets, using the same ids, clocks and sync.
 *
 * Sync. Each replica tracks a state vector (highest clock seen per site).
 * Because a site's operations are delivered in order, the vector describes
 * which operations a replica has, so catch-up is a single `missingFor(vector)`.
 */

export type Id = [site: string, clock: number];
export type Attrs = Record<string, unknown>;

export interface InsertOp {
  k: 'i';
  id: Id;
  /** Id of the item this character was inserted after; null = start of doc. */
  o: Id | null;
  ch: string;
  /** Initial attributes. */
  a?: Attrs;
}

export interface DeleteOp {
  k: 'd';
  id: Id;
  /** Id of the item being deleted. */
  t: Id;
}

/** Sets attribute `a` of item `t` to `v` (null removes it). */
export interface FormatOp {
  k: 'f';
  id: Id;
  t: Id;
  a: string;
  v: unknown;
}

/** Sets field `f` of object `key` to `v` (null removes it). */
export interface MapOp {
  k: 'm';
  id: Id;
  key: string;
  f: string;
  v: unknown;
}

export type Op = InsertOp | DeleteOp | FormatOp | MapOp;

/** Highest clock seen from each site. */
export type Vector = Record<string, number>;

export interface Snapshot {
  ops: Op[];
  vector: Vector;
}

export interface InspectItem {
  key: string;
  site: string;
  clock: number;
  ch: string;
  deleted: boolean;
}

export interface Token {
  id: Id;
  ch: string;
  attrs: Attrs;
}

interface Register {
  v: unknown;
  id: Id;
}

interface Item {
  id: Id;
  origin: Id | null;
  ch: string;
  /** Id of the delete op that tombstoned this item, or null if visible. */
  del: Id | null;
  attrs: Map<string, Register> | null;
}

export const BLOCK = '\n';
export const EMBED = '￼';

export const keyOf = (id: Id): string => `${id[0]}:${id[1]}`;

export function parseKey(key: string): Id {
  const i = key.lastIndexOf(':');
  return [key.slice(0, i), Number(key.slice(i + 1))];
}

/** Total order on ids: Lamport clock first, site id breaks ties. */
export function compareIds(a: Id, b: Id): number {
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

export function sameId(a: Id | null, b: Id | null): boolean {
  if (a === null || b === null) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

/** Stable comparison of attribute values. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// Spreading a huge array into splice() overflows the call stack, so large
// pastes are inserted in chunks.
function spliceIn<T>(arr: T[], index: number, values: T[]): void {
  const CHUNK = 10_000;
  for (let i = 0; i < values.length; i += CHUNK) {
    arr.splice(index + i, 0, ...values.slice(i, i + CHUNK));
  }
}

function effective(map: Map<string, Register> | null): Attrs {
  const out: Attrs = {};
  if (map) for (const [k, r] of map) if (r.v !== null && r.v !== undefined) out[k] = r.v;
  return out;
}

export class Doc {
  readonly site: string;
  /** Upper bound on buffered ops waiting for a missing dependency. */
  maxPending = Infinity;

  private clock = 0;
  private items: Item[] = [];
  private byKey = new Map<string, Item>();
  private objects = new Map<string, Map<string, Register>>();
  private vec: Vector = {};
  private pending: Op[] = [];
  private visible = 0;
  // Index of the most recently integrated remote item. Remote runs (a peer
  // typing or pasting) chain origins, so this turns most lookups into O(1).
  private hint = -1;

  constructor(site: string) {
    this.site = site;
  }

  /** Number of visible characters (tokens). */
  get length(): number {
    return this.visible;
  }

  /** Number of items including tombstones. */
  get size(): number {
    return this.items.length;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get vector(): Vector {
    return { ...this.vec };
  }

  get lamport(): number {
    return this.clock;
  }

  text(): string {
    const out: string[] = [];
    for (const it of this.items) if (!it.del) out.push(it.ch);
    return out.join('');
  }

  /** Visible tokens with their effective attributes. */
  tokens(): Token[] {
    const out: Token[] = [];
    for (const it of this.items) if (!it.del) out.push({ id: it.id, ch: it.ch, attrs: effective(it.attrs) });
    return out;
  }

  attrsOf(id: Id): Attrs | null {
    const it = this.byKey.get(keyOf(id));
    return it ? effective(it.attrs) : null;
  }

  // ------------------------------------------------------------ local edits

  /**
   * Inserts `text` at visible position `pos` and returns the ops to broadcast.
   * `site` lets a server-side author (the AI co-writer) write under its own id.
   */
  insert(pos: number, text: string, site = this.site, attrs?: Attrs): InsertOp[] {
    const tokens: { ch: string; a?: Attrs }[] = [];
    for (let i = 0; i < text.length; i++) tokens.push({ ch: text[i], a: attrs });
    return this.insertTokens(pos, tokens, site);
  }

  /** Inserts characters that may each carry different attributes. */
  insertTokens(pos: number, tokens: { ch: string; a?: Attrs }[], site = this.site): InsertOp[] {
    if (pos < 0 || pos > this.visible) throw new RangeError(`insert position ${pos} out of range`);
    if (!tokens.length) return [];

    let index = 0;
    let origin: Id | null = null;
    if (pos > 0) {
      const before = this.visibleIndex(pos - 1);
      origin = this.items[before].id;
      index = before + 1;
    }

    // A fresh id is greater than every id this replica has seen, so the RGA
    // skip loop would stop immediately: the run goes right after its origin.
    const ops: InsertOp[] = [];
    const created: Item[] = [];
    for (const t of tokens) {
      const id: Id = [site, ++this.clock];
      const a = t.a && Object.keys(t.a).length ? clean(t.a) : undefined;
      const item: Item = { id, origin, ch: t.ch, del: null, attrs: a ? registers(a, id) : null };
      created.push(item);
      this.byKey.set(keyOf(id), item);
      const op: InsertOp = { k: 'i', id, o: origin, ch: t.ch };
      if (a) op.a = a;
      ops.push(op);
      origin = id;
    }
    spliceIn(this.items, index, created);
    this.visible += tokens.length;
    this.vec[site] = this.clock;
    return ops;
  }

  /** Deletes `len` visible characters starting at `pos`. */
  delete(pos: number, len: number, site = this.site): DeleteOp[] {
    if (len <= 0) return [];
    if (pos < 0 || pos + len > this.visible) throw new RangeError(`delete range ${pos}+${len} out of range`);

    const ops: DeleteOp[] = [];
    let i = this.visibleIndex(pos);
    while (ops.length < len) {
      const it = this.items[i++];
      if (it.del) continue;
      const id: Id = [site, ++this.clock];
      it.del = id;
      ops.push({ k: 'd', id, t: it.id });
    }
    this.visible -= len;
    this.vec[site] = this.clock;
    return ops;
  }

  /** Deletes specific characters by id (unknown or already deleted ids are skipped). */
  deleteIds(ids: Id[], site = this.site): DeleteOp[] {
    const ops: DeleteOp[] = [];
    for (const target of ids) {
      const it = this.byKey.get(keyOf(target));
      if (!it || it.del) continue;
      const id: Id = [site, ++this.clock];
      it.del = id;
      this.visible--;
      ops.push({ k: 'd', id, t: it.id });
    }
    if (ops.length) this.vec[site] = this.clock;
    return ops;
  }

  /** Sets one attribute on the given items (skipping items that already have that value). */
  format(ids: Id[], attr: string, value: unknown, site = this.site): FormatOp[] {
    const ops: FormatOp[] = [];
    const v = value === undefined ? null : value;
    for (const target of ids) {
      const it = this.byKey.get(keyOf(target));
      if (!it) continue;
      const cur = it.attrs?.get(attr);
      if (sameValue(cur?.v ?? null, v)) continue;
      const id: Id = [site, ++this.clock];
      (it.attrs ??= new Map()).set(attr, { v, id });
      ops.push({ k: 'f', id, t: it.id, a: attr, v });
    }
    if (ops.length) this.vec[site] = this.clock;
    return ops;
  }

  /** Sets fields of an object in the map. */
  setFields(key: string, fields: Attrs, site = this.site): MapOp[] {
    const ops: MapOp[] = [];
    let obj = this.objects.get(key);
    for (const [f, value] of Object.entries(fields)) {
      const v = value === undefined ? null : value;
      if (sameValue(obj?.get(f)?.v ?? null, v)) continue;
      const id: Id = [site, ++this.clock];
      if (!obj) this.objects.set(key, (obj = new Map()));
      obj.set(f, { v, id });
      ops.push({ k: 'm', id, key, f, v });
    }
    if (ops.length) this.vec[site] = this.clock;
    return ops;
  }

  /** An object's fields, or null if it doesn't exist or was removed (`_del`). */
  getObject(key: string): Attrs | null {
    const obj = this.objects.get(key);
    if (!obj) return null;
    const a = effective(obj);
    return a._del ? null : a;
  }

  /** Live objects whose key starts with `prefix`. */
  objectsWith(prefix: string): { key: string; fields: Attrs }[] {
    const out: { key: string; fields: Attrs }[] = [];
    for (const [key, obj] of this.objects) {
      if (!key.startsWith(prefix)) continue;
      const fields = effective(obj);
      if (!fields._del) out.push({ key, fields });
    }
    return out;
  }

  // --------------------------------------------------------------- remote ops

  /**
   * Integrates remote ops. Safe to call with duplicates and with ops whose
   * dependencies have not arrived yet (they are buffered). Returns the ops
   * that changed this replica, including buffered ops that became ready.
   */
  apply(ops: Op[]): Op[] {
    const applied: Op[] = [];
    let progressed = false;
    for (const op of ops) {
      const r = this.integrate(op);
      if (r === null) {
        if (this.pending.length < this.maxPending) this.pending.push(op);
      } else {
        progressed = true;
        if (r) applied.push(op);
      }
    }
    if (progressed && this.pending.length) this.flushPending(applied);
    return applied;
  }

  /** true = applied, false = already known / no effect, null = missing dependency. */
  private integrate(op: Op): boolean | null {
    let changed: boolean;
    switch (op.k) {
      case 'i': {
        const key = keyOf(op.id);
        if (this.byKey.has(key)) {
          changed = false;
          break;
        }
        let i = 0;
        if (op.o) {
          const origin = this.byKey.get(keyOf(op.o));
          if (!origin) return null;
          i = this.indexOfItem(origin) + 1;
        }
        // RGA rule: concurrent inserts after the same origin are ordered by
        // descending id. Skipping greater ids also skips their descendants,
        // since every descendant has a larger clock still.
        while (i < this.items.length && compareIds(this.items[i].id, op.id) > 0) i++;
        const item: Item = { id: op.id, origin: op.o, ch: op.ch, del: null, attrs: op.a ? registers(op.a, op.id) : null };
        this.items.splice(i, 0, item);
        this.byKey.set(key, item);
        this.visible++;
        this.hint = i;
        changed = true;
        break;
      }
      case 'd': {
        const target = this.byKey.get(keyOf(op.t));
        if (!target) return null;
        if (target.del) {
          changed = false; // duplicate, or a concurrent delete of the same char
        } else {
          target.del = op.id;
          this.visible--;
          changed = true;
        }
        break;
      }
      case 'f': {
        const target = this.byKey.get(keyOf(op.t));
        if (!target) return null;
        const cur = target.attrs?.get(op.a);
        changed = !cur || compareIds(op.id, cur.id) > 0;
        if (changed) (target.attrs ??= new Map()).set(op.a, { v: op.v, id: op.id });
        break;
      }
      case 'm': {
        let obj = this.objects.get(op.key);
        const cur = obj?.get(op.f);
        changed = !cur || compareIds(op.id, cur.id) > 0;
        if (changed) {
          if (!obj) this.objects.set(op.key, (obj = new Map()));
          obj.set(op.f, { v: op.v, id: op.id });
        }
        break;
      }
    }
    this.observe(op.id);
    return changed;
  }

  private flushPending(applied: Op[]): void {
    let progressed = true;
    while (progressed && this.pending.length) {
      progressed = false;
      const waiting: Op[] = [];
      for (const op of this.pending) {
        const r = this.integrate(op);
        if (r === null) {
          waiting.push(op);
        } else {
          progressed = true;
          if (r) applied.push(op);
        }
      }
      this.pending = waiting;
    }
  }

  private observe(id: Id): void {
    const [site, clock] = id;
    if ((this.vec[site] ?? 0) < clock) this.vec[site] = clock;
    if (this.clock < clock) this.clock = clock;
  }

  // ------------------------------------------------------------------- sync

  /**
   * Every op this replica knows that a replica with state `vector` lacks, in
   * an order that is safe to apply: inserts in document order (an item's
   * origin always sits to its left), then deletes, formats and object fields.
   * Attribute registers only keep their latest write, which is all a
   * last-writer-wins register needs.
   */
  missingFor(vector: Vector): Op[] {
    const has = (id: Id) => (vector[id[0]] ?? 0) >= id[1];
    const inserts: Op[] = [];
    const later: Op[] = [];
    for (const it of this.items) {
      if (!has(it.id)) {
        const op: InsertOp = { k: 'i', id: it.id, o: it.origin, ch: it.ch };
        // Attributes still holding their initial value travel with the insert.
        if (it.attrs) {
          const a: Attrs = {};
          let any = false;
          for (const [k, r] of it.attrs) {
            if (sameId(r.id, it.id)) {
              a[k] = r.v;
              any = true;
            }
          }
          if (any) op.a = a;
        }
        inserts.push(op);
      }
      if (it.del && !has(it.del)) later.push({ k: 'd', id: it.del, t: it.id });
      if (it.attrs) {
        for (const [a, r] of it.attrs) if (!sameId(r.id, it.id) && !has(r.id)) later.push({ k: 'f', id: r.id, t: it.id, a, v: r.v });
      }
    }
    for (const [key, obj] of this.objects) for (const [f, r] of obj) if (!has(r.id)) later.push({ k: 'm', id: r.id, key, f, v: r.v });
    return inserts.concat(later);
  }

  snapshot(): Snapshot {
    return { ops: this.missingFor({}), vector: this.vector };
  }

  static fromSnapshot(site: string, snap: Snapshot): Doc {
    const doc = new Doc(site);
    doc.apply(snap.ops);
    for (const [s, c] of Object.entries(snap.vector)) doc.observe([s, c]);
    return doc;
  }

  // ---------------------------------------------------- positions <-> anchors

  /**
   * Stable anchor for a caret at visible position `pos`: the id of the
   * character just before it (null = start of document). Anchors survive
   * concurrent edits, unlike numeric offsets.
   */
  idBefore(pos: number): Id | null {
    if (pos <= 0 || this.visible === 0) return null;
    return this.items[this.visibleIndex(Math.min(pos, this.visible) - 1)].id;
  }

  /** Visible caret position for an anchor; -1 if the anchor is unknown here. */
  posAfter(anchor: Id | null): number {
    if (anchor === null) return 0;
    const target = this.byKey.get(keyOf(anchor));
    if (!target) return -1;
    let pos = 0;
    for (const it of this.items) {
      if (it === target) return it.del ? pos : pos + 1;
      if (!it.del) pos++;
    }
    return -1;
  }

  /** Id of the visible character at `pos`. */
  idAt(pos: number): Id {
    return this.items[this.visibleIndex(pos)].id;
  }

  /**
   * Where a character is: its visible position, or for a tombstone the
   * position it would occupy. Null if this replica has never seen it.
   */
  locate(id: Id): { pos: number; deleted: boolean } | null {
    const target = this.byKey.get(keyOf(id));
    if (!target) return null;
    let pos = 0;
    for (const it of this.items) {
      if (it === target) return { pos, deleted: it.del !== null };
      if (!it.del) pos++;
    }
    return null;
  }

  /** Index in the full item list (tombstones included), or -1. */
  indexOf(id: Id): number {
    const it = this.byKey.get(keyOf(id));
    return it ? this.indexOfItem(it) : -1;
  }

  /** Ids of the visible characters in [from, to). */
  idsInRange(from: number, to: number): Id[] {
    const out: Id[] = [];
    let pos = 0;
    for (const it of this.items) {
      if (it.del) continue;
      if (pos >= to) break;
      if (pos >= from) out.push(it.id);
      pos++;
    }
    return out;
  }

  /** The still-visible characters among `ids`, in document order, with their text. */
  visibleAmong(ids: Id[]): { ids: Id[]; text: string; first: number } {
    const want = new Set(ids.map(keyOf));
    const out: Id[] = [];
    let text = '';
    let first = -1;
    let pos = 0;
    for (const it of this.items) {
      if (it.del) continue;
      if (want.has(keyOf(it.id))) {
        out.push(it.id);
        text += it.ch;
        if (first < 0) first = pos;
      }
      pos++;
    }
    return { ids: out, text, first };
  }

  /** Visible ranges [from, to) covered by the characters whose keys are in `keys`. */
  rangesOf(keys: Set<string>): { from: number; to: number }[] {
    const out: { from: number; to: number }[] = [];
    let pos = 0;
    for (const it of this.items) {
      if (it.del) continue;
      if (keys.has(keyOf(it.id))) {
        const last = out[out.length - 1];
        if (last && last.to === pos) last.to++;
        else out.push({ from: pos, to: pos + 1 });
      }
      pos++;
    }
    return out;
  }

  /** Visible text split into runs by the site that typed each character. */
  runs(): { site: string; text: string }[] {
    const out: { site: string; text: string }[] = [];
    for (const it of this.items) {
      if (it.del) continue;
      const last = out[out.length - 1];
      if (last && last.site === it.id[0]) last.text += it.ch;
      else out.push({ site: it.id[0], text: it.ch });
    }
    return out;
  }

  /**
   * The document as it was when a replica had state `vector`: characters
   * inserted (and not yet deleted) within that vector. Attributes are the
   * current ones.
   */
  viewAt(vector: Vector): Token[] {
    const has = (id: Id) => (vector[id[0]] ?? 0) >= id[1];
    const out: Token[] = [];
    for (const it of this.items) {
      if (!has(it.id) || (it.del && has(it.del))) continue;
      out.push({ id: it.id, ch: it.ch, attrs: effective(it.attrs) });
    }
    return out;
  }

  /** Inserts and deletes made by `site` after `vector` (for "undo their edits since…"). */
  editsBy(site: string, after: Vector): { inserted: Id[]; deleted: { id: Id; ch: string; attrs: Attrs }[] } {
    const since = after[site] ?? 0;
    const inserted: Id[] = [];
    const deleted: { id: Id; ch: string; attrs: Attrs }[] = [];
    for (const it of this.items) {
      if (it.id[0] === site && it.id[1] > since && !it.del) inserted.push(it.id);
      if (it.del && it.del[0] === site && it.del[1] > since) deleted.push({ id: it.id, ch: it.ch, attrs: effective(it.attrs) });
    }
    return { inserted, deleted };
  }

  /**
   * Every operation this replica knows, in Lamport order. Lamport order is
   * causal (an insert's origin and a delete's target always carry smaller
   * clocks), so replaying this list op by op rebuilds the document's history.
   */
  history(): Op[] {
    const ops = this.missingFor({});
    // Inserts carry no attributes here; the registers' writes are separate ops.
    for (const op of ops) if (op.k === 'i') delete op.a;
    for (const it of this.items) {
      if (!it.attrs) continue;
      for (const [a, r] of it.attrs) if (sameId(r.id, it.id)) ops.push({ k: 'f', id: r.id, t: it.id, a, v: r.v });
    }
    return ops.sort((a, b) => compareIds(a.id, b.id));
  }

  inspect(limit = Infinity): InspectItem[] {
    const out: InspectItem[] = [];
    for (const it of this.items) {
      if (out.length >= limit) break;
      out.push({ key: keyOf(it.id), site: it.id[0], clock: it.id[1], ch: it.ch, deleted: it.del !== null });
    }
    return out;
  }

  // ---------------------------------------------------------------- helpers

  private indexOfItem(item: Item): number {
    if (this.items[this.hint] === item) return this.hint;
    return this.items.indexOf(item);
  }

  /** Index into `items` of the visible character at position `pos`. */
  private visibleIndex(pos: number): number {
    let seen = 0;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].del) continue;
      if (seen === pos) return i;
      seen++;
    }
    throw new RangeError(`no visible character at ${pos}`);
  }
}

function clean(a: Attrs): Attrs {
  const out: Attrs = {};
  for (const [k, v] of Object.entries(a)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

function registers(a: Attrs, id: Id): Map<string, Register> {
  const m = new Map<string, Register>();
  for (const [k, v] of Object.entries(a)) m.set(k, { v, id });
  return m;
}
