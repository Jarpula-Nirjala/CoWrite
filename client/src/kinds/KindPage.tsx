import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { PeerInfo } from '../../../shared/protocol.ts';
import { canEdit as roleCanEdit } from '../../../shared/protocol.ts';
import type { SyncClient } from '../../../shared/sync-client.ts';
import type { Brand as BrandKit } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { Brand } from '../components/Brand.tsx';
import type { RemoteCursor } from '../components/CollabEditor.tsx';
import { Icon, Spinner } from '../components/ui.tsx';
import { DocHeader } from '../editor/DocHeader.tsx';
import { ChatPanel } from '../editor/panels.tsx';
import { ShareDialog } from '../editor/share.tsx';
import { loadChatHistory, usePeople } from '../editor/useCollab.ts';
import type { DocSession } from '../editor/useDocSession.ts';
import { useFiles } from '../editor/useFiles.ts';
import { pendingContent } from '../lib/templates.ts';
import { Link } from '../router.ts';
import { CallButton, CallDock, useCall } from '../editor/call.tsx';
import { useObjApi, type ObjApi } from './api.ts';

const SlidesEditor = lazy(() => import('./slides/SlidesEditor.tsx'));
const BoardEditor = lazy(() => import('./board/BoardEditor.tsx'));
const KanbanEditor = lazy(() => import('./kanban/KanbanEditor.tsx'));
const SheetEditor = lazy(() => import('./sheet/SheetEditor.tsx'));

/** Everything a slides/board/kanban/sheet editor gets from the page. */
export interface KindProps {
  api: ObjApi;
  client: SyncClient;
  roomId: string;
  share: string | null;
  title: string;
  canEdit: boolean;
  aiEnabled: boolean;
  me: { id: string | null; name: string; color: string };
  peers: PeerInfo[];
  /** Peer the user follows (their focus is shown). */
  follow: string | null;
  resolve(src: string): Promise<string>;
  upload(file: Blob, name: string): Promise<{ src: string; name: string; size: number; mime: string }>;
  flash(msg: string): void;
  brand: BrandKit | null;
}

export function KindPage({ roomId, s }: { roomId: string; s: DocSession }) {
  const { user, providers } = useAuth();
  const { client, meta, role, share, cipher } = s;
  const { resolve, upload } = useFiles(roomId, s.keyText);
  const [shareOpen, setShareOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [follow, setFollow] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const people = usePeople(roomId, share);
  const call = useCall(client);
  const online = client?.status === 'online';
  const title = meta?.title ?? 'Untitled';

  useEffect(() => {
    document.title = `${title} · CoWrite`;
  }, [title]);

  useEffect(() => {
    if (!client || !online) return;
    loadChatHistory(roomId, share, cipher)
      .then((history) => {
        const seen = new Set(s.chat.map((m) => m.id));
        s.pushChat([...history.filter((m) => !seen.has(m.id)), ...s.chat].sort((a, b) => a.createdAt - b.createdAt));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, online === true]);

  // Templates: objects to create when a new document first opens.
  useEffect(() => {
    if (!client || !online || !roleCanEdit(role)) return;
    const initial = pendingContent.take(roomId);
    if (!initial?.objects?.length || client.doc.objectsWith('').length > 0) return;
    const ops = initial.objects.flatMap((o) => client.doc.setFields(o.key, o.fields));
    if (initial.settings) ops.push(...client.doc.setFields('settings', initial.settings as Record<string, unknown>));
    client.edit(ops);
  }, [client, online, role, roomId]);

  const cursors: RemoteCursor[] = useMemo(() => (client ? ([...client.peers.values()] as unknown as RemoteCursor[]) : []), [client, s.tick]);

  if (s.fatal) {
    return (
      <div className="page center-page">
        <div className="panel narrow-card">
          <Brand />
          <h1>Cannot open this document</h1>
          <p>{s.fatal}</p>
          <Link className="btn btn-primary" to={user ? '/documents' : '/'}>
            {user ? 'My documents' : 'Home'}
          </Link>
        </div>
      </div>
    );
  }
  if (!client) return <Spinner label="Opening…" />;

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  };
  const unread = 0;

  return (
    <div className={`doc-page kind-page kind-${meta?.kind ?? 'doc'}`}>
      <DocHeader
        roomId={roomId}
        meta={meta}
        role={role}
        client={client}
        cursors={cursors}
        follow={follow}
        setFollow={setFollow}
        user={user}
        onShare={() => setShareOpen(true)}
        onMeta={s.setMeta}
        onError={flash}
        extra={
          <>
          <CallButton call={call} onError={(m) => setToast(m)} />
          <button className={`btn btn-ghost btn-sm ${chatOpen ? 'active' : ''}`} onClick={() => setChatOpen((o) => !o)} type="button" aria-pressed={chatOpen}>
            <Icon name="chat" size={15} /> Chat{unread ? ` (${unread})` : ''}
          </button>
          </>
        }
      />
      <div className="kind-body">
        <main className="kind-main">
          <Suspense fallback={<Spinner label="Loading editor…" />}>
            <KindEditor
              kind={meta?.kind ?? 'doc'}
              client={client}
              version={s.docVersion}
              props={{
                roomId,
                share,
                title,
                canEdit: roleCanEdit(role),
                aiEnabled: providers.ai,
                me: { id: user?.id ?? null, name: user?.name ?? client.name, color: client.color },
                peers: [...client.peers.values()],
                follow,
                resolve,
                upload,
                flash,
                brand: user?.brand ?? null,
              }}
            />
          </Suspense>
        </main>
        {chatOpen && (
          <aside className="kind-side">
            <header className="panel-head">
              <h2>Chat</h2>
              <button className="modal-close" onClick={() => setChatOpen(false)} aria-label="Close chat" type="button">
                ×
              </button>
            </header>
            <ChatPanel messages={s.chat} onSend={(b) => client.sendChat(b)} canChat={online} people={people} myName={user?.name ?? client.name} />
          </aside>
        )}
      </div>
      <CallDock call={call} client={client} />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {shareOpen && <ShareDialog docId={roomId} meta={meta} role={role} share={share} onClose={() => setShareOpen(false)} onMetaChange={s.setMeta} />}
    </div>
  );
}

function KindEditor({ kind, client, version, props }: { kind: string; client: SyncClient; version: number; props: Omit<KindProps, 'api' | 'client'> }) {
  const api = useObjApi(client, version, !props.canEdit);
  const all = { ...props, api, client };
  if (kind === 'slides') return <SlidesEditor {...all} />;
  if (kind === 'board') return <BoardEditor {...all} />;
  if (kind === 'kanban') return <KanbanEditor {...all} />;
  if (kind === 'sheet') return <SheetEditor {...all} />;
  return <p className="muted">This document type is not supported here.</p>;
}
