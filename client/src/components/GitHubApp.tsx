import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { markdownToTokens } from '../../../shared/rich.ts';
import { api, errorText } from '../api.ts';
import { appApi } from '../lib/google.ts';
import { createAndOpen } from '../lib/create.ts';
import { renderMarkdown } from '../lib/text.ts';
import { AppLogo } from './AppLogo.tsx';
import { Spinner } from './ui.tsx';

/* ------------------------------------------------------------- types */

interface User {
  login: string;
  name?: string | null;
  avatar_url: string;
  bio?: string | null;
  followers?: number;
  following?: number;
  public_repos?: number;
  html_url: string;
}
interface Repo {
  full_name: string;
  name: string;
  owner: { login: string; avatar_url: string };
  private: boolean;
  fork: boolean;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count?: number;
  updated_at: string;
  pushed_at?: string;
  default_branch: string;
  html_url: string;
  clone_url: string;
  topics?: string[];
  homepage?: string | null;
  permissions?: { admin: boolean; push: boolean; pull: boolean };
}
interface Entry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  sha: string;
}
interface Issue {
  number: number;
  title: string;
  state: string;
  user: { login: string; avatar_url: string };
  comments: number;
  created_at: string;
  body: string | null;
  html_url: string;
  pull_request?: unknown;
  labels: { name: string; color: string }[];
  repository_url?: string;
}
type Nav =
  | { v: 'home' }
  | { v: 'repos' }
  | { v: 'issues' }
  | { v: 'pulls' }
  | { v: 'notifications' }
  | { v: 'stars' }
  | { v: 'explore'; q?: string }
  | { v: 'new' }
  | { v: 'repo'; name: string; tab?: RepoTab; issue?: number; pull?: number };
type RepoTab = 'code' | 'issues' | 'pulls' | 'commits' | 'branches' | 'releases';

/* ----------------------------------------------------------- helpers */

const gh = <T,>(path: string, init?: { method?: string; body?: unknown }) => appApi<T>('github', path, init);
const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  for (const [n, u] of [
    [31_536_000, 'year'],
    [2_592_000, 'month'],
    [86_400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ] as const)
    if (s >= n) return `${Math.floor(s / n)} ${u}${Math.floor(s / n) > 1 ? 's' : ''} ago`;
  return 'just now';
};
const LANG: Record<string, string> = { TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Java: '#b07219', HTML: '#e34c26', CSS: '#563d7c', 'C++': '#f34b7d', C: '#555555', Go: '#00ADD8', Rust: '#dea584', Kotlin: '#A97BFF', Dart: '#00B4AB', Shell: '#89e051', 'Jupyter Notebook': '#DA5B0B', PHP: '#4F5D95', Ruby: '#701516', Swift: '#F05138' };
const decode64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const encode64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const repoOf = (url?: string) => (url ?? '').replace('https://api.github.com/repos/', '');

function Md({ text }: { text: string }) {
  return <article className="ghx-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}
function Lang({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span className="ghx-langname">
      <span className="ghx-lang" style={{ background: LANG[name] ?? '#8b949e' }} /> {name}
    </span>
  );
}
function Err({ text, onClose }: { text: string | null; onClose(): void }) {
  return text ? (
    <p className="error-text gm-error" onClick={onClose}>
      {text}
    </p>
  ) : null;
}

/* ---------------------------------------------------------------- app */

/** GitHub inside CoWrite: dashboard, repositories (code, issues, pull requests, commits, branches, releases), notifications, stars and explore. */
export function GitHubApp() {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ github: { connected: boolean } }>('/integrations').then((r) => setConnected(r.github.connected), () => setConnected(false));
  }, []);
  if (connected === null) return <Spinner />;
  if (!connected)
    return (
      <div className="gate">
        <AppLogo name="github" size={64} />
        <h3>Connect your GitHub account</h3>
        <p className="muted">Connect GitHub once in Account settings (a free access token is enough).</p>
        <a className="btn btn-primary" href="/account#connected">
          Connect GitHub
        </a>
      </div>
    );
  return <Hub />;
}

function Hub() {
  const [me, setMe] = useState<User | null>(null);
  const [nav, setNav] = useState<Nav>({ v: 'home' });
  const [history, setHistory] = useState<Nav[]>([]);
  const [q, setQ] = useState('');
  const [unread, setUnread] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    gh<User>('user').then(setMe, () => {});
    gh<unknown[]>('notifications?per_page=50').then((n) => setUnread(n.length), () => {});
  }, []);
  const go = useCallback((n: Nav) => {
    setHistory((h) => [...h.slice(-30), nav]);
    setNav(n);
  }, [nav]);
  const back = () => {
    const prev = history[history.length - 1];
    if (prev) {
      setHistory(history.slice(0, -1));
      setNav(prev);
    }
  };
  const SIDE: [Nav['v'], string, string][] = [
    ['home', '🏠', 'Home'],
    ['repos', '📚', 'Repositories'],
    ['issues', '◎', 'Issues'],
    ['pulls', '⇄', 'Pull requests'],
    ['notifications', '🔔', 'Notifications'],
    ['stars', '⭐', 'Stars'],
    ['explore', '🧭', 'Explore'],
  ];

  return (
    <div className={`ghx ${collapsed ? 'ghx-collapsed' : ''}`}>
      <header className="ghx-top">
        <button className="ghx-menu" onClick={() => setCollapsed(!collapsed)} aria-label="Menu" type="button">
          ☰
        </button>
        <button className="ghx-logo" onClick={() => go({ v: 'home' })} type="button" aria-label="GitHub home">
          <AppLogo name="github" size={30} />
        </button>
        {history.length > 0 && (
          <button className="ghx-menu" onClick={back} aria-label="Back" title="Back" type="button">
            ←
          </button>
        )}
        <b className="ghx-crumb">
          {nav.v === 'repo' ? (
            <>
              <span>{nav.name.split('/')[0]}</span> / <b>{nav.name.split('/')[1]}</b>
            </>
          ) : (
            SIDE.find((s) => s[0] === nav.v)?.[2] ?? 'New repository'
          )}
        </b>
        <form
          className="ghx-searchform"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) go({ v: 'explore', q: q.trim() });
          }}
        >
          <input className="ghx-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search GitHub…" aria-label="Search GitHub" />
        </form>
        <button className="ghx-bell" onClick={() => go({ v: 'notifications' })} title="Notifications" type="button">
          🔔{unread > 0 && <i />}
        </button>
        {me && <img className="ghx-avatar" src={me.avatar_url} alt={me.login} title={me.login} />}
      </header>
      <div className="ghx-shell">
        <aside className="gm-side ghx-side">
          <button className="gm-compose ghx-newbtn" onClick={() => go({ v: 'new' })} type="button">
            ＋ <span>New repository</span>
          </button>
          <nav>
            {SIDE.map(([v, icon, label]) => (
              <button key={v} className={nav.v === v ? 'on' : ''} onClick={() => go({ v } as Nav)} type="button" title={label}>
                <span className="gm-ico">{icon}</span>
                <span className="gm-lname">{label}</span>
                {v === 'notifications' && unread > 0 && <b className="gm-count">{unread}</b>}
              </button>
            ))}
          </nav>
        </aside>
        <main className="ghx-main">
          {nav.v === 'home' ? (
            <Home me={me} go={go} />
          ) : nav.v === 'repos' ? (
            <RepoList me={me} go={go} />
          ) : nav.v === 'issues' ? (
            <MyIssues key="issues" me={me} go={go} pulls={false} />
          ) : nav.v === 'pulls' ? (
            <MyIssues key="pulls" me={me} go={go} pulls />
          ) : nav.v === 'notifications' ? (
            <Notifications go={go} onCount={setUnread} />
          ) : nav.v === 'stars' ? (
            <Stars go={go} />
          ) : nav.v === 'explore' ? (
            <Explore q={nav.q} go={go} />
          ) : nav.v === 'new' ? (
            <NewRepo go={go} />
          ) : (
            <RepoView key={nav.name} name={nav.name} tab={nav.tab} issue={nav.issue} pull={nav.pull} go={go} />
          )}
        </main>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- home */

