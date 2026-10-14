import { useCallback, useMemo, useReducer, useRef } from 'react';
import type { Attrs, Doc, Op } from '../../../shared/crdt.ts';
import type { SyncClient } from '../../../shared/sync-client.ts';

type Inverse = Map<string, Attrs>;

/**
 * Object edits for the canvas-style editors (slides, board, kanban, sheet):
 * every change is applied locally, sent to the room and recorded for undo.
 */
export interface ObjApi {
  doc: Doc;
  /** Bumps whenever the document changes (local or remote). */
  version: number;
  set(key: string, fields: Attrs): void;
  remove(key: string): void;
  /** Group several edits (e.g. a whole drag) into one undo step. */
  group<T>(fn: () => T): T;
  begin(): void;
  end(): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useObjApi(client: SyncClient, remoteVersion: number, readOnly: boolean): ObjApi {
  const [local, bump] = useReducer((n: number) => n + 1, 0);
  const undoStack = useRef<Inverse[]>([]);
  const redoStack = useRef<Inverse[]>([]);
  const open = useRef<{ depth: number; inv: Inverse | null }>({ depth: 0, inv: null });
  const doc = client.doc;

  const write = useCallback(
    (key: string, fields: Attrs, inv: Inverse | null) => {
      const prev = doc.getObject(key);
      if (inv) {
        let rec = inv.get(key);
        if (!rec) inv.set(key, (rec = {}));
        for (const f of Object.keys(fields)) {
          if (f in rec) continue;
          if (f === '_del') rec._del = prev ? null : true;
          else rec[f] = prev ? (prev[f] ?? null) : null;
        }
        if (!prev && !('_del' in rec)) rec._del = true;
      }
      const ops: Op[] = doc.setFields(key, fields);
      client.edit(ops);
    },
    [client, doc],
  );

  const begin = useCallback(() => {
    const o = open.current;
    if (o.depth++ === 0) o.inv = new Map();
  }, []);
  const end = useCallback(() => {
    const o = open.current;
    if (o.depth === 0) return;
    if (--o.depth === 0) {
      if (o.inv?.size) {
        undoStack.current.push(o.inv);
        if (undoStack.current.length > 200) undoStack.current.shift();
        redoStack.current = [];
      }
      o.inv = null;
      bump();
    }
  }, []);

  const set = useCallback(
    (key: string, fields: Attrs) => {
      if (readOnly) return;
      const grouped = open.current.depth > 0;
      if (!grouped) begin();
      write(key, fields, open.current.inv);
      if (!grouped) end();
      else bump();
    },
    [readOnly, begin, end, write],
  );

  const group = useCallback(
    <T,>(fn: () => T): T => {
      begin();
      try {
        return fn();
      } finally {
        end();
      }
    },
    [begin, end],
  );

  const replay = useCallback(
    (from: { current: Inverse[] }, to: { current: Inverse[] }) => {
      const inv = from.current.pop();
      if (!inv) return;
      const back: Inverse = new Map();
      for (const [key, fields] of inv) write(key, fields, back);
      to.current.push(back);
      bump();
    },
    [write],
  );

  const version = remoteVersion + local;
  return useMemo(
    () => ({
      doc,
      version,
      set,
      remove: (key: string) => set(key, { _del: true }),
      group,
      begin,
      end,
      undo: () => replay(undoStack, redoStack),
      redo: () => replay(redoStack, undoStack),
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
    }),
    [doc, version, set, group, begin, end, replay],
  );
}

/** Calls `fn` at most every `ms` milliseconds, always running the last call. */
export function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | null = null;
  const run = () => {
    last = Date.now();
    timer = undefined;
    if (pending) {
      const a = pending;
      pending = null;
      fn(...a);
    }
  };
  const call = (...a: A) => {
    pending = a;
    if (timer) return;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) run();
    else timer = setTimeout(run, wait);
  };
  call.flush = () => {
    clearTimeout(timer);
    run();
  };
  return call;
}
