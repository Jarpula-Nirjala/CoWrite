import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, errorText, type User } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { Brand } from '../components/Brand.tsx';
import { Link, navigate, queryParam } from '../router.ts';

/** Only allow redirects back into this site. */
function nextPath(): string {
  const next = queryParam('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/home';
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-side">
        <Brand />
        <blockquote>
          “The merge engine guarantees that every collaborator ends up with exactly the same document, whatever order their edits arrive in.”
        </blockquote>
        <ul className="auth-points">
          <li>Real-time editing with live cursors, comments and chat</li>
          <li>Suggestions, version history and time-travel replay</li>
          <li>Keep writing offline; edits merge on reconnect</li>
          <li>Optional end-to-end encryption and an AI co-writer</li>
        </ul>
      </div>
      <main className="auth-main">{children}</main>
    </div>
  );
}

function OAuthButtons() {
  const { providers } = useAuth();
  if (!providers.providers.length) return null;
  const next = encodeURIComponent(nextPath());
  return (
    <div className="oauth">
      {providers.providers.includes('google') && (
        <a className="btn btn-outline btn-block btn-lg oauth-btn" href={`/api/auth/oauth/google?next=${next}`}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z" />
          </svg>
          Continue with Google
        </a>
      )}
      {providers.providers.includes('github') && (
        <a className="btn btn-outline btn-block btn-lg oauth-btn" href={`/api/auth/oauth/github?next=${next}`}>
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
            <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Continue with GitHub
        </a>
      )}
      <div className="divider">
        <span>or</span>
      </div>
    </div>
  );
}

export function AuthPage({ mode }: { mode: 'signin' | 'signup' }) {
  const { user, ready, signIn, signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(() => queryParam('error'));
  const [busy, setBusy] = useState(false);
  const isSignUp = mode === 'signup';

  useEffect(() => {
    document.title = `${isSignUp ? 'Create an account' : 'Sign in'} · CoWrite`;
  }, [isSignUp]);

  useEffect(() => {
    if (ready && user) navigate(nextPath(), { replace: true });
  }, [ready, user]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isSignUp && password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    try {
      if (isSignUp) await signUp(name, email, password);
      else await signIn(email, password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const next = queryParam('next');
  const switchTo = `${isSignUp ? '/signin' : '/signup'}${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1>{isSignUp ? 'Create your account' : 'Sign in to CoWrite'}</h1>
        <p className="muted">{isSignUp ? 'Start writing together in under a minute.' : 'Welcome back. Enter your details to continue.'}</p>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <OAuthButtons />
        {isSignUp && (
          <label className="field">
            <span>Full name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} required autoFocus />
          </label>
        )}
        <label className="field">
          <span>Email address</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus={!isSignUp} />
        </label>
        <label className="field">
          <span className="row-between">
            Password
            {!isSignUp && (
              <Link className="small" to="/forgot">
                Forgot password?
              </Link>
            )}
          </span>
          <div className="password-wrap">
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              aria-label="Password"
              required
            />
            <button type="button" className="reveal" onClick={() => setShowPassword(!showPassword)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {isSignUp && <small className="muted">At least 8 characters.</small>}
        </label>
        <button className="btn btn-primary btn-block btn-lg" disabled={busy} type="submit">
          {busy ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
        </button>
        <p className="auth-switch">
          {isSignUp ? 'Already have an account?' : 'New to CoWrite?'} <Link to={switchTo}>{isSignUp ? 'Sign in' : 'Create an account'}</Link>
        </p>
        <p className="auth-switch muted small">
          <Link to="/">← Back to home</Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function ForgotPage() {
  const { providers } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = 'Reset your password · CoWrite';
  }, []);
  return (
    <AuthShell>
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api('/auth/forgot', { method: 'POST', body: { email } });
            setSent(true);
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <h1>Reset your password</h1>
        {sent ? (
          <>
            <div className="alert success" role="status">
              If an account exists for {email}, a reset link is on its way. It works for one hour.
            </div>
            {!providers.emailDelivery && <p className="muted small">Note: email delivery isn’t configured on this server, so the link was written to the server log instead.</p>}
          </>
        ) : (
          <>
            <p className="muted">Enter the email you signed up with and we’ll send you a link to choose a new password.</p>
            {error && <div className="alert">{error}</div>}
            <label className="field">
              <span>Email address</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </label>
            <button className="btn btn-primary btn-block btn-lg" type="submit">
              Send reset link
            </button>
          </>
        )}
        <p className="auth-switch">
          <Link to="/signin">Back to sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function ResetPage() {
  const { setUser } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const token = queryParam('token') ?? '';
  return (
    <AuthShell>
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await api<{ user: User }>('/auth/reset', { method: 'POST', body: { token, password } });
            setUser(r.user);
            navigate('/home', { replace: true });
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <h1>Choose a new password</h1>
        {error && <div className="alert">{error}</div>}
        <label className="field">
          <span>New password</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} autoComplete="new-password" required autoFocus />
          <small className="muted">At least 8 characters. You will be signed out everywhere else.</small>
        </label>
        <button className="btn btn-primary btn-block btn-lg" disabled={!token} type="submit">
          Save password
        </button>
      </form>
    </AuthShell>
  );
}
