import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { SyncClient } from '../../../shared/sync-client.ts';
import { Icon } from '../components/ui.tsx';
import { CallManager, PeerMesh } from './rtc.ts';

function Video({ stream, muted, name, color, off }: { stream: MediaStream; muted?: boolean; name: string; color: string; off?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  const hasVideo = stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live') && !off;
  return (
    <figure className="call-tile" style={{ '--peer': color } as React.CSSProperties}>
      <video ref={ref} autoPlay playsInline muted={muted} style={{ display: hasVideo ? 'block' : 'none' }} />
      {!hasVideo && <span className="call-avatar">{name.slice(0, 1).toUpperCase()}</span>}
      <figcaption>{name}</figcaption>
    </figure>
  );
}

/** Join button plus the floating call window with everyone's video. */
export function useCall(client: SyncClient | null) {
  const call = useMemo(() => (client ? new CallManager(client) : null), [client]);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!call) return;
    const off = call.onChange(bump);
    return () => {
      off();
      if (call.active) call.leave();
    };
  }, [call]);
  return call;
}

export function CallButton({ call, onError }: { call: CallManager | null; onError(msg: string): void }) {
  if (!call) return null;
  if (call.active) return null;
  return (
    <span className="call-buttons">
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => call.join(false).catch((e) => onError(`Could not start the microphone: ${(e as Error).message}`))}
        title="Join a voice call with everyone in this document"
        type="button"
      >
        <Icon name="phone" size={15} />
      </button>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => call.join(true).catch((e) => onError(`Could not start the camera: ${(e as Error).message}`))}
        title="Join a video call with everyone in this document"
        type="button"
      >
        <Icon name="video" size={15} />
      </button>
    </span>
  );
}

export function CallDock({ call, client }: { call: CallManager | null; client: SyncClient | null }) {
  const [small, setSmall] = useState(false);
  if (!call?.active || !client) return null;
  const inCall = [...client.peers.values()].filter((p) => p.ext?.inCall);
  return (
    <div className={`call-dock ${small ? 'small' : ''}`} role="region" aria-label="Call">
      <header>
        <span>
          <span className="live-dot" /> In call · {inCall.length + 1}
        </span>
        <button className="link-btn" onClick={() => setSmall(!small)} aria-label={small ? 'Expand' : 'Minimise'} type="button">
          {small ? '▢' : '–'}
        </button>
      </header>
      <div className="call-grid">
        {call.local && <Video stream={call.local} muted name={`${client.name} (you)`} color={client.color} off={call.cameraOff} />}
        {inCall.map((p) => {
          const s = call.remotes.get(p.site);
          return s ? (
            <Video key={p.site} stream={s} name={p.name} color={p.color} />
          ) : (
            <figure key={p.site} className="call-tile connecting" style={{ '--peer': p.color } as React.CSSProperties}>
              <span className="call-avatar">{p.name.slice(0, 1).toUpperCase()}</span>
              <figcaption>{p.name} · connecting…</figcaption>
            </figure>
          );
        })}
      </div>
      {!inCall.length && <p className="small muted call-hint">Waiting for others. Anyone in this document can join with the phone or camera button.</p>}
      <div className="call-controls">
        <button className={`call-ctl ${call.muted ? 'off' : ''}`} onClick={() => call.toggleMute()} title={call.muted ? 'Unmute' : 'Mute'} type="button">
          <Icon name="mic" size={16} /> {call.muted ? 'Unmute' : 'Mute'}
        </button>
        <button className={`call-ctl ${call.cameraOff ? 'off' : ''}`} onClick={() => void call.toggleCamera()} title="Camera" type="button">
          <Icon name="video" size={16} /> {call.cameraOff ? 'Camera on' : 'Camera off'}
        </button>
        <button className="call-ctl leave" onClick={() => call.leave()} type="button">
          Leave
        </button>
      </div>
    </div>
  );
}

const P2P_KEY = 'cowrite:p2p';

