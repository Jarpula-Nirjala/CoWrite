import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { Op } from '../../../shared/crdt.ts';
import type { Selection } from '../../../shared/protocol.ts';
import { SyncClient } from '../../../shared/sync-client.ts';
import { CollabEditor } from '../components/CollabEditor.tsx';
import { initials, loadIdentity, saveIdentity } from '../identity.ts';
import { Brand } from '../components/Brand.tsx';

const STATUS_TEXT = { online: 'Online', connecting: 'Connecting…', offline: 'Offline' } as const;

export function DocPage({ roomId }: { roomId: string }) {
  const [identity] = useState(loadIdentity);
  const client = useMemo(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return new SyncClient({
      url: `${proto}://${window.location.host}/ws?room=${encodeURIComponent(roomId)}`,
      name: identity.name,
      color: identity.color,
    });
  }, [roomId, identity]);

  const [version, bumpVersion] = useReducer((n: number) => n + 1, 0);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [manualOffline, setManualOffline] = useState(false);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(identity.name);

  useEffect(() => {
    const off = client.on((e) => (e === 'doc' ? bumpVersion() : rerender()));
    client.connect();
    return () => {
      off();
      client.disconnect();
    };
  }, [client]);

  useEffect(() => {
    document.title = `${roomId} · CoWrite`;
    return () => {
      document.title = 'CoWrite: real-time collaborative editor';
    };
  }, [roomId]);

  const onLocalOps = useCallback((ops: Op[]) => client.edit(ops), [client]);
  const onSelection = useCallback((sel: Selection) => client.setSelection(sel), [client]);

  const toggleOffline = () => {
    if (manualOffline) client.connect();
    else client.disconnect();
    setManualOffline(!manualOffline);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this link', window.location.href);
    }
  };

  const commitName = () => {
    const clean = name.trim().slice(0, 40) || identity.name;
    setName(clean);
    saveIdentity(clean, identity.color);
    client.setName(clean);
  };

  const peers = [...client.peers.values()];
  const text = client.doc.text();
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="docpage">
      <header className="topbar doc-topbar">
        <Brand />
        <span className="doc-id" title="Document id">
          {roomId}
        </span>
        <div className="spacer" />
        <div className="presence" aria-label={`${peers.length + 1} people here`}>
          {peers.slice(0, 5).map((p) => (
            <span key={p.site} className="avatar" style={{ background: p.color }} title={p.name}>
              {initials(p.name)}
            </span>
          ))}
          {peers.length > 5 && <span className="avatar more">+{peers.length - 5}</span>}
          <span className="avatar me" style={{ background: identity.color }} title={`${name} (you)`}>
            {initials(name)}
          </span>
        </div>
        <span className={`status-pill ${client.status}`} role="status">
          <span className="dot" />
          {STATUS_TEXT[client.status]}
          {client.pending > 0 && <span className="pending"> · {client.pending} unsynced</span>}
        </span>
        <button className="btn small" onClick={copyLink} type="button">
          {copied ? 'Link copied' : 'Share link'}
        </button>
      </header>

      {client.error && <div className="banner error">{client.error}</div>}

      <main className="paper-wrap">
        <div className="toolbar">
          <label className="name-field">
            <span className="muted small">You are</span>
            <input
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-label="Your display name"
            />
          </label>
          <label className="switch" title="Simulate losing your connection. Keep typing, then reconnect.">
            <input type="checkbox" checked={manualOffline} onChange={toggleOffline} />
            <span>Simulate offline</span>
          </label>
        </div>
        <article className="paper">
          <CollabEditor
            doc={client.doc}
            version={version}
            cursors={peers}
            onLocalOps={onLocalOps}
            onSelection={onSelection}
            placeholder="Start typing… then open this link in another tab or on your phone."
            label="Document text"
            minRows={18}
          />
        </article>
        <p className="doc-stats muted small">
          {words} words · {client.doc.length} characters · {client.doc.size - client.doc.length} tombstones · site id{' '}
          <code>{client.doc.site}</code>
        </p>
      </main>
    </div>
  );
}