interface Ev {
  id: string;
  type: string;
  actor: { login: string; avatar_url: string };
  repo: { name: string };
  created_at: string;
  payload: { action?: string; ref?: string; ref_type?: string; commits?: { message: string }[]; issue?: { title: string; number: number }; pull_request?: { title: string; number: number }; release?: { tag_name: string }; forkee?: { full_name: string } };
}

function Home({ me, go }: { me: User | null; go(n: Nav): void }) {
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!me) return;
    gh<Ev[]>(`users/${me.login}/received_events?per_page=40`).then(
      async (r) => setEvents(r.length ? r : await gh<Ev[]>(`users/${me.login}/events?per_page=40`)),
      (e) => (setEvents([]), setError(errorText(e))),
    );
    gh<Repo[]>('user/repos?per_page=8&sort=pushed').then(setRepos, () => {});
  }, [me]);
  const what = (e: Ev): ReactNode => {
    const p = e.payload;
    const repo = (
      <button className="ghx-link small" onClick={() => go({ v: 'repo', name: e.repo.name })} type="button">
        {e.repo.name}
      </button>
    );
    switch (e.type) {
      case 'PushEvent':
        return (
          <>
            pushed {p.commits?.length ?? 0} commit{p.commits?.length === 1 ? '' : 's'} to <code>{(p.ref ?? '').replace('refs/heads/', '')}</code> in {repo}
            {p.commits?.[0] && <small className="ghx-evdetail">{p.commits[0].message.split('\n')[0]}</small>}
          </>
        );
      case 'WatchEvent':
        return <>starred {repo}</>;
      case 'CreateEvent':
        return (
          <>
            created {p.ref_type} {p.ref && <code>{p.ref}</code>} in {repo}
          </>
        );
      case 'ForkEvent':
        return <>forked {repo}</>;
      case 'IssuesEvent':
        return (
          <>
            {p.action} issue <b>#{p.issue?.number}</b> {p.issue?.title} in {repo}
          </>
        );
      case 'PullRequestEvent':
        return (
          <>
            {p.action} pull request <b>#{p.pull_request?.number}</b> {p.pull_request?.title} in {repo}
          </>
        );
      case 'IssueCommentEvent':
        return (
          <>
            commented on #{p.issue?.number} in {repo}
          </>
        );
      case 'ReleaseEvent':
        return (
          <>
            released <b>{p.release?.tag_name}</b> of {repo}
          </>
        );
      default:
        return <>{e.type.replace(/Event$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} in {repo}</>;
    }
  };
  return (
    <div className="ghx-homegrid">
      <section>
        <h3>Recent activity</h3>
        <Err text={error} onClose={() => setError(null)} />
        {!events ? (
          <Spinner />
        ) : !events.length ? (
          <p className="muted">No recent activity yet. Star or follow projects to see what is happening.</p>
        ) : (
          <ul className="ghx-feed">
            {events.map((e) => (
              <li key={e.id}>
                <img src={e.actor.avatar_url} alt="" />
                <div>
                  <span>
                    <b>{e.actor.login}</b> {what(e)}
                  </span>
                  <small className="muted">{ago(e.created_at)}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <aside>
        {me && (
          <div className="ghx-card ghx-me">
            <img src={me.avatar_url} alt="" />
            <div>
              <b>{me.name ?? me.login}</b>
              <small className="muted">
                {me.login} · 👥 {me.followers} followers · {me.following} following
              </small>
              {me.bio && <small>{me.bio}</small>}
            </div>
          </div>
        )}
        <div className="ghx-card">
          <div className="row-between">
            <b>Top repositories</b>
            <button className="btn btn-primary btn-sm ghx-green" onClick={() => go({ v: 'new' })} type="button">
              New
            </button>
          </div>
          <ul className="ghx-mini-list">
            {repos.map((r) => (
              <li key={r.full_name}>
                <img src={r.owner.avatar_url} alt="" />
                <button className="ghx-link small" onClick={() => go({ v: 'repo', name: r.full_name })} type="button">
                  {r.full_name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

/* -------------------------------------------------------- repositories */

function RepoRows({ repos, go, empty }: { repos: Repo[]; go(n: Nav): void; empty: string }) {
  return (
    <ul className="ghx-repolist">
      {repos.map((r) => (
        <li key={r.full_name}>
          <div>
            <button className="ghx-link" onClick={() => go({ v: 'repo', name: r.full_name })} type="button">
              {r.full_name}
            </button>{' '}
            <span className="ghx-badge">{r.private ? 'Private' : 'Public'}</span>
            {r.fork && <span className="ghx-badge">Fork</span>}
            {r.description && <p className="muted">{r.description}</p>}
            {!!r.topics?.length && (
              <p>
                {r.topics.slice(0, 6).map((t) => (
                  <span key={t} className="ghx-topic">
                    {t}
                  </span>
                ))}
              </p>
            )}
            <small className="muted ghx-meta">
              <Lang name={r.language} /> <span>⭐ {r.stargazers_count}</span> <span>🍴 {r.forks_count}</span> <span>Updated {ago(r.pushed_at ?? r.updated_at)}</span>
            </small>
          </div>
        </li>
      ))}
      {!repos.length && <li className="muted">{empty}</li>}
    </ul>
  );
}

function RepoList({ me, go }: { me: User | null; go(n: Nav): void }) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [filter, setFilter] = useState('');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('pushed');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setRepos(null);
    gh<Repo[]>(`user/repos?per_page=100&sort=${sort}&affiliation=owner,collaborator,organization_member`).then(setRepos, (e) => (setRepos([]), setError(errorText(e))));
  }, [sort]);
  const shown = (repos ?? []).filter(
    (r) => r.full_name.toLowerCase().includes(filter.toLowerCase()) && (type === 'all' || (type === 'public' && !r.private) || (type === 'private' && r.private) || (type === 'forks' && r.fork) || (type === 'mine' && r.owner.login === me?.login)),
  );
  return (
    <div className="ghx-pad">
      <div className="ghx-toolbar">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a repository…" aria-label="Find a repository" />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="all">All</option>
          <option value="mine">Yours</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
          <option value="forks">Forks</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="pushed">Last pushed</option>
          <option value="updated">Last updated</option>
          <option value="full_name">Name</option>
          <option value="created">Newest</option>
        </select>
        <button className="btn btn-primary btn-sm ghx-green" onClick={() => go({ v: 'new' })} type="button">
          ＋ New
        </button>
      </div>
      <Err text={error} onClose={() => setError(null)} />
      {!repos ? <Spinner /> : <RepoRows repos={shown} go={go} empty="No repositories match." />}
    </div>
  );
}

function NewRepo({ go }: { go(n: Nav): void }) {
  const [f, setF] = useState({ name: '', description: '', private: false, auto_init: true, gitignore: '', license: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await gh<Repo>('user/repos', {
        method: 'POST',
        body: { name: f.name, description: f.description, private: f.private, auto_init: f.auto_init, ...(f.gitignore ? { gitignore_template: f.gitignore } : {}), ...(f.license ? { license_template: f.license } : {}) },
      });
      go({ v: 'repo', name: r.full_name });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="ghx-pad ghx-form">
      <h2>Create a new repository</h2>
      <label>
        Repository name *
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.replace(/\s+/g, '-') })} placeholder="my-awesome-project" />
      </label>
      <label>
        Description (optional)
        <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </label>
      <div className="ghx-radio">
        <label>
          <input type="radio" checked={!f.private} onChange={() => setF({ ...f, private: false })} /> 🌐 <b>Public</b> <small className="muted">Anyone on the internet can see this repository.</small>
        </label>
        <label>
          <input type="radio" checked={f.private} onChange={() => setF({ ...f, private: true })} /> 🔒 <b>Private</b> <small className="muted">You choose who can see and commit.</small>
        </label>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={f.auto_init} onChange={(e) => setF({ ...f, auto_init: e.target.checked })} /> Add a README file
      </label>
      <div className="ghx-two">
        <label>
          .gitignore template
          <select value={f.gitignore} onChange={(e) => setF({ ...f, gitignore: e.target.value })}>
            <option value="">None</option>
            {['Node', 'Python', 'Java', 'C++', 'Go', 'Rust', 'Unity', 'Android'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Licence
          <select value={f.license} onChange={(e) => setF({ ...f, license: e.target.value })}>
            <option value="">None</option>
            <option value="mit">MIT License</option>
            <option value="apache-2.0">Apache License 2.0</option>
            <option value="gpl-3.0">GNU GPL v3</option>
          </select>
        </label>
      </div>
      <Err text={error} onClose={() => setError(null)} />
      <button className="btn btn-primary ghx-green" disabled={busy || !f.name.trim()} onClick={() => void create()} type="button">
        {busy ? 'Creating…' : 'Create repository'}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------- repo view */

function RepoView({ name, tab: startTab, issue, pull, go }: { name: string; tab?: RepoTab; issue?: number; pull?: number; go(n: Nav): void }) {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [tab, setTab] = useState<RepoTab>(startTab ?? (issue ? 'issues' : pull ? 'pulls' : 'code'));
  const [starred, setStarred] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  useEffect(() => {
    gh<Repo>(`repos/${name}`).then(setRepo, (e) => setError(errorText(e)));
    gh(`user/starred/${name}`).then(
      () => setStarred(true),
      () => setStarred(false),
    );
  }, [name]);
  const star = async () => {
    try {
      await gh(`user/starred/${name}`, { method: starred ? 'DELETE' : 'PUT' });
      setStarred(!starred);
      setRepo((r) => (r ? { ...r, stargazers_count: r.stargazers_count + (starred ? -1 : 1) } : r));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const fork = async () => {
    if (!confirm(`Fork ${name} to your account?`)) return;
    try {
      const f = await gh<Repo>(`repos/${name}/forks`, { method: 'POST', body: {} });
      go({ v: 'repo', name: f.full_name });
    } catch (e) {
      setError(errorText(e));
    }
  };
  if (!repo) return error ? <Err text={error} onClose={() => setError(null)} /> : <Spinner />;
  const TABS: [RepoTab, string][] = [
    ['code', '<> Code'],
    ['issues', `◎ Issues${repo.open_issues_count ? ` ${repo.open_issues_count}` : ''}`],
    ['pulls', '⇄ Pull requests'],
    ['commits', '⏱ Commits'],
    ['branches', '⑂ Branches'],
    ['releases', '🏷 Releases'],
  ];
  return (
    <div className="ghx-repo">
      <div className="ghx-repohead">
        <h2>
          <img src={repo.owner.avatar_url} alt="" /> {repo.owner.login} / <b>{repo.name}</b> <span className="ghx-badge">{repo.private ? 'Private' : 'Public'}</span>
        </h2>
        <span className="ghx-repoactions">
          <button className={`ghx-pillbtn ${starred ? 'on' : ''}`} onClick={() => void star()} type="button">
            {starred ? '★ Starred' : '☆ Star'} <span>{repo.stargazers_count}</span>
          </button>
          <button className="ghx-pillbtn" onClick={() => void fork()} type="button">
            🍴 Fork <span>{repo.forks_count}</span>
          </button>
          <span className="ghx-clone">
            <button className="btn btn-primary btn-sm ghx-green" onClick={() => setCloneOpen(!cloneOpen)} type="button">
              {'<>'} Code ▾
            </button>
            {cloneOpen && (
              <div className="ghx-clonebox">
                <b>Clone with HTTPS</b>
                <div className="chat-ask">
                  <input readOnly value={repo.clone_url} onFocus={(e) => e.target.select()} aria-label="Clone URL" />
                  <button className="btn btn-outline btn-sm" onClick={() => void navigator.clipboard.writeText(repo.clone_url)} type="button">
                    Copy
                  </button>
                </div>
                <a href={`${repo.html_url}/archive/refs/heads/${repo.default_branch}.zip`}>⬇ Download ZIP</a>
                <a href={repo.html_url} target="_blank" rel="noreferrer">
                  Open on github.com ↗
                </a>
              </div>
            )}
          </span>
        </span>
      </div>
      {repo.description && <p className="muted ghx-desc">{repo.description}</p>}
      <nav className="ghx-tabs">
        {TABS.map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} type="button">
            {l}
          </button>
        ))}
      </nav>
      <Err text={error} onClose={() => setError(null)} />
      {tab === 'code' ? (
        <Code repo={repo} />
      ) : tab === 'issues' ? (
        <Issues key="issues" repo={repo} pulls={false} openNumber={issue} />
      ) : tab === 'pulls' ? (
        <Issues key="pulls" repo={repo} pulls openNumber={pull} />
      ) : tab === 'commits' ? (
        <Commits repo={repo} />
      ) : tab === 'branches' ? (
        <Branches repo={repo} />
      ) : (
        <Releases repo={repo} />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- code */

function Code({ repo }: { repo: Repo }) {
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState(repo.default_branch);
  const [path, setPath] = useState('');
  const [items, setItems] = useState<Entry[] | null>(null);
  const [file, setFile] = useState<{ name: string; path: string; text: string; sha: string; raw: string; binary: boolean } | null>(null);
  const [readme, setReadme] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ path: string; text: string; sha?: string } | null>(null);
  const [lastCommit, setLastCommit] = useState<{ message: string; author: string; date: string; sha: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canPush = repo.permissions?.push !== false;

  useEffect(() => {
    gh<{ name: string }[]>(`repos/${repo.full_name}/branches?per_page=100`).then((b) => setBranches(b.map((x) => x.name)), () => {});
  }, [repo.full_name]);
  const load = useCallback(() => {
    setItems(null);
    setFile(null);
    gh<Entry[]>(`repos/${repo.full_name}/contents/${enc(path)}?ref=${encodeURIComponent(branch)}`).then(
      (r) => {
        const list = (Array.isArray(r) ? r : []).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
        setItems(list);
        const rd = list.find((x) => /^readme(\.md|\.markdown|\.txt)?$/i.test(x.name));
        setReadme(null);
        if (rd) gh<{ content: string }>(`repos/${repo.full_name}/contents/${enc(rd.path)}?ref=${encodeURIComponent(branch)}`).then((f) => setReadme(decode64(f.content)), () => {});
      },
      (e) => (setItems([]), setError(/empty/i.test(errorText(e)) ? 'This repository is empty. Add a file to get started.' : errorText(e))),
    );
    gh<{ sha: string; commit: { message: string; author: { name: string; date: string } } }[]>(`repos/${repo.full_name}/commits?per_page=1&sha=${encodeURIComponent(branch)}${path ? `&path=${encodeURIComponent(path)}` : ''}`).then(
      (c) => setLastCommit(c[0] ? { message: c[0].commit.message.split('\n')[0], author: c[0].commit.author.name, date: c[0].commit.author.date, sha: c[0].sha } : null),
      () => setLastCommit(null),
    );
  }, [repo.full_name, path, branch]);
  useEffect(load, [load]);

  const openFile = async (it: Entry) => {
    if (it.size > 1_000_000) return setError('This file is too large to show here. Open it on GitHub.');
    try {
      const f = await gh<{ content: string; name: string; path: string; sha: string; download_url: string }>(`repos/${repo.full_name}/contents/${enc(it.path)}?ref=${encodeURIComponent(branch)}`);
      const binary = /\.(png|jpe?g|gif|webp|ico|pdf|zip|exe|woff2?|ttf|mp4|mp3)$/i.test(f.name);
      setFile({ name: f.name, path: f.path, text: binary ? '' : decode64(f.content), sha: f.sha, raw: f.download_url, binary });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const commit = async (p: string, text: string, sha: string | undefined, message: string) => {
    await gh(`repos/${repo.full_name}/contents/${enc(p)}`, { method: 'PUT', body: { message, content: encode64(text), branch, ...(sha ? { sha } : {}) } });
  };
  const remove = async () => {
    if (!file || !confirm(`Delete ${file.path} on ${branch}?`)) return;
    try {
      await gh(`repos/${repo.full_name}/contents/${enc(file.path)}`, { method: 'DELETE', body: { message: `Delete ${file.path}`, sha: file.sha, branch } });
      setFile(null);
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (editing)
    return (
      <Editor
        branch={branch}
        initial={editing}
        onCancel={() => setEditing(null)}
        onCommit={async (p, text, message) => {
          await commit(p, text, editing.sha, message);
          setEditing(null);
          setPath(p.split('/').slice(0, -1).join('/'));
          load();
        }}
      />
    );

  const crumbs = path ? path.split('/') : [];
  return (
    <div className="ghx-code">
      <div className="ghx-path">
        <select className="ghx-branchsel" value={branch} onChange={(e) => (setBranch(e.target.value), setPath(''))} aria-label="Branch">
          {(branches.length ? branches : [repo.default_branch]).map((b) => (
            <option key={b} value={b}>
              ⑂ {b}
            </option>
          ))}
        </select>
        <button onClick={() => setPath('')} type="button">
          {repo.name}
        </button>
        {crumbs.map((c, i) => (
          <span key={i}>
            {' / '}
            <button onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))} type="button">
              {c}
            </button>
          </span>
        ))}
        {file && <span> / {file.name}</span>}
        {canPush && !file && (
          <button className="btn btn-outline btn-sm ghx-addfile" onClick={() => setEditing({ path: path ? `${path}/` : '', text: '' })} type="button">
            ＋ Add file
          </button>
        )}
      </div>
      <Err text={error} onClose={() => setError(null)} />
      {file ? (
        <div className="ghx-file">
          <div className="ghx-filebar">
            <b>{file.name}</b>
            {!file.binary && <small className="muted">{file.text.split('\n').length} lines</small>}
            <span className="row-actions">
              <a className="btn btn-text btn-sm" href={file.raw} target="_blank" rel="noreferrer">
                Raw
              </a>
              {!file.binary && (
                <>
                  <button className="btn btn-outline btn-sm" onClick={() => void navigator.clipboard.writeText(file.text)} type="button">
                    Copy
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() =>
                      void createAndOpen(file.name.replace(/\.(md|markdown|txt)$/i, ''), 'doc', {
                        tokens: markdownToTokens(/\.(md|markdown|txt)$/i.test(file.name) ? file.text : `# ${file.name}\n\`\`\`${file.name.split('.').pop()}\n${file.text}\n\`\`\``),
                        settings: { theme: 'simple', font: 'sans' },
                      })
                    }
                    type="button"
                  >
                    Open in CoWrite
                  </button>
                  {canPush && (
                    <button className="btn btn-outline btn-sm" onClick={() => setEditing({ path: file.path, text: file.text, sha: file.sha })} type="button">
                      ✏️ Edit
                    </button>
                  )}
                </>
              )}
              {canPush && (
                <button className="btn btn-outline btn-sm ghx-danger" onClick={() => void remove()} type="button">
                  🗑️ Delete
                </button>
              )}
              <button className="btn btn-text btn-sm" onClick={() => setFile(null)} type="button">
                Close
              </button>
            </span>
          </div>
          {file.binary ? (
            /\.(png|jpe?g|gif|webp|ico)$/i.test(file.name) ? (
              <div className="ghx-imgview">
                <img src={file.raw} alt={file.name} />
              </div>
            ) : (
              <p className="ghx-pad muted">Binary file. Use “Raw” to download it.</p>
            )
          ) : /\.(md|markdown)$/i.test(file.name) ? (
            <Md text={file.text} />
          ) : (
            <pre className="ghx-src">
              {file.text.split('\n').map((l, i) => (
                <div key={i}>
                  <span className="ln">{i + 1}</span>
                  {l || ' '}
                </div>
              ))}
            </pre>
          )}
        </div>
      ) : !items ? (
        <Spinner />
      ) : (
        <>
          <div className="ghx-treebox">
            {lastCommit && (
              <div className="ghx-lastcommit">
                <b>{lastCommit.author}</b> <span className="muted">{lastCommit.message}</span>
                <small className="muted">
                  {lastCommit.sha.slice(0, 7)} · {ago(lastCommit.date)}
                </small>
              </div>
            )}
            <ul className="ghx-tree">
              {path && (
                <li>
                  <button onClick={() => setPath(crumbs.slice(0, -1).join('/'))} type="button">
                    📁 ..
                  </button>
                </li>
              )}
              {items.map((it) => (
                <li key={it.path}>
                  <button onClick={() => (it.type === 'dir' ? setPath(it.path) : void openFile(it))} type="button">
                    {it.type === 'dir' ? '📁' : '📄'} {it.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {readme && (
            <section className="ghx-readme">
              <header>📖 README</header>
              <Md text={readme} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Editor({ branch, initial, onCancel, onCommit }: { branch: string; initial: { path: string; text: string; sha?: string }; onCancel(): void; onCommit(path: string, text: string, message: string): Promise<void> }) {
  const [path, setPath] = useState(initial.path);
  const [text, setText] = useState(initial.text);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !initial.sha;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCommit(path.replace(/^\/+/, ''), text, message.trim() || (isNew ? `Create ${path}` : `Update ${path.split('/').pop()}`));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="ghx-editor">
      <div className="ghx-filebar">
        {isNew ? <input className="ghx-pathinput" value={path} onChange={(e) => setPath(e.target.value)} placeholder="folder/name-your-file.md" aria-label="File path" autoFocus /> : <b>✏️ {path}</b>}
        <small className="muted">on ⑂ {branch}</small>
      </div>
      <textarea className="ghx-code-edit" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="File contents" />
      <div className="ghx-commitbox">
        <b>Commit changes</b>
        <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={isNew ? `Create ${path || 'file'}` : `Update ${path.split('/').pop()}`} aria-label="Commit message" />
        {error && <p className="error-text">{error}</p>}
        <span className="row-actions">
          <button className="btn btn-text btn-sm" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="btn btn-primary btn-sm ghx-green" disabled={busy || !path.trim() || path.endsWith('/')} onClick={() => void save()} type="button">
            {busy ? 'Committing…' : 'Commit changes'}
          </button>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------ issues and pull requests */

function Issues({ repo, pulls, openNumber }: { repo: Repo; pulls: boolean; openNumber?: number }) {
  const [state, setState] = useState<'open' | 'closed'>('open');
  const [items, setItems] = useState<Issue[] | null>(null);
  const [open, setOpen] = useState<number | null>(openNumber ?? null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setItems(null);
    gh<Issue[]>(`repos/${repo.full_name}/${pulls ? 'pulls' : 'issues'}?state=${state}&per_page=50`).then(
      (r) => setItems(pulls ? r : r.filter((x) => !x.pull_request)),
      (e) => (setItems([]), setError(errorText(e))),
    );
  }, [repo.full_name, pulls, state]);
  useEffect(load, [load]);
  if (open !== null) return pulls ? <PullView repo={repo} number={open} onBack={() => (setOpen(null), load())} /> : <IssueView repo={repo} number={open} onBack={() => (setOpen(null), load())} />;
  if (creating) return <NewIssue repo={repo} onDone={() => (setCreating(false), load())} />;
  return (
    <div className="ghx-issues">
      <div className="ghx-issuebar">
        <span className="seg">
          <button className={state === 'open' ? 'on' : ''} onClick={() => setState('open')} type="button">
            ◎ Open
          </button>
          <button className={state === 'closed' ? 'on' : ''} onClick={() => setState('closed')} type="button">
            ✓ Closed
          </button>
        </span>
        {!pulls && (
          <button className="btn btn-primary btn-sm ghx-green" onClick={() => setCreating(true)} type="button">
            New issue
          </button>
        )}
      </div>
      <Err text={error} onClose={() => setError(null)} />
      {!items ? (
        <Spinner />
      ) : !items.length ? (
        <p className="gm-empty">No {state} {pulls ? 'pull requests' : 'issues'}.</p>
      ) : (
        <IssueRows items={items} pulls={pulls} onOpen={(i) => setOpen(i.number)} />
      )}
    </div>
  );
}

function IssueRows({ items, pulls, onOpen, showRepo }: { items: Issue[]; pulls: boolean; onOpen(i: Issue): void; showRepo?: boolean }) {
  return (
    <ul className="ghx-list">
      {items.map((i) => (
        <li key={`${i.repository_url}${i.number}`}>
          <span className={`ghx-state ${i.state}`}>{pulls || i.pull_request ? '⇄' : i.state === 'open' ? '◎' : '✓'}</span>
          <div>
            {showRepo && <small className="muted">{repoOf(i.repository_url)}</small>}
            <span>
              <button className="ghx-link" onClick={() => onOpen(i)} type="button">
                {i.title}
              </button>{' '}
              {i.labels.map((l) => (
                <span key={l.name} className="ghx-label" style={{ background: `#${l.color}` }}>
                  {l.name}
                </span>
              ))}
            </span>
            <small className="muted">
              #{i.number} opened {ago(i.created_at)} by {i.user.login}
            </small>
          </div>
          {i.comments > 0 && <small className="muted">💬 {i.comments}</small>}
        </li>
      ))}
    </ul>
  );
}

type IssueComment = { id: number; body: string; user: { login: string; avatar_url: string }; created_at: string };

function Conversation({ repo, number, body, author, created, closable, state, setState }: { repo: Repo; number: number; body: string | null; author: Issue['user']; created: string; closable: boolean; state: string; setState(s: string): void }) {
  const [comments, setComments] = useState<IssueComment[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const base = `repos/${repo.full_name}/issues/${number}`;
  useEffect(() => {
    gh<IssueComment[]>(`${base}/comments?per_page=100`).then(setComments, (e) => (setComments([]), setError(errorText(e))));
  }, [base]);
  const comment = async () => {
    if (!text.trim()) return;
    try {
      const c = await gh<IssueComment>(`${base}/comments`, { method: 'POST', body: { body: text } });
      setComments((cs) => [...(cs ?? []), c]);
      setText('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  const toggle = async () => {
    const next = state === 'open' ? 'closed' : 'open';
    await gh(base, { method: 'PATCH', body: { state: next } }).then(() => setState(next), (e) => setError(errorText(e)));
  };
  return (
    <>
      <Comment who={author} when={created} body={body || '_No description provided._'} />
      {comments?.map((c) => <Comment key={c.id} who={c.user} when={c.created_at} body={c.body} />)}
      <Err text={error} onClose={() => setError(null)} />
      <div className="ghx-reply">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Leave a comment (Markdown supported)" aria-label="Comment" />
        <div className="row-actions ghx-end">
          {closable && (
            <button className="btn btn-outline btn-sm" onClick={() => void toggle()} type="button">
              {state === 'open' ? '✓ Close' : '↺ Reopen'}
            </button>
          )}
          <button className="btn btn-primary btn-sm ghx-green" disabled={!text.trim()} onClick={() => void comment()} type="button">
            Comment
          </button>
        </div>
      </div>
    </>
  );
}

function IssueView({ repo, number, onBack }: { repo: Repo; number: number; onBack(): void }) {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [state, setState] = useState('open');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    gh<Issue>(`repos/${repo.full_name}/issues/${number}`).then((i) => (setIssue(i), setState(i.state)), (e) => setError(errorText(e)));
  }, [repo.full_name, number]);
  if (!issue) return error ? <Err text={error} onClose={() => setError(null)} /> : <Spinner />;
  return (
    <div className="ghx-issue">
      <button className="btn btn-text btn-sm" onClick={onBack} type="button">
        ← All issues
      </button>
      <h2>
        {issue.title} <span className="muted">#{issue.number}</span>
      </h2>
      <p>
        <span className={`ghx-pill ${state}`}>{state === 'open' ? '◎ Open' : '✓ Closed'}</span>{' '}
        <small className="muted">
          {issue.user.login} opened this {ago(issue.created_at)} · <a href={issue.html_url} target="_blank" rel="noreferrer">github.com ↗</a>
        </small>
      </p>
      <Conversation repo={repo} number={number} body={issue.body} author={issue.user} created={issue.created_at} closable state={state} setState={setState} />
    </div>
  );
}

interface Pull extends Issue {
  merged: boolean;
  mergeable: boolean | null;
  head: { ref: string; label: string };
  base: { ref: string };
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
}

function PullView({ repo, number, onBack }: { repo: Repo; number: number; onBack(): void }) {
  const [pr, setPr] = useState<Pull | null>(null);
  const [state, setState] = useState('open');
  const [view, setView] = useState<'conversation' | 'files'>('conversation');
  const [files, setFiles] = useState<{ filename: string; status: string; additions: number; deletions: number; patch?: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    gh<Pull>(`repos/${repo.full_name}/pulls/${number}`).then((p) => (setPr(p), setState(p.merged ? 'merged' : p.state)), (e) => setError(errorText(e)));
  }, [repo.full_name, number]);
  useEffect(load, [load]);
  useEffect(() => {
    if (view === 'files' && !files) gh<NonNullable<typeof files>>(`repos/${repo.full_name}/pulls/${number}/files?per_page=100`).then(setFiles, (e) => (setFiles([]), setError(errorText(e))));
  }, [view, files, repo.full_name, number]);
  const merge = async () => {
    if (!confirm(`Merge pull request #${number} into ${pr?.base.ref}?`)) return;
    setBusy(true);
    try {
      await gh(`repos/${repo.full_name}/pulls/${number}/merge`, { method: 'PUT', body: { merge_method: 'merge' } });
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!pr) return error ? <Err text={error} onClose={() => setError(null)} /> : <Spinner />;
  return (
    <div className="ghx-issue">
      <button className="btn btn-text btn-sm" onClick={onBack} type="button">
        ← All pull requests
      </button>
      <h2>
        {pr.title} <span className="muted">#{pr.number}</span>
      </h2>
      <p>
        <span className={`ghx-pill ${state}`}>{state === 'merged' ? '⇄ Merged' : state === 'open' ? '⇄ Open' : '✓ Closed'}</span>{' '}
        <small className="muted">
          {pr.user.login} wants to merge {pr.commits} commit{pr.commits === 1 ? '' : 's'} into <code>{pr.base.ref}</code> from <code>{pr.head.label}</code>
        </small>
      </p>
      <nav className="ghx-tabs">
        <button className={view === 'conversation' ? 'on' : ''} onClick={() => setView('conversation')} type="button">
          💬 Conversation
        </button>
        <button className={view === 'files' ? 'on' : ''} onClick={() => setView('files')} type="button">
          📄 Files changed {pr.changed_files} <span className="ghx-add">+{pr.additions}</span> <span className="ghx-del">−{pr.deletions}</span>
        </button>
      </nav>
      <Err text={error} onClose={() => setError(null)} />
      {view === 'files' ? (
        !files ? (
          <Spinner />
        ) : (
          files.map((f) => <Diff key={f.filename} name={f.filename} status={f.status} add={f.additions} del={f.deletions} patch={f.patch} />)
        )
      ) : (
        <>
          <Conversation repo={repo} number={number} body={pr.body} author={pr.user} created={pr.created_at} closable={state !== 'merged'} state={state} setState={setState} />
          {state === 'open' && (
            <div className={`ghx-mergebox ${pr.mergeable === false ? 'bad' : ''}`}>
              <b>{pr.mergeable === false ? '⚠️ This branch has conflicts that must be resolved on GitHub.' : '✓ This branch has no conflicts with the base branch.'}</b>
              <button className="btn btn-primary btn-sm ghx-green" disabled={busy || pr.mergeable === false} onClick={() => void merge()} type="button">
                {busy ? 'Merging…' : 'Merge pull request'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Diff({ name, status, add, del, patch }: { name: string; status: string; add: number; del: number; patch?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="ghx-file ghx-diff">
      <div className="ghx-filebar" onClick={() => setOpen(!open)}>
        <span>{open ? '▾' : '▸'}</span>
        <b>{name}</b>
        <small className="muted">{status}</small>
        <span className="ghx-add">+{add}</span>
        <span className="ghx-del">−{del}</span>
      </div>
      {open &&
        (patch ? (
          <pre className="ghx-src">
            {patch.split('\n').map((l, i) => (
              <div key={i} className={l.startsWith('+') ? 'plus' : l.startsWith('-') ? 'minus' : l.startsWith('@@') ? 'hunk' : ''}>
                {l || ' '}
              </div>
            ))}
          </pre>
        ) : (
          <p className="ghx-pad muted">No preview for this change (binary or too large).</p>
        ))}
    </div>
  );
}

function Comment({ who, when, body }: { who: { login: string; avatar_url: string }; when: string; body: string }) {
  return (
    <div className="ghx-comment">
      <img src={who.avatar_url} alt="" />
      <div>
        <header>
          <b>{who.login}</b> <small className="muted">commented {ago(when)}</small>
        </header>
        <Md text={body} />
      </div>
    </div>
  );
}

function NewIssue({ repo, onDone }: { repo: Repo; onDone(): void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try {
      await gh(`repos/${repo.full_name}/issues`, { method: 'POST', body: { title, body } });
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div className="ghx-issue">
      <button className="btn btn-text btn-sm" onClick={onDone} type="button">
        ← Back
      </button>
      <h2>New issue</h2>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" />
      <textarea className="ghx-newbody" value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="Describe the issue (Markdown supported)" aria-label="Description" />
      <Err text={error} onClose={() => setError(null)} />
      <button className="btn btn-primary ghx-green" disabled={!title.trim()} onClick={() => void submit()} type="button">
        Submit new issue
      </button>
    </div>
  );
}

/* ---------------------------------------- commits, branches, releases */

function Commits({ repo }: { repo: Repo }) {
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState(repo.default_branch);
  const [list, setList] = useState<{ sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } }; author: { avatar_url: string; login: string } | null }[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    gh<{ name: string }[]>(`repos/${repo.full_name}/branches?per_page=100`).then((b) => setBranches(b.map((x) => x.name)), () => {});
  }, [repo.full_name]);
  useEffect(() => {
    setList(null);
    gh<NonNullable<typeof list>>(`repos/${repo.full_name}/commits?per_page=50&sha=${encodeURIComponent(branch)}`).then(setList, (e) => (setList([]), setError(errorText(e))));
  }, [repo.full_name, branch]);
  if (open) return <CommitView repo={repo} sha={open} onBack={() => setOpen(null)} />;
  return (
    <div>
      <select className="ghx-branchsel" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
        {(branches.length ? branches : [repo.default_branch]).map((b) => (
          <option key={b}>{b}</option>
        ))}
      </select>
      <Err text={error} onClose={() => setError(null)} />
      {!list ? (
        <Spinner />
      ) : (
        <ul className="ghx-list ghx-commits">
          {list.map((c) => (
            <li key={c.sha}>
              {c.author?.avatar_url ? <img className="ghx-mini" src={c.author.avatar_url} alt="" /> : <span className="ghx-state">⏺</span>}
              <div>
                <button className="ghx-link small" onClick={() => setOpen(c.sha)} type="button">
                  {c.commit.message.split('\n')[0]}
                </button>
                <small className="muted">
                  {c.author?.login ?? c.commit.author.name} committed {ago(c.commit.author.date)}
                </small>
              </div>
              <button className="ghx-sha" onClick={() => setOpen(c.sha)} type="button">
                {c.sha.slice(0, 7)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommitView({ repo, sha, onBack }: { repo: Repo; sha: string; onBack(): void }) {
  const [c, setC] = useState<{ html_url: string; commit: { message: string; author: { name: string; date: string } }; stats: { additions: number; deletions: number }; files: { filename: string; status: string; additions: number; deletions: number; patch?: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    gh<NonNullable<typeof c>>(`repos/${repo.full_name}/commits/${sha}`).then(setC, (e) => setError(errorText(e)));
  }, [repo.full_name, sha]);
  if (!c) return error ? <Err text={error} onClose={() => setError(null)} /> : <Spinner />;
  return (
    <div className="ghx-issue">
      <button className="btn btn-text btn-sm" onClick={onBack} type="button">
        ← All commits
      </button>
      <h2>{c.commit.message.split('\n')[0]}</h2>
      {c.commit.message.includes('\n') && <pre className="ghx-commitmsg">{c.commit.message.split('\n').slice(1).join('\n').trim()}</pre>}
      <p className="muted">
        {c.commit.author.name} committed {ago(c.commit.author.date)} · <code>{sha.slice(0, 7)}</code> · {c.files.length} files changed <span className="ghx-add">+{c.stats.additions}</span> <span className="ghx-del">−{c.stats.deletions}</span> ·{' '}
        <a href={c.html_url} target="_blank" rel="noreferrer">
          github.com ↗
        </a>
      </p>
      {c.files.map((f) => (
        <Diff key={f.filename} name={f.filename} status={f.status} add={f.additions} del={f.deletions} patch={f.patch} />
      ))}
    </div>
  );
}

function Branches({ repo }: { repo: Repo }) {
  const [list, setList] = useState<{ name: string; protected: boolean; commit: { sha: string } }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const load = useCallback(() => {
    gh<NonNullable<typeof list>>(`repos/${repo.full_name}/branches?per_page=100`).then(setList, (e) => (setList([]), setError(errorText(e))));
  }, [repo.full_name]);
  useEffect(load, [load]);
  const create = async () => {
    const from = list?.find((b) => b.name === repo.default_branch);
    if (!from || !name.trim()) return;
    try {
      await gh(`repos/${repo.full_name}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${name.trim()}`, sha: from.commit.sha } });
      setName('');
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const remove = async (b: string) => {
    if (!confirm(`Delete branch ${b}?`)) return;
    await gh(`repos/${repo.full_name}/git/refs/heads/${enc(b)}`, { method: 'DELETE' }).then(load, (e) => setError(errorText(e)));
  };
  return (
    <div>
      {repo.permissions?.push !== false && (
        <form
          className="chat-ask ghx-newbranch"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value.replace(/\s+/g, '-'))} placeholder={`New branch from ${repo.default_branch}`} aria-label="New branch name" />
          <button className="btn btn-primary btn-sm ghx-green" disabled={!name.trim()} type="submit">
            Create branch
          </button>
        </form>
      )}
      <Err text={error} onClose={() => setError(null)} />
      {!list ? (
        <Spinner />
      ) : (
        <ul className="ghx-list">
          {list.map((b) => (
            <li key={b.name}>
              <span className="ghx-state">⑂</span>
              <div>
                <b>{b.name}</b>
                <small className="muted">
                  {b.commit.sha.slice(0, 7)}
                  {b.protected ? ' · 🛡 protected' : ''}
                </small>
              </div>
              {b.name === repo.default_branch ? (
                <span className="ghx-badge">default</span>
              ) : (
                repo.permissions?.push !== false && (
                  <button className="btn btn-text btn-sm ghx-danger" onClick={() => void remove(b.name)} type="button">
                    Delete
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Releases({ repo }: { repo: Repo }) {
  const [list, setList] = useState<{ id: number; name: string | null; tag_name: string; body: string | null; published_at: string; prerelease: boolean; html_url: string; assets: { id: number; name: string; size: number; browser_download_url: string }[] }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    gh<NonNullable<typeof list>>(`repos/${repo.full_name}/releases?per_page=30`).then(setList, (e) => (setList([]), setError(errorText(e))));
  }, [repo.full_name]);
  if (!list) return <Spinner />;
  return (
    <div>
      <Err text={error} onClose={() => setError(null)} />
      {!list.length && <p className="gm-empty">No releases yet.</p>}
      {list.map((r) => (
        <div key={r.id} className="ghx-file ghx-release">
          <div className="ghx-filebar">
            <b>{r.name || r.tag_name}</b> <span className="ghx-badge">{r.tag_name}</span>
            {r.prerelease && <span className="ghx-badge">Pre-release</span>}
            <small className="muted">{ago(r.published_at)}</small>
          </div>
          {r.body && <Md text={r.body} />}
          {r.assets.length > 0 && (
            <ul className="ghx-assets">
              {r.assets.map((a) => (
                <li key={a.id}>
                  <a href={a.browser_download_url}>📦 {a.name}</a> <small className="muted">{Math.round(a.size / 1024)} KB</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------- your issues, pull requests */

function MyIssues({ me, go, pulls }: { me: User | null; go(n: Nav): void; pulls: boolean }) {
  const [filter, setFilter] = useState(pulls ? 'author' : 'created');
  const [state, setState] = useState<'open' | 'closed'>('open');
  const [items, setItems] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!me) return;
    setItems(null);
    const q = pulls ? `is:pr ${filter === 'review' ? 'review-requested' : filter}:${me.login} is:${state}` : `is:issue ${filter === 'created' ? 'author' : filter === 'mentioned' ? 'mentions' : 'assignee'}:${me.login} is:${state}`;
    gh<{ items: Issue[] }>(`search/issues?q=${encodeURIComponent(q)}&per_page=50&sort=updated`).then(
      (r) => setItems(r.items),
      (e) => (setItems([]), setError(errorText(e))),
    );
  }, [me, filter, state, pulls]);
  const tabs = pulls
    ? [
        ['author', 'Created'],
        ['assignee', 'Assigned'],
        ['review', 'Review requests'],
        ['mentions', 'Mentioned'],
      ]
    : [
        ['created', 'Created'],
        ['assigned', 'Assigned'],
        ['mentioned', 'Mentioned'],
      ];
  return (
    <div className="ghx-pad">
      <div className="ghx-issuebar">
        <span className="seg">
          {tabs.map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)} type="button">
              {l}
            </button>
          ))}
        </span>
        <span className="seg">
          <button className={state === 'open' ? 'on' : ''} onClick={() => setState('open')} type="button">
            Open
          </button>
          <button className={state === 'closed' ? 'on' : ''} onClick={() => setState('closed')} type="button">
            Closed
          </button>
        </span>
      </div>
      <Err text={error} onClose={() => setError(null)} />
      {!items ? (
        <Spinner />
      ) : !items.length ? (
        <p className="gm-empty">Nothing here.</p>
      ) : (
        <IssueRows items={items} pulls={pulls} showRepo onOpen={(i) => go({ v: 'repo', name: repoOf(i.repository_url), ...(pulls || i.pull_request ? { pull: i.number } : { issue: i.number }) })} />
      )}
    </div>
  );
}

/* -------------------------------------------------------- notifications */

function Notifications({ go, onCount }: { go(n: Nav): void; onCount(n: number): void }) {
  const [all, setAll] = useState(false);
  const [list, setList] = useState<{ id: string; unread: boolean; reason: string; updated_at: string; subject: { title: string; type: string; url: string | null }; repository: { full_name: string; owner: { avatar_url: string } } }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setList(null);
    gh<NonNullable<typeof list>>(`notifications?per_page=50&all=${all}`).then(
      (r) => {
        setList(r);
        if (!all) onCount(r.length);
      },
      (e) => (setList([]), setError(errorText(e))),
    );
  }, [all, onCount]);
  useEffect(load, [load]);
  const read = async (id: string) => {
    setList((l) => l?.map((n) => (n.id === id ? { ...n, unread: false } : n)) ?? null);
    await gh(`notifications/threads/${id}`, { method: 'PATCH' }).catch(() => {});
  };
  const readAll = async () => {
    await gh('notifications', { method: 'PUT', body: {} }).catch((e) => setError(errorText(e)));
    load();
  };
  const open = (n: NonNullable<typeof list>[number]) => {
    void read(n.id);
    const num = Number(/\/(?:issues|pulls)\/(\d+)$/.exec(n.subject.url ?? '')?.[1]);
    go({ v: 'repo', name: n.repository.full_name, ...(num ? (n.subject.type === 'PullRequest' ? { pull: num } : { issue: num }) : {}) });
  };
  return (
    <div className="ghx-pad">
      <div className="ghx-issuebar">
        <span className="seg">
          <button className={!all ? 'on' : ''} onClick={() => setAll(false)} type="button">
            Unread
          </button>
          <button className={all ? 'on' : ''} onClick={() => setAll(true)} type="button">
            All
          </button>
        </span>
        <button className="btn btn-outline btn-sm" onClick={() => void readAll()} type="button">
          ✓ Mark all as read
        </button>
      </div>
      <Err text={error} onClose={() => setError(null)} />
      {!list ? (
        <Spinner />
      ) : !list.length ? (
        <p className="gm-empty">All caught up! 🎉</p>
      ) : (
        <ul className="ghx-list">
          {list.map((n) => (
            <li key={n.id} className={n.unread ? 'ghx-unread' : ''}>
              <img className="ghx-mini" src={n.repository.owner.avatar_url} alt="" />
              <div>
                <small className="muted">{n.repository.full_name}</small>
                <button className="ghx-link small" onClick={() => open(n)} type="button">
                  {n.subject.type === 'PullRequest' ? '⇄' : n.subject.type === 'Issue' ? '◎' : '•'} {n.subject.title}
                </button>
                <small className="muted">
                  {n.reason.replace(/_/g, ' ')} · {ago(n.updated_at)}
                </small>
              </div>
              {n.unread && (
                <button className="btn btn-text btn-sm" onClick={() => void read(n.id)} title="Mark as read" type="button">
                  ✓
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------- stars, explore */

function Stars({ go }: { go(n: Nav): void }) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    gh<Repo[]>('user/starred?per_page=100').then(setRepos, (e) => (setRepos([]), setError(errorText(e))));
  }, []);
  return (
    <div className="ghx-pad">
      <Err text={error} onClose={() => setError(null)} />
      {!repos ? <Spinner /> : <RepoRows repos={repos} go={go} empty="You have not starred any repositories yet." />}
    </div>
  );
}

function Explore({ q, go }: { q?: string; go(n: Nav): void }) {
  const [text, setText] = useState(q ?? '');
  const [search, setSearch] = useState(q ?? '');
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSearch(q ?? ''), [q]);
  useEffect(() => {
    setRepos(null);
    const week = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const query = search || `created:>${week}`;
    gh<{ items: Repo[] }>(`search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=30`).then(
      (r) => setRepos(r.items),
      (e) => (setRepos([]), setError(errorText(e))),
    );
  }, [search]);
  return (
    <div className="ghx-pad">
      <form
        className="ghx-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(text.trim());
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search repositories, e.g. react calendar language:typescript" aria-label="Search repositories" />
        <button className="btn btn-primary btn-sm" type="submit">
          Search
        </button>
      </form>
      <h3>{search ? `Repositories matching “${search}”` : '🔥 Trending this week'}</h3>
      <Err text={error} onClose={() => setError(null)} />
      {!repos ? <Spinner /> : <RepoRows repos={repos} go={go} empty="No repositories found." />}
    </div>
  );
}
