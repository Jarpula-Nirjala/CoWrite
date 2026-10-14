import { useCallback, useEffect, useRef, useState } from 'react';
import { keyOf, parseKey, type Doc, type Id, type Op } from '../../../shared/crdt.ts';
import type { ChatMessage } from '../../../shared/protocol.ts';
import type { OpCipher } from '../../../shared/sync-client.ts';
import { api, type Author, type Comment, type Person, type Suggestion, type Version } from '../api.ts';

const decryptAll = async <T,>(items: T[], cipher: OpCipher | null, fields: (keyof T)[]): Promise<T[]> => {
  if (!cipher) return items;
  return Promise.all(
    items.map(async (it) => {
      const copy = { ...it };
      for (const f of fields) {
        const v = copy[f];
        if (typeof v === 'string' && v) (copy[f] as unknown) = await cipher.decryptText(v).catch(() => '[could not decrypt]');
      }
      return copy;
    }),
  );
};

/** Fetches `path` now and whenever `version` changes. */
function useResource<T>(path: string | null, share: string | null, version: number, map?: (v: T) => Promise<T> | T) {
  const [data, setData] = useState<T | null>(null);
  const mapRef = useRef(map);
  mapRef.current = map;
  const load = useCallback(() => {
    if (!path) return;
    api<T>(path, { share })
      .then(async (v) => setData(mapRef.current ? await mapRef.current(v) : v))
      .catch(() => {});
  }, [path, share]);
  useEffect(load, [load, version]);
  return { data, reload: load };
}

// ------------------------------------------------------------------ comments

export function useComments(docId: string, share: string | null, cipher: OpCipher | null, version: number) {
  const { data, reload } = useResource<{ comments: Comment[] }>(`/docs/${docId}/comments`, share, version, async (v) => ({
    comments: await decryptAll(v.comments, cipher, ['body', 'quote']),
  }));
  const seal = useCallback((t: string) => (cipher ? cipher.encryptText(t) : Promise.resolve(t)), [cipher]);

  const add = useCallback(
    async (input: { anchorStart?: Id; anchorEnd?: Id; quote?: string; body: string; parentId?: string; mentions: string[]; name: string; color: string }) => {
      await api(`/docs/${docId}/comments`, {
        method: 'POST',
        share,
        body: { ...input, body: await seal(input.body), quote: input.quote ? await seal(input.quote) : '' },
      });
      reload();
    },
    [docId, share, seal, reload],
  );
  const update = useCallback(
    async (id: string, patch: { resolved?: boolean; body?: string }) => {
      await api(`/docs/${docId}/comments/${id}`, { method: 'PATCH', share, body: patch.body ? { ...patch, body: await seal(patch.body) } : patch });
      reload();
    },
    [docId, share, seal, reload],
  );
  const remove = useCallback(
    async (id: string) => {
      await api(`/docs/${docId}/comments/${id}`, { method: 'DELETE', share });
      reload();
    },
    [docId, share, reload],
  );
  return { comments: data?.comments ?? [], add, update, remove };
}

// --------------------------------------------------------------- suggestions

interface Pending {
  id: string | null;
  keys: string[];
  unsent: string[];
  lastKey: string | null;
  at: number;
}

/**
 * Suggestion mode: insertions are typed into the document but tagged as
 * suggestions; deletions are only marked. The owner accepts or rejects them.
 */
