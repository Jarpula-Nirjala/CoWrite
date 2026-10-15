import { useEffect, useState, type ReactElement } from 'react';
import { api, errorText } from '../api.ts';
import { Link } from '../router.ts';
import { Modal } from './ui.tsx';

export interface ServiceStatus {
  configured: boolean;
  source: 'env' | 'settings' | null;
  signIn: boolean;
  connected: boolean;
  via: 'oauth' | 'token' | null;
  account: { login?: string; name?: string; email?: string; avatar?: string | null; url?: string } | null;
  redirectUri: string;
  scopes: string;
  features: Partial<Record<'gmail' | 'youtube' | 'sheets' | 'tasks' | 'calendar', boolean>>;
}
export interface Integrations {
  owner: boolean;
  google: ServiceStatus;
  github: ServiceStatus;
  origin: string;
}

export function useIntegrations() {
  const [data, setData] = useState<Integrations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => api<Integrations>('/integrations').then(setData, (e) => setError(errorText(e)));
  useEffect(() => {
    void reload();
  }, []);
  return { data, error, reload };
}

export const GoogleLogo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);
export const GitHubLogo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

/** "Connected accounts" in Account settings: Google and GitHub, with buttons to connect each. */
export function ConnectionsSection() {
  const { data, error, reload } = useIntegrations();
  const [dialog, setDialog] = useState<null | 'github' | 'google-setup' | 'github-setup'>(null);
  const connectError = new URLSearchParams(location.search).get('connect_error');
  const disconnect = async (p: 'google' | 'github') => {
    if (!confirm(`Disconnect ${p === 'google' ? 'Google' : 'GitHub'}? CoWrite will stop reading your ${p === 'google' ? 'Drive and Calendar' : 'repositories and gists'}.`)) return;
    await api(`/integrations/${p}`, { method: 'DELETE' }).catch(() => {});
    void reload();
  };
  return (
    <div className="panel connections" id="connected">
      <h2>Connected accounts</h2>
      <p className="muted small">Connect Google and GitHub to open your Drive files, Google Docs, Calendar events, repositories and gists inside CoWrite, and to send your documents back to them.</p>
      {error && <p className="error-text">{error}</p>}
      {connectError && <div className="alert">{connectError}</div>}
      {data?.owner && data.google.source === 'settings' && !data.google.connected && (
        <div className="alert info-alert">
          <b>Google says “Access blocked … only developer-approved testers”?</b> Your Google app is in <b>Testing</b>. Open{' '}
          <a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noreferrer">
            Google Auth Platform → Audience ↗
          </a>
          , press <b>+ Add users</b> under <b>Test users</b>, add the Gmail address you sign in to Google with, and save. Then press Connect Google again (it can take a minute to apply).
        </div>
      )}
      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <ServiceRow
            logo={<GoogleLogo />}
            name="Google"
            features="Drive · Google Docs, Sheets and Slides · Calendar"
            s={data.google}
            onConnect={() => (data.google.configured ? (location.href = '/api/auth/oauth/google?link=1&next=/connections') : setDialog('google-setup'))}
            onDisconnect={() => void disconnect('google')}
          />
          <ServiceRow
            logo={<GitHubLogo />}
            name="GitHub"
            features="Repositories · Markdown files · Gists"
            s={data.github}
            onConnect={() => setDialog('github')}
            onDisconnect={() => void disconnect('github')}
          />
          <p className="muted small">
            Signing in: once Google or GitHub sign-in is switched on for this site, “Continue with Google/GitHub” logs you straight into this same account, because it uses the same verified email address.
          </p>
          {(data.google.connected || data.github.connected) && (
            <Link className="btn btn-primary btn-sm" to="/connections">
              Open your Google and GitHub files →
            </Link>
          )}
        </>
      )}
      {dialog === 'github' && data && <GitHubConnect status={data.github} owner={data.owner} onClose={() => setDialog(null)} onDone={() => (setDialog(null), void reload())} onSetup={() => setDialog('github-setup')} />}
      {(dialog === 'google-setup' || dialog === 'github-setup') && data && <SetupDialog p={dialog === 'google-setup' ? 'google' : 'github'} data={data} onClose={() => setDialog(null)} onSaved={() => (setDialog(null), void reload())} />}
    </div>
  );
}

function ServiceRow({ logo, name, features, s, onConnect, onDisconnect }: { logo: ReactElement; name: string; features: string; s: ServiceStatus; onConnect(): void; onDisconnect(): void }) {
  const who = s.account?.email ?? (s.account?.login ? `@${s.account.login}` : null);
  return (
    <div className="service-row">
      <span className="service-logo">{logo}</span>
      <span className="service-text">
        <b>{name}</b>
        <small>{features}</small>
        <small className={s.connected ? 'ok-text' : 'muted'}>
          {s.connected ? `● Connected${who ? ` as ${who}` : ''}${s.via === 'token' ? ' (access token)' : ''}` : s.configured ? 'Not connected' : name === 'GitHub' ? 'Not connected · connect with a free access token' : 'Not connected · needs a one-time setup'}
        </small>
      </span>
      {s.connected ? (
        <span className="row-actions">
          <Link className="btn btn-outline btn-sm" to="/connections">
            Open
          </Link>
          <button className="btn btn-text btn-sm" onClick={onDisconnect} type="button">
            Disconnect
          </button>
        </span>
      ) : (
        <button className="btn btn-primary btn-sm service-connect" onClick={onConnect} type="button">
          Connect {name}
        </button>
      )}
    </div>
  );
}

