import type { ReactNode } from 'react';
import type { Role } from '../../../shared/protocol.ts';
import type { SyncClient } from '../../../shared/sync-client.ts';
import { api, errorText, type DocDetails, type User } from '../api.ts';
import { Brand } from '../components/Brand.tsx';
import type { RemoteCursor } from '../components/CollabEditor.tsx';
import { NotificationBell, UserMenu } from '../components/SiteHeader.tsx';
import { Avatar, Icon } from '../components/ui.tsx';
import { Link } from '../router.ts';

const STATUS_TEXT = { online: 'Saved', connecting: 'Connecting…', offline: 'Offline' } as const;
const KIND_LABEL: Record<string, string> = { slides: 'Slides', board: 'Whiteboard', kanban: 'Kanban', sheet: 'Sheet' };

/** The top bar shared by every document type. */
export function DocHeader(props: {
  roomId: string;
  meta: DocDetails | null;
  role: Role | null;
  client: SyncClient;
  cursors: RemoteCursor[];
  follow: string | null;
  setFollow(site: string | null): void;
  user: User | null;
  onShare(): void;
  onMeta(m: DocDetails): void;
  onError(msg: string): void;
  extra?: ReactNode;
}) {
  const { meta, role, client, cursors, follow, setFollow, user } = props;
  const title = meta?.title ?? 'Untitled document';
  const status = client.status === 'online' && client.pending > 0 ? 'Saving…' : STATUS_TEXT[client.status];
  return (
    <header className="doc-header">
      <div className="doc-header-left">
        <Brand compact />
        <div className="doc-title-block">
          {meta && role === 'owner' ? (
            <input
              className="doc-title-input"
              defaultValue={meta.title}
              key={meta.title}
              maxLength={120}
              onBlur={async (e) => {
                const t = e.target.value.trim() || 'Untitled document';
                if (t === meta.title) return;
                try {
                  const r = await api<{ document: DocDetails }>(`/docs/${props.roomId}`, { method: 'PATCH', body: { title: t } });
                  props.onMeta({ ...meta, title: r.document.title });
                } catch (err) {
                  props.onError(errorText(err));
                }
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-label="Document title"
            />
          ) : (
            <span className="doc-title">{title}</span>
          )}
          <span className="doc-sub">
            {meta?.kind && meta.kind !== 'doc' && <span className="pill">{KIND_LABEL[meta.kind]}</span>}
            {meta?.encrypted && (
              <span className="pill pill-lock">
                <Icon name="lock" size={12} /> End-to-end encrypted
              </span>
            )}
            {meta?.translatedFrom && <span className="pill">Live translation · {meta.lang}</span>}
            {meta?.status && meta.status !== 'draft' && <span className={`pill status-${meta.status}`}>{meta.status === 'review' ? 'In review' : meta.status === 'approved' ? 'Approved' : 'Changes requested'}</span>}
            {role && role !== 'owner' && role !== 'editor' && <span className="pill">{role === 'viewer' ? 'View only' : 'Can comment'}</span>}
            {meta?.parentId && (
              <span className="pill">
                <Icon name="branch" size={12} /> Fork
              </span>
            )}
            <span className="muted small">{meta ? (role === 'owner' ? 'Owned by you' : `Owned by ${meta.ownerName}`) : 'Guest document · anyone with the link can edit'}</span>
            {user && (
              <Link className="small" to="/documents">
                My documents
              </Link>
            )}
          </span>
        </div>
      </div>
      <div className="doc-header-right">
        {props.extra}
        <div className="presence" aria-label={`${cursors.length + 1} people here`}>
          {cursors.slice(0, 5).map((p) => {
            const peer = client.peers.get(p.site);
            return (
              <button
                key={p.site}
                className={`presence-btn ${follow === p.site ? 'following' : ''} state-${peer?.state ?? 'active'}`}
                onClick={() => setFollow(follow === p.site ? null : p.site)}
                title={`${p.name}${peer?.typing ? ' (typing…)' : peer?.state === 'away' ? ' (away)' : peer?.state === 'idle' ? ' (idle)' : ''}${peer?.ext?.inCall ? ' · in call' : ''} · click to follow`}
                type="button"
              >
                <Avatar name={p.name} color={p.color} size={30} />
                {peer?.typing && <span className="typing-dot" />}
                {peer?.ext?.inCall && <span className="call-dot" />}
              </button>
            );
          })}
          {cursors.length > 5 && <span className="avatar more">+{cursors.length - 5}</span>}
        </div>
        <span className={`status-pill ${client.status}`} role="status">
          <span className="dot" />
          {status}
          {client.status !== 'online' && client.pending > 0 && <span className="pending"> · {client.pending} unsynced</span>}
        </span>
        <button className="btn btn-primary btn-sm" onClick={props.onShare} type="button">
          <Icon name="share" size={15} /> Share
        </button>
        <NotificationBell />
        {user ? (
          <UserMenu />
        ) : (
          <Link className="btn btn-outline btn-sm" to={`/signin?next=${encodeURIComponent(window.location.pathname + window.location.hash)}`}>
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
