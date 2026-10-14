import { keyOf, type Attrs, type Doc, type Id, type Op } from '../../../shared/crdt.ts';

interface Removed {
  ids: Id[];
  tokens: { ch: string; a?: Attrs }[];
}

interface Entry {
  inserted: Id[];
  removed: Removed[];
  formats: { id: Id; attr: string; prev: unknown; next: unknown }[];
  at: number;
}

export interface ChangeRecord {
  ops: Op[];
  removed: Removed[];
  formats: { id: Id; attr: string; prev: unknown; next: unknown }[];
}

/**
 * Selective undo for collaborative editing: undo reverts only *your* last
 * change, as new operations, and leaves everyone else's edits alone (the
 * browser's own undo would happily revert other people's text).
 */
export class UndoStack {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];

  record(change: ChangeRecord): void {
    const inserted = change.ops.filter((o) => o.k === 'i').map((o) => o.id);
    const removed = change.removed.filter((r) => r.ids.length);
    if (!inserted.length && !removed.length && !change.formats.length) return;
    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];
    const first = change.ops.find((o) => o.k === 'i');
    // Typing a word is one undo step, not one step per key.
    const continues =
      last &&
      now - last.at < 1000 &&
      !removed.length &&
      !change.formats.length &&
      !last.removed.length &&
      !last.formats.length &&
      first?.k === 'i' &&
      last.inserted.length > 0 &&
      first.o !== null &&
      keyOf(first.o) === keyOf(last.inserted[last.inserted.length - 1]) &&
      !/\s/.test(first.ch);
    if (continues) {
      last.inserted.push(...inserted);
      last.at = now;
    } else {
      this.undoStack.push({ inserted, removed, formats: change.formats, at: now });
      if (this.undoStack.length > 300) this.undoStack.shift();
    }
    this.redoStack = [];
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo(doc: Doc): { ops: Op[]; caret: number } | null {
    return this.flip(doc, this.undoStack, this.redoStack);
  }

  redo(doc: Doc): { ops: Op[]; caret: number } | null {
    return this.flip(doc, this.redoStack, this.undoStack);
  }

  private flip(doc: Doc, from: Entry[], to: Entry[]): { ops: Op[]; caret: number } | null {
    const e = from.pop();
    if (!e) return null;
    const ops: Op[] = [];
    // Styles back to what they were.
    const formats = e.formats.map((f) => ({ ...f, prev: f.next, next: f.prev }));
    for (const f of e.formats) ops.push(...doc.format([f.id], f.attr, f.prev));
    // Remove what this step inserted (whatever is still visible).
    const live = doc.visibleAmong(e.inserted);
    const liveTokens = live.ids.map((id, i) => ({ ch: live.text[i], a: doc.attrsOf(id) ?? undefined }));
    let caret = live.first >= 0 ? live.first : doc.length;
    ops.push(...doc.deleteIds(live.ids));
    // Bring back what it removed, at the tombstones' position.
    const restored: Id[] = [];
    for (const group of e.removed) {
      if (!group.tokens.length) continue;
      const at = Math.min(doc.locate(group.ids[0])?.pos ?? caret, doc.length);
      const ins = doc.insertTokens(at, group.tokens);
      const newIds = ins.map((o) => o.id);
      restored.push(...newIds);
      ops.push(...ins);
      caret = at + group.tokens.length;
      // The text came back under new ids; older steps must follow it.
      const map = new Map(group.ids.map((id, i) => [keyOf(id), newIds[i]]));
      const remap = (ids: Id[]) => ids.map((id) => map.get(keyOf(id)) ?? id);
      for (const entry of [...from, ...to]) {
        entry.inserted = remap(entry.inserted);
        for (const r of entry.removed) r.ids = remap(r.ids);
        for (const f of entry.formats) f.id = map.get(keyOf(f.id)) ?? f.id;
      }
      for (const f of formats) f.id = map.get(keyOf(f.id)) ?? f.id;
    }
    to.push({
      inserted: restored,
      removed: live.ids.length ? [{ ids: live.ids, tokens: liveTokens }] : [],
      formats,
      at: 0,
    });
    return ops.length ? { ops, caret } : this.flip(doc, from, to);
  }
}