export function useSuggestions(docId: string, share: string | null, version: number, author: { name: string; color: string; userId: string | null }) {
  const { data, reload } = useResource<{ suggestions: Suggestion[] }>(`/docs/${docId}/suggestions`, share, version);
  const pending = useRef<{ insert: Pending | null; delete: Pending | null }>({ insert: null, delete: null });
  const mine = useRef(new Set<string>());
  const [localTick, setLocalTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(async () => {
    for (const kind of ['insert', 'delete'] as const) {
      const p = pending.current[kind];
      if (!p || !p.unsent.length) continue;
      const batch = p.unsent;
      p.unsent = [];
      try {
        if (!p.id) {
          const r = await api<{ suggestion: Suggestion }>(`/docs/${docId}/suggestions`, {
            method: 'POST',
            share,
            body: { kind, keys: batch, name: author.name, color: author.color },
          });
          p.id = r.suggestion.id;
          mine.current.add(p.id);
        } else {
          await api(`/docs/${docId}/suggestions/${p.id}`, { method: 'PATCH', share, body: { addKeys: batch } });
        }
      } catch {
        p.unsent.unshift(...batch);
      }
    }
    reload();
  }, [docId, share, author.name, author.color, reload]);

  const schedule = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 600);
    setLocalTick((t) => t + 1);
  };

  const track = (kind: 'insert' | 'delete', keys: string[], continues: boolean) => {
    if (!keys.length) return;
    const now = Date.now();
    let p = pending.current[kind];
    // A new burst (pause or jump elsewhere) starts a new suggestion.
    if (!p || now - p.at > 4000 || !continues) {
      if (p?.unsent.length) void flush();
      p = { id: null, keys: [], unsent: [], lastKey: null, at: now };
      pending.current[kind] = p;
    }
    p.keys.push(...keys);
    p.unsent.push(...keys);
    p.lastKey = keys[keys.length - 1];
    p.at = now;
    schedule();
  };

  const all: Suggestion[] = data?.suggestions ?? [];
  /** Keys of insert-suggestions authored here (deleting them deletes for real). */
  const ownInsertKeys = () => {
    const s = new Set<string>(pending.current.insert?.keys ?? []);
    for (const sg of all) {
      const isMine = mine.current.has(sg.id) || (author.userId !== null && sg.authorId === author.userId);
      if (sg.kind === 'insert' && isMine) for (const k of sg.keys) s.add(k);
    }
    return s;
  };

  /** Suggestion mode: only your own suggested text is really deleted. */
  const filterDelete = (ids: Id[]) => {
    const own = ownInsertKeys();
    return ids.filter((id) => own.has(keyOf(id)));
  };

  /** Records what a suggestion-mode change inserted and marked for deletion. */
  const trackChange = (inserted: Op[], marked: Id[]) => {
    if (marked.length) track('delete', marked.map(keyOf), true);
    const ins = inserted.filter((o): o is Extract<Op, { k: 'i' }> => o.k === 'i');
    if (ins.length) {
      const first = ins[0];
      const continues = first.o !== null && pending.current.insert?.lastKey === keyOf(first.o);
      track('insert', ins.map((o) => keyOf(o.id)), continues);
    }
  };

  /** Accept or reject; returns the ops to send (may be empty). */
  const resolve = async (doc: Doc, s: Suggestion, accept: boolean): Promise<Op[]> => {
    const ids: Id[] = s.keys.map(parseKey);
    const removeText = (s.kind === 'insert' && !accept) || (s.kind === 'delete' && accept);
    const ops = removeText ? doc.deleteIds(ids) : [];
    await api(`/docs/${docId}/suggestions/${s.id}`, { method: 'PATCH', share, body: { status: accept ? 'accepted' : 'rejected' } });
    reload();
    return ops;
  };

  // Include unsent local suggestions so they show immediately.
  const local: Suggestion[] = [];
  for (const kind of ['insert', 'delete'] as const) {
    const p = pending.current[kind];
    if (p && !p.id && p.keys.length) {
      local.push({ id: `local-${kind}`, kind, keys: p.keys, authorId: null, authorName: author.name, color: author.color, status: 'open', createdAt: p.at });
    }
  }
  const merged = all.map((s) => {
    const p = pending.current[s.kind];
    return p?.id === s.id ? { ...s, keys: [...new Set([...s.keys, ...p.keys])] } : s;
  });

  useEffect(() => () => clearTimeout(timer.current), []);
  return { suggestions: [...merged, ...local], filterDelete, trackChange, resolve, localTick };
}

// ------------------------------------------------------------------ the rest

export function useVersions(docId: string, share: string | null, version: number) {
  const { data, reload } = useResource<{ versions: Version[] }>(`/docs/${docId}/versions`, share, version);
  return { versions: data?.versions ?? [], reload };
}

export function useAuthors(docId: string, share: string | null, version: number) {
  const { data } = useResource<{ authors: Author[] }>(`/docs/${docId}/authors`, share, version);
  return data?.authors ?? [];
}

export function usePeople(docId: string, share: string | null) {
  const { data } = useResource<{ people: Person[] }>(`/docs/${docId}/people`, share, 0);
  return data?.people ?? [];
}

export async function loadChatHistory(docId: string, share: string | null, cipher: OpCipher | null): Promise<ChatMessage[]> {
  const r = await api<{ messages: ChatMessage[] }>(`/docs/${docId}/messages`, { share });
  return decryptAll(r.messages, cipher, ['body']);
}
