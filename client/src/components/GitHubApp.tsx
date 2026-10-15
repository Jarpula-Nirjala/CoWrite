import { useEffect, useState } from 'react';
import { markdownToTokens } from '../../../shared/rich.ts';
import { api, errorText } from '../api.ts';
import { appApi } from '../lib/google.ts';
import { createAndOpen } from '../lib/create.ts';
import { renderMarkdown } from '../lib/text.ts';
import { AppLogo } from './AppLogo.tsx';
import { Spinner } from './ui.tsx';

interface Me {
  login: string;
  name: string | null;
  avatar_url: string;
  bio: string | null;
  followers: number;
  following: number;
  public_repos: number;
  html_url: string;
}
interface Repo {
  full_name: string;
  name: string;
  private: boolean;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  updated_at: string;
  default_branch: string;
  html_url: string;
}
interface Item {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
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
}
type Tab = 'code' | 'issues' | 'pulls' | 'commits';

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
const LANG: Record<string, string> = { TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Java: '#b07219', HTML: '#e34c26', CSS: '#563d7c', 'C++': '#f34b7d', C: '#555555', Go: '#00ADD8', Rust: '#dea584', Kotlin: '#A97BFF', Dart: '#00B4AB', 'Jupyter Notebook': '#DA5B0B' };
const decode64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** GitHub inside CoWrite: your profile, repositories (code, issues, pull requests, commits) and gists. */
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
  const [me, setMe] = useState<Me | null>(null);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [filter, setFilter] = useState('');
  const [repo, setRepo] = useState<Repo | null>(null);
  const [gists, setGists] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    gh<Me>('user').then(setMe, (e) => setError(errorText(e)));
    gh<Repo[]>('user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member').then(setRepos, (e) => (setRepos([]), setError(errorText(e))));
  }, []);
  const shown = (repos ?? []).filter((r) => r.full_name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="ghx">
      <header className="ghx-top">
        <button className="ghx-logo" onClick={() => (setRepo(null), setGists(false))} type="button" aria-label="GitHub home">
          <AppLogo name="github" size={30} />
        </button>
        <b className="ghx-crumb">
          {repo ? (
            <>
              <button onClick={() => setRepo(null)} type="button">
                {repo.full_name.split('/')[0]}
              </button>{' '}
              / <b>{repo.name}</b>
            </>
          ) : gists ? (
            'Gists'
          ) : (
            'Dashboard'
          )}
        </b>
        <input className="ghx-search" value={filter} onChange={(e) => (setFilter(e.target.value), setRepo(null), setGists(false))} placeholder="Find a repository…" aria-label="Find a repository" />
        {me && <img className="ghx-avatar" src={me.avatar_url} alt={me.login} />}
      </header>
      {error && <p className="error-text gm-error">{error}</p>}
      {repo ? (
        <RepoView repo={repo} />
      ) : gists ? (
        <Gists />
      ) : (
        <div className="ghx-home">
          <aside className="ghx-profile">
            {me ? (
              <>
                <img src={me.avatar_url} alt="" />
                <h2>{me.name ?? me.login}</h2>
                <p className="muted">{me.login}</p>
                {me.bio && <p>{me.bio}</p>}
                <p className="muted small">
                  👥 <b>{me.followers}</b> followers · <b>{me.following}</b> following
                </p>
                <a className="btn btn-outline btn-sm" href={me.html_url} target="_blank" rel="noreferrer">
                  View profile on GitHub ↗
                </a>
                <button className="btn btn-text btn-sm" onClick={() => setGists(true)} type="button">
                  📝 Your gists
                </button>
              </>
            ) : (
              <Spinner />
            )}
          </aside>
          <section className="ghx-repos">
            <h3>Repositories {repos && <span className="ghx-count">{repos.length}</span>}</h3>
            {!repos ? (
              <Spinner />
            ) : (
              <ul>
                {shown.map((r) => (
                  <li key={r.full_name}>
                    <div>
                      <button className="ghx-link" onClick={() => setRepo(r)} type="button">
                        {r.name}
                      </button>{' '}
                      <span className="ghx-badge">{r.private ? 'Private' : 'Public'}</span>
                      {r.description && <p className="muted">{r.description}</p>}
                      <small className="muted">
                        {r.language && (
                          <>
                            <span className="ghx-lang" style={{ background: LANG[r.language] ?? '#8b949e' }} /> {r.language} ·{' '}
                          </>
                        )}
                        ⭐ {r.stargazers_count} · 🍴 {r.forks_count} · Updated {ago(r.updated_at)}
                      </small>
                    </div>
                  </li>
                ))}
                {!shown.length && <li className="muted">No repositories match.</li>}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function RepoView({ repo }: { repo: Repo }) {
  const [tab, setTab] = useState<Tab>('code');
  return (
    <div className="ghx-repo">
      <div className="ghx-repohead">
        <h2>
          📘 {repo.full_name} <span className="ghx-badge">{repo.private ? 'Private' : 'Public'}</span>
        </h2>
        <span className="ghx-stats">
          ⭐ {repo.stargazers_count} · 🍴 {repo.forks_count}{' '}
          <a className="btn btn-outline btn-sm" href={repo.html_url} target="_blank" rel="noreferrer">
            Open on GitHub ↗
          </a>
        </span>
      </div>
      <nav className="ghx-tabs">
        {(
          [
            ['code', '<> Code'],
            ['issues', '◎ Issues'],
            ['pulls', '⇄ Pull requests'],
            ['commits', '⏱ Commits'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} type="button">
            {l}
          </button>
        ))}
      </nav>
      {tab === 'code' ? <Code repo={repo} /> : tab === 'commits' ? <Commits repo={repo} /> : <Issues repo={repo} pulls={tab === 'pulls'} />}
    </div>
  );
}

function Code({ repo }: { repo: Repo }) {
  const [path, setPath] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [file, setFile] = useState<{ name: string; path: string; text: string } | null>(null);
  const [readme, setReadme] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setItems(null);
    setFile(null);
    gh<Item[]>(`repos/${repo.full_name}/contents/${enc(path)}`).then(
      (r) => {
        const list = (Array.isArray(r) ? r : []).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
        setItems(list);
        const rd = list.find((x) => /^readme(\.md)?$/i.test(x.name));
        setReadme(null);
        if (rd) gh<{ content: string }>(`repos/${repo.full_name}/contents/${enc(rd.path)}`).then((f) => setReadme(decode64(f.content)), () => {});
      },
      (e) => (setItems([]), setError(errorText(e))),
    );
  }, [repo.full_name, path]);
  const openFile = async (it: Item) => {
    if (it.size > 1_000_000) return setError('This file is too large to show here. Open it on GitHub.');
    try {
      const f = await gh<{ content: string; name: string; path: string }>(`repos/${repo.full_name}/contents/${enc(it.path)}`);
      setFile({ name: f.name, path: f.path, text: decode64(f.content) });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const crumbs = path ? path.split('/') : [];
  return (
    <div className="ghx-code">
      <div className="ghx-path">
        <span className="ghx-branch">⑂ {repo.default_branch}</span>
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
      </div>
      {error && (
        <p className="error-text" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {file ? (
        <div className="ghx-file">
          <div className="ghx-filebar">
            <b>{file.name}</b>
            <small className="muted">{file.text.split('\n').length} lines</small>
            <span className="row-actions">
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
              <button className="btn btn-text btn-sm" onClick={() => setFile(null)} type="button">
                Close
              </button>
            </span>
          </div>
          {/\.(md|markdown)$/i.test(file.name) ? (
            <article className="ghx-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(file.text) }} />
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
          {readme && (
            <section className="ghx-readme">
              <header>📖 README</header>
              <article className="ghx-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(readme) }} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Issues({ repo, pulls }: { repo: Repo; pulls: boolean }) {
  const [state, setState] = useState<'open' | 'closed'>('open');
  const [items, setItems] = useState<Issue[] | null>(null);
  const [open, setOpen] = useState<Issue | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setItems(null);
    gh<Issue[]>(`repos/${repo.full_name}/${pulls ? 'pulls' : 'issues'}?state=${state}&per_page=50`).then(
      (r) => setItems(pulls ? r : r.filter((x) => !x.pull_request)),
      (e) => (setItems([]), setError(errorText(e))),
    );
  };
  useEffect(load, [repo.full_name, pulls, state]);
  if (open) return <IssueView repo={repo} issue={open} pull={pulls} onBack={() => (setOpen(null), load())} />;
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
      {error && <p className="error-text">{error}</p>}
      {!items ? (
        <Spinner />
      ) : !items.length ? (
        <p className="gm-empty">No {state} {pulls ? 'pull requests' : 'issues'}.</p>
      ) : (
        <ul className="ghx-list">
          {items.map((i) => (
            <li key={i.number}>
              <span className={`ghx-state ${i.state}`}>{pulls ? '⇄' : i.state === 'open' ? '◎' : '✓'}</span>
              <div>
                <button className="ghx-link" onClick={() => setOpen(i)} type="button">
                  {i.title}
                </button>{' '}
                {i.labels.map((l) => (
                  <span key={l.name} className="ghx-label" style={{ background: `#${l.color}` }}>
                    {l.name}
                  </span>
                ))}
                <small className="muted">
                  #{i.number} opened {ago(i.created_at)} by {i.user.login}
                </small>
              </div>
              {i.comments > 0 && <small className="muted">💬 {i.comments}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IssueView({ repo, issue, pull, onBack }: { repo: Repo; issue: Issue; pull: boolean; onBack(): void }) {
  const [comments, setComments] = useState<{ id: number; body: string; user: { login: string; avatar_url: string }; created_at: string }[] | null>(null);
  const [text, setText] = useState('');
  const [state, setState] = useState(issue.state);
  const [error, setError] = useState<string | null>(null);
  const base = `repos/${repo.full_name}/issues/${issue.number}`;
  useEffect(() => {
    gh<typeof comments>(`${base}/comments?per_page=100`).then(setComments, (e) => (setComments([]), setError(errorText(e))));
  }, [base]);
  const comment = async () => {
    if (!text.trim()) return;
    try {
      const c = await gh<NonNullable<typeof comments>[number]>(`${base}/comments`, { method: 'POST', body: { body: text } });
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
    <div className="ghx-issue">
      <button className="btn btn-text btn-sm" onClick={onBack} type="button">
        ← All {pull ? 'pull requests' : 'issues'}
      </button>
      <h2>
        {issue.title} <span className="muted">#{issue.number}</span>
      </h2>
      <p>
        <span className={`ghx-pill ${state}`}>{state === 'open' ? '◎ Open' : '✓ Closed'}</span>{' '}
        <small className="muted">
          {issue.user.login} opened this {ago(issue.created_at)}
        </small>
      </p>
      <Comment who={issue.user} when={issue.created_at} body={issue.body ?? '_No description provided._'} />
      {comments?.map((c) => <Comment key={c.id} who={c.user} when={c.created_at} body={c.body} />)}
      {error && <p className="error-text">{error}</p>}
      <div className="ghx-reply">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Leave a comment (Markdown supported)" aria-label="Comment" />
        <div className="row-between">
          <a className="btn btn-text btn-sm" href={issue.html_url} target="_blank" rel="noreferrer">
            Open on GitHub ↗
          </a>
          <span className="row-actions">
            {!pull && (
              <button className="btn btn-outline btn-sm" onClick={() => void toggle()} type="button">
                {state === 'open' ? '✓ Close issue' : '↺ Reopen issue'}
              </button>
            )}
            <button className="btn btn-primary btn-sm ghx-green" disabled={!text.trim()} onClick={() => void comment()} type="button">
              Comment
            </button>
          </span>
        </div>
      </div>
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
        <article className="ghx-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
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
      {error && <p className="error-text">{error}</p>}
      <button className="btn btn-primary ghx-green" disabled={!title.trim()} onClick={() => void submit()} type="button">
        Submit new issue
      </button>
    </div>
  );
}

function Commits({ repo }: { repo: Repo }) {
  const [list, setList] = useState<{ sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } }; author: { avatar_url: string } | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    gh<typeof list>(`repos/${repo.full_name}/commits?per_page=40`).then(setList, (e) => (setList([]), setError(errorText(e))));
  }, [repo.full_name]);
  if (!list) return <Spinner />;
  return (
    <>
      {error && <p className="error-text">{error}</p>}
      <ul className="ghx-list">
        {list.map((c) => (
          <li key={c.sha}>
            {c.author?.avatar_url ? <img className="ghx-mini" src={c.author.avatar_url} alt="" /> : <span className="ghx-state">⏺</span>}
            <div>
              <b>{c.commit.message.split('\n')[0]}</b>
              <small className="muted">
                {c.commit.author.name} committed {ago(c.commit.author.date)}
              </small>
            </div>
            <a className="ghx-sha" href={c.html_url} target="_blank" rel="noreferrer">
              {c.sha.slice(0, 7)}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function Gists() {
  const [list, setList] = useState<{ id: string; description: string | null; html_url: string; updated_at: string; public: boolean; files: Record<string, { filename: string }> }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    gh<typeof list>('gists?per_page=50').then(setList, (e) => (setList([]), setError(errorText(e))));
  }, []);
  if (!list) return <Spinner />;
  return (
    <div className="ghx-repos ghx-gists">
      {error && <p className="error-text">{error}</p>}
      <ul>
        {list.map((g) => (
          <li key={g.id}>
            <div>
              <a className="ghx-link" href={g.html_url} target="_blank" rel="noreferrer">
                {g.description || Object.keys(g.files)[0]}
              </a>{' '}
              <span className="ghx-badge">{g.public ? 'Public' : 'Secret'}</span>
              <p className="muted">{Object.keys(g.files).join(', ')}</p>
              <small className="muted">Updated {ago(g.updated_at)}</small>
            </div>
          </li>
        ))}
        {!list.length && <li className="muted">No gists yet.</li>}
      </ul>
    </div>
  );
}
