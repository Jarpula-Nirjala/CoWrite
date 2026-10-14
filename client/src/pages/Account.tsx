import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorText, type User } from '../api.ts';
import { useAuth } from '../auth.tsx';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { Avatar } from '../components/ui.tsx';
import { Link, navigate } from '../router.ts';

/** Resizes an image file to a square JPEG data URL (keeps uploads small). */
async function toAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.85);
}

type Msg = { ok: boolean; text: string } | null;

import { AiKeySection, AppearanceSection, BrandKitSection } from './AccountExtras.tsx';

export function Account() {
  const { user, ready, setUser, signOut, providers } = useAuth();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [profileMsg, setProfileMsg] = useState<Msg>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwMsg, setPwMsg] = useState<Msg>(null);
  const [deletePw, setDeletePw] = useState('');
  const [deleteMsg, setDeleteMsg] = useState<Msg>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Account settings · CoWrite';
  }, []);
  useEffect(() => {
    if (ready && !user) navigate(`/signin?next=${encodeURIComponent('/account')}`, { replace: true });
    if (user) {
      setName(user.name);
      setUsername(user.username);
      setBio(user.bio);
    }
  }, [ready, user]);

  if (!user) return null;

  const save = async (patch: Record<string, unknown>, ok = 'Profile updated.') => {
    try {
      const r = await api<{ user: User }>('/auth/me', { method: 'PATCH', body: patch });
      setUser(r.user);
      setProfileMsg({ ok: true, text: ok });
    } catch (e) {
      setProfileMsg({ ok: false, text: errorText(e) });
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/auth/password', { method: 'POST', body: { current, password: next } });
      setCurrent('');
      setNext('');
      setUser({ ...user, hasPassword: true });
      setPwMsg({ ok: true, text: 'Password saved. Other devices have been signed out.' });
    } catch (err) {
      setPwMsg({ ok: false, text: errorText(err) });
    }
  };

  return (
    <div className="page">
      <SiteHeader />
      <main className="container account-page">
        <p className="kicker">Account</p>
        <h1>Account settings</h1>

        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ name, username, bio });
          }}
        >
          <h2>Profile</h2>
          {profileMsg && <div className={profileMsg.ok ? 'alert success' : 'alert'}>{profileMsg.text}</div>}
          <div className="avatar-edit">
            <Avatar name={user.name} src={user.avatar} size={84} />
            <div className="row-actions">
              <button className="btn btn-outline btn-sm" onClick={() => file.current?.click()} type="button">
                Upload photo
              </button>
              {user.avatar && (
                <button className="btn btn-text btn-sm" onClick={() => void save({ avatar: null }, 'Photo removed.')} type="button">
                  Remove
                </button>
              )}
              <input
                ref={file}
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    await save({ avatar: await toAvatar(f) }, 'Photo updated.');
                  } catch (err) {
                    setProfileMsg({ ok: false, text: (err as Error).message });
                  }
                }}
              />
            </div>
          </div>
          <label className="field">
            <span>Display name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
            <small className="muted">Shown to collaborators next to your cursor.</small>
          </label>
          <label className="field">
            <span>Username</span>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} maxLength={30} required />
            <small className="muted">
              Used for @mentions and your public profile: <Link to={`/u/${user.username}`}>/u/{user.username}</Link>
            </small>
          </label>
          <label className="field">
            <span>Bio</span>
            <textarea className="input" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} rows={3} placeholder="A sentence or two about you." />
          </label>
          <label className="field">
            <span>Email address</span>
            <input className="input" value={user.email} disabled />
          </label>
          <button className="btn btn-primary" type="submit">
            Save profile
          </button>
        </form>

        <AiKeySection user={user} onChange={(aiConnected, aiProvider) => setUser({ ...user, aiConnected, aiProvider })} />
        <AppearanceSection signedIn />
        <BrandKitSection user={user} onSaved={(brand) => setUser({ ...user, brand })} />

        <form className="panel" id="security" onSubmit={changePassword}>
          <h2>{user.hasPassword ? 'Change password' : 'Set a password'}</h2>
          {!user.hasPassword && <p className="muted small">You signed up with Google or GitHub. Set a password to also sign in with your email.</p>}
          {pwMsg && <div className={pwMsg.ok ? 'alert success' : 'alert'}>{pwMsg.text}</div>}
          {user.hasPassword && (
            <label className="field">
              <span>Current password</span>
              <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
            </label>
          )}
          <label className="field">
            <span>New password</span>
            <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
          </label>
          <button className="btn btn-primary" type="submit">
            Save password
          </button>
        </form>

        <div className="panel">
          <h2>Connected accounts</h2>
          {(['google', 'github'] as const).map((p) => {
            const connected = user[p];
            const available = providers.providers.includes(p);
            return (
              <div key={p} className="row-between connected">
                <span>
                  <strong>{p === 'google' ? 'Google' : 'GitHub'}</strong>{' '}
                  <span className="muted small">{connected ? 'Connected' : available ? 'Not connected' : 'Not available on this server'}</span>
                </span>
                {!connected && available && (
                  <a className="btn btn-outline btn-sm" href={`/api/auth/oauth/${p}?next=/account`}>
                    Connect
                  </a>
                )}
              </div>
            );
          })}
          <p className="muted small">Accounts connect automatically when they use the same verified email address.</p>
        </div>

        <div className="panel">
          <h2>Session</h2>
          <p className="muted">Sign out of CoWrite on this device.</p>
          <button
            className="btn btn-outline"
            type="button"
            onClick={async () => {
              await signOut();
              navigate('/');
            }}
          >
            Sign out
          </button>
        </div>

        <form
          className="panel danger-zone"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!window.confirm('Delete your account and all documents you own? This cannot be undone.')) return;
            try {
              await api('/auth/me', { method: 'DELETE', body: { password: deletePw } });
              setUser(null);
              navigate('/');
            } catch (err) {
              setDeleteMsg({ ok: false, text: errorText(err) });
            }
          }}
        >
          <h2>Delete account</h2>
          <p className="muted small">Permanently deletes your account and every document you own. Documents shared with you are not affected.</p>
          {deleteMsg && <div className="alert">{deleteMsg.text}</div>}
          {user.hasPassword && (
            <label className="field">
              <span>Confirm with your password</span>
              <input className="input" type="password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} autoComplete="current-password" required />
            </label>
          )}
          <button className="btn btn-danger" type="submit">
            Delete my account
          </button>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}
