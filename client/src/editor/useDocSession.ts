import { useEffect, useReducer, useRef, useState } from 'react';
import type { ChatMessage, NotifyTopic } from '../../../shared/protocol.ts';
import { SyncClient, type OpCipher } from '../../../shared/sync-client.ts';
import { ApiError, api, shareTokens, type DocDetails } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { PEER_COLORS, loadIdentity } from '../identity.ts';
import { createCipher, keyFromHash } from '../lib/e2e.ts';
import { loadOffline, lockDoc, removeOffline, saveOffline } from '../lib/offline.ts';
import type { Role } from '../../../shared/protocol.ts';

export interface DocSession {
  client: SyncClient | null;
  meta: DocDetails | null;
  role: Role | null;
  cipher: OpCipher | null;
  /** The end-to-end key from the link, for encrypting uploads. */
  keyText: string | null;
  share: string | null;
  /** Fatal problem: no access, missing key, deleted… */
  fatal: string | null;
  /** Another tab has this document open, so offline saving is off here. */
  secondaryTab: boolean;
  /** Version counters to trigger re-renders. */
  docVersion: number;
  tick: number;
  setMeta(m: DocDetails): void;
  /** Topics announced by the server since mount (consumers refetch). */
  notifyVersion: Record<NotifyTopic, number>;
  chat: ChatMessage[];
  pushChat(m: ChatMessage[]): void;
  saveTitle: string;
}

const colorFor = (id: string) => PEER_COLORS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PEER_COLORS.length];

export function useDocSession(roomId: string): DocSession {
  const { user, ready } = useAuth();
  const [client, setClient] = useState<SyncClient | null>(null);
  const [meta, setMeta] = useState<DocDetails | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [cipher, setCipher] = useState<OpCipher | null>(null);
  const [keyText, setKeyText] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [secondaryTab, setSecondaryTab] = useState(false);
  const [docVersion, bumpDoc] = useReducer((n: number) => n + 1, 0);
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  const [notifyVersion, setNotify] = useState<Record<NotifyTopic, number>>({
    comments: 0,
    suggestions: 0,
    versions: 0,
    meta: 0,
    members: 0,
    locks: 0,
    reactions: 0,
    workflow: 0,
  });
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const titleRef = useRef('Untitled document');

  // Invite links carry ?s=<token>; remember it and tidy the address bar.
  const [share] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('s');
    if (fromUrl) {
      shareTokens.set(roomId, fromUrl);
      params.delete('s');
      const q = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
    }
    return fromUrl ?? shareTokens.get(roomId);
  });

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let sync: SyncClient | null = null;
    let release: (() => void) | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    let discard = false;
    const persist = () => {
      if (!sync || !release || discard) return;
      void saveOffline({ id: roomId, title: titleRef.current, savedAt: Date.now(), state: sync.savedState() });
    };

    (async () => {
      // 1. Metadata (title, owner, encryption) – or the offline copy's title.
      let details: DocDetails | null = null;
      let myRole: Role | null = null;
      let offline = false;
      try {
        const r = await api<{ document: DocDetails | null; role: Role }>(`/docs/${roomId}`, { share });
        details = r.document;
        myRole = r.role;
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) offline = true;
        else {
          if (!cancelled) setFatal(e instanceof ApiError ? e.message : 'Could not open this document.');
          return;
        }
      }
      if (cancelled) return;
      if (details) {
        titleRef.current = details.title;
        setMeta(details);
      }
      setRole(myRole);

      // 2. Encryption key from the link's #fragment.
      const keyText = keyFromHash(window.location.hash);
      let c: OpCipher | null = null;
      if (keyText) c = await createCipher(keyText);
      if (details?.encrypted && !c) {
        setFatal('This document is end-to-end encrypted. Open it with the full link, including the part after “#key=”.');
        return;
      }
      setCipher(c);
      setKeyText(keyText);

      // 3. Resume from the local copy if this tab owns the document's lock.
      release = await lockDoc(roomId);
      if (cancelled) {
        release?.();
        return;
      }
      setSecondaryTab(!release);
      const saved = release ? await loadOffline(roomId) : null;
      if (saved && !details) titleRef.current = saved.title;
      if (offline && !saved) {
        setFatal('You are offline and this document has not been opened on this device before.');
        return;
      }

      const guest = loadIdentity();
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      sync = new SyncClient({
        url: `${proto}://${window.location.host}/ws?room=${encodeURIComponent(roomId)}${share ? `&s=${encodeURIComponent(share)}` : ''}`,
        name: user?.name ?? guest.name,
        color: user ? colorFor(user.id) : guest.color,
        saved: saved?.state,
        cipher: c ?? undefined,
      });
      sync.on((e, payload) => {
        if (e === 'doc') bumpDoc();
        else bump();
        if (e === 'role') {
          setRole(sync!.role);
          if (sync!.encrypted && !c) {
            sync!.disconnect();
            setFatal('This document is end-to-end encrypted. Open it with the full link, including the part after “#key=”.');
          }
        }
        if (e === 'locked') {
          // An edit landed in a section someone else locked: start again from the server's copy.
          discard = true;
          clearTimeout(saveTimer);
          window.alert('That part of the document is locked, so your last change was not saved. The document will reload.');
          void removeOffline(roomId).finally(() => window.location.reload());
          return;
        }
        if (e === 'chat') setChat((m) => [...m, payload as ChatMessage]);
        if (e === 'notify') setNotify((n) => ({ ...n, [payload as NotifyTopic]: n[payload as NotifyTopic] + 1 }));
        if (e === 'doc' || e === 'status') {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(persist, 800);
        }
      });
      sync.connect();
      setClient(sync);
    })();

    return () => {
      cancelled = true;
      clearTimeout(saveTimer);
      persist();
      sync?.disconnect();
      release?.();
      setClient(null);
    };
    // The session is per document; identity changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, ready]);

  useEffect(() => {
    if (client && user && client.name !== user.name) client.setName(user.name);
  }, [client, user]);

  useEffect(() => {
    if (meta) titleRef.current = meta.title;
  }, [meta]);

  // Title changes by the owner arrive as a 'meta' notification.
  useEffect(() => {
    if (!notifyVersion.meta) return;
    api<{ document: DocDetails | null }>(`/docs/${roomId}`, { share })
      .then((r) => r.document && setMeta(r.document))
      .catch(() => {});
  }, [notifyVersion.meta, roomId, share]);

  return {
    client,
    meta,
    role,
    cipher,
    keyText,
    share,
    fatal,
    secondaryTab,
    docVersion,
    tick,
    setMeta,
    notifyVersion,
    chat,
    pushChat: (m) => setChat(m),
    saveTitle: titleRef.current,
  };
}
