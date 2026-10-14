import { useCallback, useEffect, useState } from 'react';
import type { Id } from '../../../shared/crdt.ts';
import { api } from '../api.ts';
export * from './timeline.ts';

import type { Checkpoint } from './timeline.ts';

/** Generic GET that refetches when `version` changes. */
function useFetch<T>(path: string | null, share: string | null, version: number) {
  const [data, setData] = useState<T | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    api<T>(path, { share }).then(
      (d) => alive && setData(d),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [path, share, version, n]);
  return { data, reload: useCallback(() => setN((x) => x + 1), []) };
}

export const useCheckpoints = (docId: string, share: string | null, enabled: boolean, version: number) =>
  useFetch<{ checkpoints: Checkpoint[] }>(enabled ? `/docs/${docId}/checkpoints` : null, share, version);

export interface Lock {
  id: string;
  start: Id;
  end: Id;
  quote: string;
  createdBy: string | null;
  createdName: string;
  createdAt: number;
}
export const useLocks = (docId: string, share: string | null, enabled: boolean, version: number) => useFetch<{ locks: Lock[] }>(enabled ? `/docs/${docId}/locks` : null, share, version);

export interface Reaction {
  target: string;
  emoji: string;
  count: number;
  mine: boolean;
  names: string[];
}
export const useReactions = (docId: string, share: string | null, enabled: boolean, version: number) =>
  useFetch<{ reactions: Reaction[] }>(enabled ? `/docs/${docId}/reactions` : null, share, version);

export interface Workflow {
  status: 'draft' | 'review' | 'approved' | 'changes';
  approvals: { userId: string; name: string; decision: 'approved' | 'changes'; note: string; at: number }[];
}
export const useWorkflow = (docId: string, share: string | null, enabled: boolean, version: number) => useFetch<Workflow>(enabled ? `/docs/${docId}/workflow` : null, share, version);

