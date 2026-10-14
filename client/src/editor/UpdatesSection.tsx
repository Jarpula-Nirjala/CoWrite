import { useEffect, useState } from 'react';
import type { Role } from '../../../shared/protocol.ts';
import { api, errorText } from '../api.ts';

/** Email digests for the reader, and a Slack channel feed for the owner. */
export function UpdatesSection({ docId, share, role }: { docId: string; share: string | null; role: Role | null }) {
  const [data, setData] = useState<{ freq: string; slack?: boolean; email: boolean } | null>(null);
  const [hook, setHook] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    api<NonNullable<typeof data>>(`/docs/${docId}/updates`, { share }).then(setData, () => {});
  }, [docId, share]);
  if (!data) return null;
  const run = async (fn: () => Promise<void>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };
  return (
    <section className="updates">
      <h3 className="ai-h">Change updates</h3>
      <label className="field">
        <span>Email me a summary of changes</span>
        <select
          className="input"
          value={data.freq}
          onChange={(e) => {
            const freq = e.target.value;
            void run(async () => {
              await api(`/docs/${docId}/updates`, { method: 'PUT', share, body: { freq } });
              setData({ ...data, freq });
            }, freq === 'off' ? 'Email updates turned off.' : `You will get a ${freq} email when this document changes.`);
          }}
        >
          <option value="off">Off</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      {!data.email && data.freq !== 'off' && <p className="muted small">Email is not configured on this server yet, so summaries arrive as in-app notifications instead.</p>}
      {role === 'owner' && (
        <div className="field">
          <span>Post changes to a Slack channel {data.slack && <span className="ai-badge on">● connected</span>}</span>
          <p className="muted small">
            In Slack, add an{' '}
            <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer">
              incoming webhook
            </a>{' '}
            to a channel and paste its URL. CoWrite posts who edited, once edits settle.
          </p>
          <div className="inline-form">
            <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://hooks.slack.com/services/…" aria-label="Slack webhook URL" />
            <button
              className="btn btn-outline btn-sm"
              disabled={!hook.trim()}
              onClick={() =>
                void run(async () => {
                  await api(`/docs/${docId}/slack`, { method: 'PUT', share, body: { url: hook.trim(), test: true } });
                  setHook('');
                  setData({ ...data, slack: true });
                }, 'Connected. A test message was posted to Slack.')
              }
              type="button"
            >
              Connect
            </button>
          </div>
          {data.slack && (
            <button
              className="btn btn-text btn-sm danger"
              onClick={() =>
                void run(async () => {
                  await api(`/docs/${docId}/slack`, { method: 'PUT', share, body: { url: '' } });
                  setData({ ...data, slack: false });
                }, 'Slack disconnected.')
              }
              type="button"
            >
              Disconnect Slack
            </button>
          )}
        </div>
      )}
      {msg && <p className={msg.ok ? 'notice small' : 'error-text small'}>{msg.text}</p>}
    </section>
  );
}