function GitHubConnect({ status, owner, onClose, onDone, onSetup }: { status: ServiceStatus; owner: boolean; onClose(): void; onDone(): void; onSetup(): void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/integrations/github/token', { method: 'POST', body: { token } });
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal title="Connect GitHub" onClose={onClose}>
      <div className="connect-dialog">
        {status.configured && (
          <>
            <a className="btn btn-primary connect-big" href="/api/auth/oauth/github?link=1&next=/connections">
              <GitHubLogo /> Continue with GitHub
            </a>
            <p className="or-line">
              <span>or use an access token</span>
            </p>
          </>
        )}
        <ol className="connect-steps">
          <li>
            <a className="btn btn-outline btn-sm" href="https://github.com/settings/tokens/new?description=CoWrite&scopes=repo,gist,read:user" target="_blank" rel="noreferrer">
              <GitHubLogo size={16} /> Create a token on GitHub ↗
            </a>{' '}
            <span className="muted small">(opens GitHub with the right boxes ticked: repo, gist, read:user)</span>
          </li>
          <li>Pick an expiry (for example 90 days), scroll down and press <b>Generate token</b>.</li>
          <li>
            Copy the token (it starts with <code>ghp_</code>) and paste it here:
          </li>
        </ol>
        <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_…" autoComplete="off" aria-label="GitHub token" />
        {error && <p className="error-text">{error}</p>}
        <div className="row-between">
          <span className="muted small">The token is encrypted and only used for your own requests.</span>
          <button className="btn btn-primary" disabled={busy || token.trim().length < 20} onClick={() => void save()} type="button">
            {busy ? 'Checking…' : 'Connect'}
          </button>
        </div>
        {!status.configured && owner && (
          <p className="muted small">
            Site owner: you can also{' '}
            <button className="link-btn inline" onClick={onSetup} type="button">
              switch on “Continue with GitHub”
            </button>{' '}
            for everyone.
          </p>
        )}
      </div>
    </Modal>
  );
}

function SetupDialog({ p, data, onClose, onSaved }: { p: 'google' | 'github'; data: Integrations; onClose(): void; onSaved(): void }) {
  const s = data[p];
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/integrations/setup/${p}`, { method: 'PUT', body: { clientId: id, clientSecret: secret } });
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  const name = p === 'google' ? 'Google' : 'GitHub';
  return (
    <Modal title={`Switch on ${name} for CoWrite`} onClose={onClose} wide>
      <div className="connect-dialog">
        <p>
          {name} only lets a website read your {p === 'google' ? 'Drive and Calendar' : 'account'} after the website registers itself with {name} once. That gives CoWrite an <b>OAuth client</b> (an ID and a secret). It is free and takes about five minutes; afterwards, everyone on this site gets a “Connect {name}” and “Continue with {name}” button.
        </p>
        {!data.owner ? (
          <div className="alert">
            Only the site owner can do this. If that is you, add your email to the <code>ADMIN_EMAILS</code> setting of the server (on Render: Environment → <code>ADMIN_EMAILS=you@example.com</code>) and reload this page.
          </div>
        ) : (
          <>
            <ol className="connect-steps">
              {p === 'google' ? (
                <>
                  <li>
                    Open{' '}
                    <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
                      Google Cloud Console ↗
                    </a>{' '}
                    and create a project called “CoWrite”.
                  </li>
                  <li>
                    Turn on the{' '}
                    <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">
                      Google Drive API ↗
                    </a>{' '}
                    and the{' '}
                    <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">
                      Google Calendar API ↗
                    </a>
                    .
                  </li>
                  <li>
                    In{' '}
                    <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">
                      Google Auth Platform ↗
                    </a>{' '}
                    fill in the app name and your email, choose <b>External</b>, and add your Gmail address under <b>Audience → Test users</b>.
                  </li>
                  <li>
                    Go to{' '}
                    <a href="https://console.cloud.google.com/auth/clients/create" target="_blank" rel="noreferrer">
                      Clients → Create client ↗
                    </a>
                    , choose <b>Web application</b>, and under <b>Authorised redirect URIs</b> add:
                  </li>
                </>
              ) : (
                <>
                  <li>
                    Open{' '}
                    <a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer">
                      GitHub → New OAuth app ↗
                    </a>
                    .
                  </li>
                  <li>
                    Application name “CoWrite”, homepage URL <code>{data.origin}</code>, and as <b>Authorization callback URL</b>:
                  </li>
                </>
              )}
            </ol>
            <div className="copy-row">
              <code>{s.redirectUri}</code>
              <button className="btn btn-outline btn-sm" onClick={() => void navigator.clipboard.writeText(s.redirectUri).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))} type="button">
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p className="muted small">Add the same address with your live site’s domain too (for example https://cowrite-uwpc.onrender.com/api/auth/oauth/{p}/callback).</p>
            <ol className="connect-steps" start={p === 'google' ? 5 : 3}>
              <li>Create it, then copy the <b>Client ID</b> and <b>Client secret</b> here:</li>
            </ol>
            <div className="form-grid">
              <label>
                Client ID
                <input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder={p === 'google' ? '…apps.googleusercontent.com' : 'Ov23…'} />
              </label>
              <label>
                Client secret
                <input className="input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
              </label>
            </div>
            {error && <p className="error-text">{error}</p>}
            <div className="row-between">
              <span className="muted small">Stored encrypted on the server. {s.source === 'env' ? 'This server already has one in its environment.' : ''}</span>
              <button className="btn btn-primary" disabled={busy || !id.trim() || !secret.trim()} onClick={() => void save()} type="button">
                Save and switch on {name}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
