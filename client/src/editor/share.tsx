import { useEffect, useState } from 'react';
import type { Role } from '../../../shared/protocol.ts';
import { api, errorText, formatDate, timeAgo, type DocDetails } from '../api.ts';
import { Avatar, Modal } from '../components/ui.tsx';
import { Link } from '../router.ts';

interface Sharing {
  owner: { userId: string; name: string; username: string; avatar: string | null } | null;
  members: { userId: string; name: string; username: string; avatar: string | null; role: Role; lastSeen: number }[];
  links: { token: string; role: Role; createdAt: number; expiresAt: number | null }[];
  published: boolean;
}

const ROLE_LABEL: Record<string, string> = { viewer: 'Can view', commenter: 'Can comment', editor: 'Can edit', owner: 'Owner' };

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt('Copy this link', text);
    return false;
  }
}

export function ShareDialog({ docId, meta, role, share, onClose, onMetaChange }: { docId: string; meta: DocDetails | null; role: Role | null; share: string | null; onClose(): void; onMetaChange(m: DocDetails): void }) {
  const [data, setData] = useState<Sharing | null>(null);
  const [newRole, setNewRole] = useState<Role>('editor');
  const [expiry, setExpiry] = useState<string>('7');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = role === 'owner';
  const keyHash = window.location.hash;
  const base = `${window.location.origin}/d/${docId}`;

  const load = () => {
    if (!meta) return;
    api<Sharing>(`/docs/${docId}/sharing`, { share }).then(setData, (e) => setError(errorText(e)));
  };
  useEffect(load, [docId, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (id: string) => {
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  };

  const createLink = async () => {
    try {
      const r = await api<{ link: { token: string } }>(`/docs/${docId}/links`, {
        method: 'POST',
        body: { role: newRole, expiresInDays: expiry === 'never' ? null : Number(expiry) },
      });
      await copy(`${base}?s=${r.link.token}${keyHash}`);
      flash(r.link.token);
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const setPublished = async (published: boolean) => {
    try {
      const r = await api<{ document: DocDetails }>(`/docs/${docId}`, { method: 'PATCH', body: { published } });
      onMetaChange({ ...meta!, published: r.document.published });
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Modal title="Share this document" onClose={onClose} wide>
      {error && <div className="alert">{error}</div>}
      {meta?.encrypted && (
        <p className="notice small">
          This document is end-to-end encrypted. Every link below includes the decryption key after the “#”, which never reaches the server. Anyone with the full
          link can read it.
        </p>
      )}

      {!meta && (
        <section className="share-section">
          <p>This is a quick guest document: anyone with the link can edit it.</p>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await copy(window.location.href);
              flash('page');
            }}
            type="button"
          >
            {copied === 'page' ? 'Link copied' : 'Copy link'}
          </button>
        </section>
      )}

      {meta && isOwner && (
        <section className="share-section">
          <h3>Invite with a link</h3>
          <p className="muted small">Create links with different permissions. Signed-in people who open one are added to the document.</p>
          <div className="inline-form">
            <select className="input" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} aria-label="Permission">
              <option value="viewer">Can view</option>
              <option value="commenter">Can comment</option>
              <option value="editor">Can edit</option>
            </select>
            <select className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Expires">
              <option value="1">Expires in 1 day</option>
              <option value="7">Expires in 7 days</option>
              <option value="30">Expires in 30 days</option>
              <option value="never">Never expires</option>
            </select>
            <button className="btn btn-primary" onClick={createLink} type="button">
              Create &amp; copy link
            </button>
          </div>
          {data && data.links.length > 0 && (
            <table className="share-table">
              <tbody>
                {data.links.map((l) => (
                  <tr key={l.token}>
                    <td>{ROLE_LABEL[l.role]}</td>
                    <td className="muted small">{l.expiresAt ? `Expires ${formatDate(l.expiresAt)}` : 'No expiry'}</td>
                    <td className="row-actions">
                      <button
                        className="btn btn-text btn-sm"
                        onClick={async () => {
                          await copy(`${base}?s=${l.token}${keyHash}`);
                          flash(l.token);
                        }}
                        type="button"
                      >
                        {copied === l.token ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        className="btn btn-text btn-sm danger"
                        onClick={async () => {
                          await api(`/docs/${docId}/links/${l.token}`, { method: 'DELETE' });
                          load();
                        }}
                        type="button"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {meta && data && (
        <section className="share-section">
          <h3>People with access</h3>
          <ul className="people">
            {data.owner && (
              <li>
                <Avatar name={data.owner.name} src={data.owner.avatar} size={32} />
                <span>
                  <strong>{data.owner.name}</strong> <span className="muted small">@{data.owner.username}</span>
                </span>
                <span className="muted small">Owner</span>
              </li>
            )}
            {data.members.map((m) => (
              <li key={m.userId}>
                <Avatar name={m.name} src={m.avatar} size={32} />
                <span>
                  <strong>{m.name}</strong> <span className="muted small">@{m.username} · last seen {timeAgo(m.lastSeen)}</span>
                </span>
                {isOwner ? (
                  <select
                    className="input select-sm"
                    value={m.role}
                    aria-label={`${m.name}'s permission`}
                    onChange={async (e) => {
                      const v = e.target.value;
                      await api(`/docs/${docId}/members/${m.userId}`, { method: 'PATCH', body: { role: v === 'remove' ? null : v } });
                      load();
                    }}
                  >
                    <option value="viewer">Can view</option>
                    <option value="commenter">Can comment</option>
                    <option value="editor">Can edit</option>
                    <option value="remove">Remove access</option>
                  </select>
                ) : (
                  <span className="muted small">{ROLE_LABEL[m.role]}</span>
                )}
              </li>
            ))}
          </ul>
          {!data.members.length && <p className="muted small">Nobody else has joined yet.</p>}
        </section>
      )}

      {meta && isOwner && (
        <section className="share-section">
          <h3>Publish to the web</h3>
          {meta.encrypted ? (
            <p className="muted small">Encrypted documents cannot be published.</p>
          ) : (
            <>
              <label className="switch block">
                <input type="checkbox" checked={meta.published} onChange={(e) => void setPublished(e.target.checked)} />
                <span>{meta.published ? 'Published: anyone can read it and it appears on your profile' : 'Not published'}</span>
              </label>
              {meta.published && (
                <p className="small">
                  Public page: <Link to={`/p/${docId}`}>{`${window.location.origin}/p/${docId}`}</Link>
                </p>
              )}
            </>
          )}
        </section>
      )}
    </Modal>
  );
}
