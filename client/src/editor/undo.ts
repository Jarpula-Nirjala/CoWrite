import { keyOf, type Doc, type Id, type Op } from '../../../shared/crdt.ts';

interface Entry {
  inserted: Id[];
  removed: { ids: Id[]; text: string } | null;
  at: number;
}

/**
 * Selective undo for collaborative editing: undo reverts only *your* last
 * change, as new operations, and leaves everyone else's edits alone (the
 * browser's own textarea undo would happily revert other people's text).
 */
export class UndoStack {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];

  record(ops: Op[], removedText: string): void {
    const inserted: Id[] = [];
    const removedIds: Id[] = [];
    for (const op of ops) {
      if (op.k === 'i') inserted.push(op.id);
      else removedIds.push(op.t);
    }
    if (!inserted.length && !removedIds.length) return;
    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];
    // Typing a word is one undo step, not one step per key.
    const firstInsert = ops.find((o) => o.k === 'i');
    if (
      last &&
      now - last.at < 1000 &&
      !removedIds.length &&
      !last.removed &&
      firstInsert?.k === 'i' &&
      last.inserted.length &&
      firstInsert.o?.[0] === last.inserted[last.inserted.length - 1][0] &&
      firstInsert.o?.[1] === last.inserted[last.inserted.length - 1][1] &&
      !/\s/.test(firstInsert.ch)
    ) {
      last.inserted.push(...inserted);
      last.at = now;
    } else {
      this.undoStack.push({ inserted, removed: removedIds.length ? { ids: removedIds, text: removedText } : null, at: now });
      if (this.undoStack.length > 200) this.undoStack.shift();
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
    // Remove what this step inserted (whatever is still visible).
    const live = doc.visibleAmong(e.inserted);
    let caret = live.first >= 0 ? live.first : doc.length;
    ops.push(...doc.deleteIds(live.ids));
    // Bring back what it removed, at the tombstones' position.
    let restored: Id[] = [];
    if (e.removed?.text) {
      const at = doc.locate(e.removed.ids[0])?.pos ?? caret;
      const ins = doc.insert(Math.min(at, doc.length), e.removed.text);
      restored = ins.map((o) => o.id);
      ops.push(...ins);
      caret = at + e.removed.text.length;
      // The text came back under new ids; older steps must follow it.
      const map = new Map(e.removed.ids.map((id, i) => [keyOf(id), restored[i]]));
      const remap = (ids: Id[]) => ids.map((id) => map.get(keyOf(id)) ?? id);
      for (const entry of [...from, ...to]) {
        entry.inserted = remap(entry.inserted);
        if (entry.removed) entry.removed.ids = remap(entry.removed.ids);
      }
    }
    to.push({ inserted: restored, removed: live.ids.length ? { ids: live.ids, text: live.text } : null, at: 0 });
    return ops.length ? { ops, caret } : this.flip(doc, from, to);
  }
}