/** The page-level peer-to-peer mesh (kept alive while the document is open). */
export function usePeerMesh(client: SyncClient | null, canEdit: boolean) {
  const [enabled, setEnabledState] = useState(() => {
    try {
      return localStorage.getItem(P2P_KEY) === '1';
    } catch {
      return false;
    }
  });
  const mesh = useMemo(() => (enabled && canEdit && client ? new PeerMesh(client) : null), [enabled, canEdit, client]);
  useEffect(() => () => mesh?.close(), [mesh]);
  const setEnabled = (on: boolean) => {
    setEnabledState(on);
    try {
      localStorage.setItem(P2P_KEY, on ? '1' : '0');
    } catch {
      // ignore
    }
  };
  return { mesh, enabled, setEnabled };
}

/** Peer-to-peer section of the Network panel. */
export function P2PSection({ p2p, canEdit }: { p2p: ReturnType<typeof usePeerMesh>; canEdit: boolean }) {
  const { mesh, enabled, setEnabled } = p2p;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [invite, setInvite] = useState<{ code: string; accept(a: string): Promise<void> } | null>(null);
  const [reply, setReply] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mesh) return;
    const off = mesh.onChange(bump);
    const t = setInterval(bump, 1500);
    return () => {
      off();
      clearInterval(t);
    };
  }, [mesh]);

  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

  return (
    <section className="p2p">
      <h4>Peer-to-peer sync (WebRTC)</h4>
      <p className="small muted">Edits go straight from browser to browser over an encrypted WebRTC channel. If the server goes down, people on the same network keep editing together, and everything reaches the server when it is back.</p>
      <label className="check-row">
        <input type="checkbox" checked={enabled} disabled={!canEdit} onChange={(e) => setEnabled(e.target.checked)} /> Connect directly to other editors
      </label>
      {mesh && (
        <>
          <p className="small">
            <strong>{mesh.open.length}</strong> direct connection{mesh.open.length === 1 ? '' : 's'} · {mesh.sent} edits sent · {mesh.received} received peer-to-peer
          </p>
          <details className="p2p-manual">
            <summary>No server? Pair two devices with codes</summary>
            <ol className="small">
              <li>
                On this device:{' '}
                <button
                  className="btn btn-outline btn-sm"
                  onClick={async () => {
                    setError(null);
                    try {
                      setInvite(await mesh.createInvite());
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                  type="button"
                >
                  Create invite code
                </button>
              </li>
              {invite && (
                <li>
                  Send this code to the other device:
                  <textarea className="input code" readOnly value={invite.code} rows={3} onFocus={(e) => e.currentTarget.select()} />
                  <button className="btn btn-text btn-sm" onClick={() => copy(invite.code)} type="button">
                    Copy
                  </button>
                  <br />
                  Paste their reply code:
                  <textarea className="input code" value={reply} onChange={(e) => setReply(e.target.value)} rows={2} />
                  <button className="btn btn-primary btn-sm" disabled={!reply.trim()} onClick={() => void invite.accept(reply).catch((e) => setError((e as Error).message))} type="button">
                    Connect
                  </button>
                </li>
              )}
              <li>
                On the other device, paste the invite code here:
                <textarea className="input code" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} rows={2} />
                <button
                  className="btn btn-outline btn-sm"
                  disabled={!joinCode.trim()}
                  onClick={async () => {
                    setError(null);
                    try {
                      setAnswer(await mesh.acceptInvite(joinCode));
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                  type="button"
                >
                  Make reply code
                </button>
                {answer && (
                  <>
                    <textarea className="input code" readOnly value={answer} rows={3} onFocus={(e) => e.currentTarget.select()} />
                    <button className="btn btn-text btn-sm" onClick={() => copy(answer)} type="button">
                      Copy reply
                    </button>
                  </>
                )}
              </li>
            </ol>
            {error && <p className="error-text small">{error}</p>}
          </details>
        </>
      )}
    </section>
  );
}
