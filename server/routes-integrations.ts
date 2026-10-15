import express from 'express';
import { marked } from 'marked';
import { toMarkdown } from '../shared/rich.ts';
import { docAccess, type AppCtx } from './context.ts';
import { HttpError, publicUrl, rateLimit, requireUser, str } from './http.ts';
import { clientSource, enabledProviders, GOOGLE_EXTRAS, LINK_SCOPES, pickerConfig, refreshGoogle, saveOAuthClient, savedClient, type OAuthTokens, type Provider } from './oauth.ts';

interface Row {
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null;
  scope: string;
  account: Record<string, unknown>;
  via: string;
}

/** Owners can set up Google and GitHub for everyone: emails listed in ADMIN_EMAILS. */
export const isOwner = (email: string) =>
  (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());

/** Stores a linked account's tokens, sealed with the vault key. */
export async function saveIntegration(ctx: AppCtx, userId: string, p: Provider, t: OAuthTokens, account: Record<string, unknown>, via: 'oauth' | 'token') {
  await ctx.db.query(
    `insert into integrations (user_id, provider, access_token, refresh_token, expires_at, scope, account, via, created_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     on conflict (user_id, provider) do update set access_token = excluded.access_token,
       refresh_token = coalesce(excluded.refresh_token, integrations.refresh_token), expires_at = excluded.expires_at,
       scope = excluded.scope, account = excluded.account, via = excluded.via`,
    [userId, p, await ctx.vault.seal(t.access), t.refresh ? await ctx.vault.seal(t.refresh) : null, t.expiresAt, t.scope, JSON.stringify(account), via, Date.now()],
  );
}

/** Google, GitHub: linked accounts, their files, and sending documents to them. */
export function integrationRoutes(ctx: AppCtx) {
  const r = express.Router();
  const { db, vault } = ctx;
  const limiter = rateLimit(120, 60_000);

  const row = async (userId: string, p: Provider) => (await db.query<Row>('select * from integrations where user_id = $1 and provider = $2', [userId, p]))[0] ?? null;

  /** A usable access token, refreshing Google's when it has expired. */
  async function token(userId: string, p: Provider): Promise<string> {
    const it = await row(userId, p);
    if (!it) throw new HttpError(400, `Connect your ${p === 'google' ? 'Google' : 'GitHub'} account first (Account → Connected accounts).`);
    const access = await vault.open(it.access_token);
    if (!access) throw new HttpError(400, 'The saved connection could not be read. Please connect again.');
    if (p === 'google' && it.expires_at && it.expires_at < Date.now() + 60_000) {
      const refresh = it.refresh_token ? await vault.open(it.refresh_token) : null;
      if (!refresh) throw new HttpError(400, 'Your Google connection has expired. Connect Google again.');
      try {
        const fresh = await refreshGoogle(refresh);
        await db.query('update integrations set access_token = $3, expires_at = $4 where user_id = $1 and provider = $2', [userId, p, await vault.seal(fresh.access), fresh.expiresAt]);
        return fresh.access;
      } catch {
        throw new HttpError(400, 'Google no longer accepts this connection. Connect Google again.');
      }
    }
    return access;
  }

  async function call<T>(p: Provider, access: string, url: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> =
      p === 'github'
        ? { authorization: `Bearer ${access}`, accept: 'application/vnd.github+json', 'user-agent': 'CoWrite', 'x-github-api-version': '2022-11-28' }
        : { authorization: `Bearer ${access}` };
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new HttpError(502, `Could not reach ${p === 'google' ? 'Google' : 'GitHub'}. Please try again.`);
    }
    if (res.status === 401) throw new HttpError(400, `${p === 'google' ? 'Google' : 'GitHub'} no longer accepts the connection. Connect it again.`);
    if (res.status === 403) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: { message?: string }; message?: string });
      throw new HttpError(403, msg.error?.message ?? msg.message ?? 'Permission denied. Reconnect and allow the requested access.');
    }
    if (res.status === 404) throw new HttpError(404, 'Not found, or this account cannot see it.');
    if (!res.ok) throw new HttpError(502, `${p === 'google' ? 'Google' : 'GitHub'} returned an error (${res.status}).`);
    return (res.headers.get('content-type') ?? '').includes('json') ? ((await res.json()) as T) : ((await res.text()) as unknown as T);
  }

  // ---------------------------------------------------------------- status

  r.get('/integrations', async (req, res) => {
    const user = requireUser(res);
    const rows = await db.query<Row & { provider: Provider; created_at: number }>('select * from integrations where user_id = $1', [user.id]);
    const by = (p: Provider) => rows.find((x) => x.provider === p);
    const out = (p: Provider) => {
      const it = by(p);
      return {
        configured: enabledProviders().includes(p),
        source: clientSource(p),
        signIn: (p === 'google' ? user.google_id : user.github_id) !== null,
        connected: !!it,
        via: it?.via ?? null,
        account: it?.account ?? null,
        since: it?.created_at ?? null,
        redirectUri: `${publicUrl(req)}/api/auth/oauth/${p}/callback`,
        // Which optional Google features this connection has permission for.
        picker: p === 'google' && !!pickerConfig(),
        features: p === 'google' && it ? Object.fromEntries(Object.entries(GOOGLE_EXTRAS).map(([k, scopes]) => [k, scopes.every((sc) => it.scope.includes(sc))])) : {},
        scopes: LINK_SCOPES[p],
      };
    };
    res.json({ owner: isOwner(user.email), google: out('google'), github: out('github'), origin: publicUrl(req) });
  });

  r.delete('/integrations/:p', async (req, res) => {
    const user = requireUser(res);
    await db.query('delete from integrations where user_id = $1 and provider = $2', [user.id, String(req.params.p)]);
    res.json({ ok: true });
  });

  /** The site owner saves an OAuth client so everyone can sign in with and connect that service. */
  r.put('/integrations/setup/:p', async (req, res) => {
    const user = requireUser(res);
    if (!isOwner(user.email)) throw new HttpError(403, 'Only the site owner can set this up.');
    const p = req.params.p === 'github' ? 'github' : req.params.p === 'google' ? 'google' : null;
    if (!p) throw new HttpError(404, 'Unknown service.');
    if (req.body?.clear === true) {
      await saveOAuthClient(db, vault, p, null);
      res.json({ ok: true });
      return;
    }
    const id = str(req.body?.clientId, 300).trim();
    const secret = str(req.body?.clientSecret, 300).trim();
    const pickerKey = str(req.body?.pickerKey, 200).trim();
    // Only the picker key: keep the saved client and add the key.
    if (!id && !secret && pickerKey) {
      const current = savedClient(p);
      if (!current) throw new HttpError(400, 'Save the client ID and secret first.');
      await saveOAuthClient(db, vault, p, { ...current, pickerKey });
      res.json({ ok: true });
      return;
    }
    if (id.length < 8 || secret.length < 8) throw new HttpError(400, 'Paste both the client ID and the client secret.');
    if (p === 'google' && !id.endsWith('.apps.googleusercontent.com')) throw new HttpError(400, 'A Google client ID ends with “.apps.googleusercontent.com”.');
    await saveOAuthClient(db, vault, p, { id, secret, ...(pickerKey || savedClient(p)?.pickerKey ? { pickerKey: pickerKey || savedClient(p)?.pickerKey } : {}) });
    res.json({ ok: true });
  });

  // ----------------------------------------------------------------- GitHub

  /** Connect GitHub with a personal access token (works without any server setup). */
  r.post('/integrations/github/token', rateLimit(10, 10 * 60_000), async (req, res) => {
    const user = requireUser(res);
    const t = str(req.body?.token, 300).replace(/\s+/g, '');
    if (!/^(ghp_|github_pat_|gho_)[\w]{20,}$/.test(t)) throw new HttpError(400, 'GitHub tokens start with “ghp_” or “github_pat_”. Create one with the button above and paste it here.');
    let me: { login: string; name: string | null; avatar_url: string; html_url: string };
    let scope = '';
    try {
      const resp = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${t}`, 'user-agent': 'CoWrite', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) throw new HttpError(400, 'GitHub did not accept this token. Check that it has not expired and copy it again.');
      me = (await resp.json()) as typeof me;
      scope = resp.headers.get('x-oauth-scopes') ?? 'fine-grained';
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, 'Could not reach GitHub. Please try again.');
    }
    const account = { login: me.login, name: me.name ?? me.login, avatar: me.avatar_url, url: me.html_url };
    await saveIntegration(ctx, user.id, 'github', { access: t, refresh: null, expiresAt: null, scope }, account, 'token');
    res.json({ account });
  });

  r.get('/integrations/github/repos', limiter, async (_req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'github');
    const repos = await call<{ full_name: string; name: string; private: boolean; description: string | null; updated_at: string; default_branch: string; html_url: string; language: string | null }[]>(
      'github',
      t,
      'https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
    );
    res.json({
      repos: repos.map((x) => ({ fullName: x.full_name, name: x.name, private: x.private, description: x.description ?? '', updatedAt: x.updated_at, branch: x.default_branch, url: x.html_url, language: x.language })),
    });
  });

  const repoName = (v: unknown) => {
    const s = str(v, 200);
    if (!/^[\w.-]+\/[\w.-]+$/.test(s)) throw new HttpError(400, 'Choose a repository.');
    return s;
  };
  const repoPath = (v: unknown) =>
    str(v, 500)
      .split('/')
      .filter((x) => x && x !== '.' && x !== '..')
      .map(encodeURIComponent)
      .join('/');

  r.get('/integrations/github/tree', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'github');
    const list = await call<{ name: string; path: string; type: string; size: number }[] | { type: string }>('github', t, `https://api.github.com/repos/${repoName(req.query.repo)}/contents/${repoPath(req.query.path)}`);
    if (!Array.isArray(list)) throw new HttpError(400, 'That is a file, not a folder.');
    res.json({ items: list.map((x) => ({ name: x.name, path: x.path, type: x.type === 'dir' ? 'dir' : 'file', size: x.size })).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1)) });
  });

  r.get('/integrations/github/file', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'github');
    const f = await call<{ name: string; content?: string; encoding?: string; size: number; html_url: string }>('github', t, `https://api.github.com/repos/${repoName(req.query.repo)}/contents/${repoPath(req.query.path)}`);
    if (!f.content || f.size > 1_000_000) throw new HttpError(400, 'Only text files under 1 MB can be opened.');
    const text = Buffer.from(f.content, 'base64').toString('utf8');
    if (text.includes('\u0000')) throw new HttpError(400, 'That looks like a binary file, not text.');
    res.json({ name: f.name, text, url: f.html_url });
  });

  r.get('/integrations/github/gists', limiter, async (_req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'github');
    const gists = await call<{ id: string; description: string | null; public: boolean; updated_at: string; html_url: string; files: Record<string, { filename: string; language: string | null }> }[]>(
      'github',
      t,
      'https://api.github.com/gists?per_page=100',
    );
    res.json({ gists: gists.map((g) => ({ id: g.id, title: g.description || Object.keys(g.files)[0] || 'Untitled gist', public: g.public, updatedAt: g.updated_at, url: g.html_url, files: Object.keys(g.files) })) });
  });

  r.get('/integrations/github/gist/:id', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'github');
    const g = await call<{ description: string | null; files: Record<string, { filename: string; content: string; language: string | null }> }>('github', t, `https://api.github.com/gists/${encodeURIComponent(String(req.params.id))}`);
    const files = Object.values(g.files);
    const md = files.map((f) => (/\.(md|markdown|txt)$/i.test(f.filename) || !f.language ? f.content : `## ${f.filename}\n\`\`\`${(f.language ?? '').toLowerCase()}\n${f.content}\n\`\`\``)).join('\n\n');
    res.json({ title: g.description || files[0]?.filename || 'Gist', text: md });
  });

  // ------------------------------------------------------------------ Google

  const DOC = 'application/vnd.google-apps.document';
  r.get('/integrations/google/files', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    const words = str(req.query.q, 100).replace(/['\\]/g, '');
    const q = [`trashed = false`, `(mimeType = '${DOC}' or mimeType = 'text/plain' or mimeType = 'text/markdown' or mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.presentation' or mimeType = 'application/pdf')`, words ? `name contains '${words}'` : ''].filter(Boolean).join(' and ');
    const out = await call<{ files: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string; iconLink: string; owners?: { displayName: string }[] }[] }>(
      'google',
      t,
      `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, orderBy: 'modifiedTime desc', pageSize: '60', fields: 'files(id,name,mimeType,modifiedTime,webViewLink,iconLink,owners(displayName))' })}`,
    );
    res.json({
      files: out.files.map((f) => ({
        id: f.id,
        name: f.name,
        kind: f.mimeType === DOC ? 'doc' : f.mimeType.includes('spreadsheet') ? 'sheet' : f.mimeType.includes('presentation') ? 'slides' : f.mimeType === 'application/pdf' ? 'pdf' : 'text',
        modified: f.modifiedTime,
        url: f.webViewLink,
        owner: f.owners?.[0]?.displayName ?? '',
      })),
    });
  });

  r.get('/integrations/google/file/:id', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    const id = encodeURIComponent(String(req.params.id));
    const meta = await call<{ name: string; mimeType: string }>('google', t, `https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType`);
    let text: string;
    if (meta.mimeType === DOC) text = await call<string>('google', t, `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text%2Fmarkdown`);
    else if (meta.mimeType.includes('spreadsheet')) text = await call<string>('google', t, `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text%2Fcsv`);
    else if (meta.mimeType.includes('presentation')) text = await call<string>('google', t, `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text%2Fplain`);
    else if (meta.mimeType.startsWith('text/')) text = await call<string>('google', t, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    else throw new HttpError(400, 'Open PDFs with the PDF tools in AI Tools; this importer reads Docs, Sheets, Slides and text files.');
    res.json({ name: meta.name.replace(/\.(md|txt)$/i, ''), mimeType: meta.mimeType, text: String(text).slice(0, 500_000) });
  });

  r.get('/integrations/google/calendar', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const from = day.test(String(req.query.from)) ? String(req.query.from) : new Date().toISOString().slice(0, 10);
    const to = day.test(String(req.query.to)) ? String(req.query.to) : from;
    const out = await call<{ items: { id: string; summary?: string; htmlLink: string; start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string }; location?: string }[] }>(
      'google',
      t,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({ timeMin: `${from}T00:00:00Z`, timeMax: `${to}T23:59:59Z`, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' })}`,
    );
    res.json({
      events: out.items.map((e) => ({
        id: e.id,
        title: e.summary ?? '(No title)',
        url: e.htmlLink,
        allDay: !!e.start.date,
        start: e.start.dateTime ?? e.start.date ?? '',
        end: e.end.dateTime ?? e.end.date ?? '',
        location: e.location ?? '',
      })),
    });
  });

  // ------------------------------------------------ send a document out

  async function markdownOf(docId: string) {
    const room = await ctx.rooms.open(docId);
    if (!room) throw new HttpError(503, 'Server busy, try again.');
    if (room.encrypted) throw new HttpError(400, 'End-to-end encrypted documents cannot be sent to other services, because the server cannot read them.');
    return toMarkdown(room.doc.tokens());
  }
  const fileName = (title: string) => `${title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'document'}.md`;

  r.post('/docs/:id/send/gist', rateLimit(20, 10 * 60_000), async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const t = await token(a.user!.id, 'github');
    const title = a.doc?.title ?? 'Document';
    const g = await call<{ html_url: string }>('github', t, 'https://api.github.com/gists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: title, public: req.body?.public === true, files: { [fileName(title)]: { content: (await markdownOf(a.docId)) || ' ' } } }),
    });
    res.json({ url: g.html_url });
  });

  r.post('/docs/:id/send/github', rateLimit(20, 10 * 60_000), async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const t = await token(a.user!.id, 'github');
    const repo = repoName(req.body?.repo);
    const title = a.doc?.title ?? 'Document';
    const path = repoPath(req.body?.path || fileName(title));
    if (!path) throw new HttpError(400, 'Choose a file path.');
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;
    const existing = await call<{ sha: string }>('github', t, url).catch((e) => (e instanceof HttpError && e.status === 404 ? null : Promise.reject(e)));
    const out = await call<{ content: { html_url: string } }>('github', t, url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: str(req.body?.message, 200) || `Update ${title} from CoWrite`, content: Buffer.from(await markdownOf(a.docId)).toString('base64'), ...(existing ? { sha: existing.sha } : {}) }),
    });
    res.json({ url: out.content.html_url, updated: !!existing });
  });

  r.post('/docs/:id/send/google', rateLimit(20, 10 * 60_000), async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const t = await token(a.user!.id, 'google');
    const boundary = `cowrite${Date.now()}`;
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ name: a.doc?.title ?? 'CoWrite document', mimeType: DOC }),
      `--${boundary}`,
      'Content-Type: text/markdown; charset=UTF-8',
      '',
      await markdownOf(a.docId),
      `--${boundary}--`,
    ].join('\r\n');
    const out = await call<{ id: string; webViewLink: string }>('google', t, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    });
    res.json({ url: out.webViewLink });
  });

  // ------------------------------------------------------------------ Gmail

  const header = (h: { name: string; value: string }[] | undefined, n: string) => h?.find((x) => x.name.toLowerCase() === n)?.value ?? '';
  type GmailPart = { mimeType: string; body?: { data?: string }; parts?: GmailPart[]; headers?: { name: string; value: string }[] };
  const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  function bodyOf(part: GmailPart): { text: string; html: string } {
    let text = '';
    let html = '';
    const walk = (p: GmailPart) => {
      if (p.mimeType === 'text/plain' && p.body?.data && !text) text = b64url(p.body.data);
      else if (p.mimeType === 'text/html' && p.body?.data && !html) html = b64url(p.body.data);
      p.parts?.forEach(walk);
    };
    walk(part);
    return { text, html };
  }

  r.get('/integrations/google/gmail', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    const q = str(req.query.q, 200);
    const list = await call<{ messages?: { id: string }[] }>('google', t, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ maxResults: '25', ...(q ? { q } : { labelIds: 'INBOX' }) })}`);
    const msgs = await Promise.all(
      (list.messages ?? []).map((m) =>
        call<{ id: string; snippet: string; internalDate: string; payload: { headers: { name: string; value: string }[] } }>(
          'google',
          t,
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        ),
      ),
    );
    res.json({
      messages: msgs.map((m) => ({ id: m.id, subject: header(m.payload.headers, 'subject') || '(no subject)', from: header(m.payload.headers, 'from'), snippet: m.snippet, date: Number(m.internalDate) })),
    });
  });

  r.get('/integrations/google/gmail/:id', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    const m = await call<{ internalDate: string; payload: GmailPart }>('google', t, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(String(req.params.id))}?format=full`);
    const { text, html } = bodyOf(m.payload);
    res.json({
      subject: header(m.payload.headers, 'subject') || '(no subject)',
      from: header(m.payload.headers, 'from'),
      to: header(m.payload.headers, 'to'),
      date: Number(m.internalDate),
      text: (text || html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')).replace(/\n{3,}/g, '\n\n').trim().slice(0, 200_000),
    });
  });

  r.post('/docs/:id/send/gmail', rateLimit(20, 10 * 60_000), async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const t = await token(a.user!.id, 'google');
    const to = str(req.body?.to, 500)
      .split(/[,;\s]+/)
      .filter(Boolean);
    if (!to.length || to.some((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) throw new HttpError(400, 'Enter valid email addresses, separated by commas.');
    const title = a.doc?.title ?? 'Document';
    const subject = str(req.body?.subject, 200) || title;
    const note = str(req.body?.note, 2000);
    const html = `${note ? `<p>${note.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p><hr>` : ''}${await marked.parse(await markdownOf(a.docId))}<p style="color:#888;font-size:12px">Sent from CoWrite · <a href="${publicUrl(req)}/d/${a.docId}">open the live document</a></p>`;
    const mime = [
      `To: ${to.join(', ')}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(html).toString('base64'),
    ].join('\r\n');
    await call('google', t, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raw: Buffer.from(mime).toString('base64url') }),
    });
    res.json({ ok: true, sentTo: to });
  });

  // ---------------------------------------------------------------- YouTube

  type YtItem = { id: string | { videoId?: string }; snippet: { title: string; channelTitle: string; publishedAt: string; thumbnails: { medium?: { url: string }; default?: { url: string } }; resourceId?: { videoId: string } } };
  const ytOut = (items: YtItem[]) =>
    items
      .map((v) => ({
        id: typeof v.id === 'string' ? (v.snippet.resourceId?.videoId ?? v.id) : (v.id.videoId ?? ''),
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        published: v.snippet.publishedAt,
        thumb: v.snippet.thumbnails.medium?.url ?? v.snippet.thumbnails.default?.url ?? '',
      }))
      .filter((v) => v.id);

  r.get('/integrations/google/youtube', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    const q = str(req.query.q, 200).trim();
    if (q) {
      const out = await call<{ items: YtItem[] }>('google', t, `https://www.googleapis.com/youtube/v3/search?${new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '18', q, safeSearch: 'moderate' })}`);
      res.json({ videos: ytOut(out.items) });
      return;
    }
    // No search: the person's own uploads.
    const ch = await call<{ items?: { contentDetails: { relatedPlaylists: { uploads: string } } }[] }>('google', t, 'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true');
    const uploads = ch.items?.[0]?.contentDetails.relatedPlaylists.uploads;
    if (!uploads) {
      res.json({ videos: [], noChannel: true });
      return;
    }
    const out = await call<{ items: YtItem[] }>('google', t, `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=24&playlistId=${encodeURIComponent(uploads)}`);
    res.json({ videos: ytOut(out.items) });
  });

  // ----------------------------------------------------------------- Sheets

  r.get('/integrations/google/sheets/:id', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    const id = encodeURIComponent(String(req.params.id));
    const meta = await call<{ properties: { title: string }; sheets: { properties: { title: string } }[] }>('google', t, `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties.title`);
    const first = meta.sheets[0]?.properties.title ?? 'Sheet1';
    const vals = await call<{ values?: string[][] }>('google', t, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${first.replace(/'/g, "''")}'!A1:Z500`)}?valueRenderOption=FORMULA`);
    res.json({ title: meta.properties.title, rows: (vals.values ?? []).map((r) => r.map((c) => String(c ?? ''))) });
  });

  r.post('/docs/:id/send/sheets', rateLimit(20, 10 * 60_000), async (req, res) => {
    const a = await docAccess(ctx, req, res, 'viewer', { registered: true });
    const t = await token(a.user!.id, 'google');
    if (a.doc?.kind !== 'sheet') throw new HttpError(400, 'Choose a spreadsheet.');
    const room = await ctx.rooms.open(a.docId);
    if (!room) throw new HttpError(503, 'Server busy, try again.');
    if (room.encrypted) throw new HttpError(400, 'End-to-end encrypted documents cannot be sent to other services.');
    const grid: string[][] = [];
    for (const o of room.doc.objectsWith('cell:')) {
      const m = /^cell:([A-Z]+)(\d+)$/.exec(o.key);
      if (!m) continue;
      const col = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const row = Number(m[2]) - 1;
      if (row > 5000 || col > 200) continue;
      (grid[row] ??= [])[col] = String(o.fields.v ?? '');
    }
    const values = Array.from({ length: grid.length }, (_, r) => Array.from({ length: grid[r]?.length ?? 0 }, (_, c) => grid[r]?.[c] ?? ''));
    const sheet = await call<{ spreadsheetId: string; spreadsheetUrl: string }>('google', t, 'https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ properties: { title: a.doc?.title ?? 'CoWrite sheet' } }),
    });
    if (values.length)
      await call('google', t, `https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheetId}/values/A1?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values }),
      });
    res.json({ url: sheet.spreadsheetUrl });
  });

  // ------------------------------------------------------------------ Tasks

  r.get('/integrations/google/tasks', limiter, async (_req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    const lists = await call<{ items?: { id: string; title: string }[] }>('google', t, 'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=20');
    const out = await Promise.all(
      (lists.items ?? []).slice(0, 6).map(async (l) => {
        const tasks = await call<{ items?: { id: string; title: string; notes?: string; due?: string; status: string }[] }>('google', t, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(l.id)}/tasks?showCompleted=true&showHidden=false&maxResults=100`);
        return { id: l.id, title: l.title, tasks: (tasks.items ?? []).filter((x) => x.title).map((x) => ({ id: x.id, title: x.title, notes: x.notes ?? '', due: x.due?.slice(0, 10) ?? null, done: x.status === 'completed' })) };
      }),
    );
    res.json({ lists: out });
  });

  r.post('/integrations/google/tasks/:list', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    const title = str(req.body?.title, 500).trim();
    if (!title) throw new HttpError(400, 'Write the task first.');
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.due)) ? `${req.body.due}T00:00:00.000Z` : undefined;
    const task = await call<{ id: string }>('google', t, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(String(req.params.list))}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, ...(due ? { due } : {}) }),
    });
    res.status(201).json({ id: task.id });
  });

  r.patch('/integrations/google/tasks/:list/:task', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    await call('google', t, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(String(req.params.list))}/tasks/${encodeURIComponent(String(req.params.task))}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body?.done === true ? { status: 'completed' } : { status: 'needsAction', completed: null }),
    });
    res.json({ ok: true });
  });

  // ------------------------------------------------- Calendar (write)

  r.post('/events/:eid/google', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    const [e] = await db.query<{ title: string; notes: string; day: string; start_time: string | null; end_time: string | null }>('select title, notes, day, start_time, end_time from events where id = $1 and user_id = $2', [String(req.params.eid), user.id]);
    if (!e) throw new HttpError(404, 'Event not found.');
    const tz = str(req.body?.timeZone, 60) || 'UTC';
    const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const body = e.start_time
      ? { start: { dateTime: `${e.day}T${e.start_time}:00`, timeZone: tz }, end: { dateTime: `${e.day}T${e.end_time ?? e.start_time}:00`, timeZone: tz } }
      : { start: { date: e.day }, end: { date: next(e.day) } };
    const out = await call<{ htmlLink: string }>('google', t, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary: e.title, description: `${e.notes ? `${e.notes}\n\n` : ''}Added from CoWrite`, ...body }),
    });
    res.json({ url: out.htmlLink });
  });


  // ------------------------------------------- Google Docs and Slides files

  /** A Word or PowerPoint file from the browser, saved to Drive as a Google Doc or Slides deck (formatting kept). */
  r.post('/integrations/google/upload', rateLimit(20, 10 * 60_000), express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (data.length < 100) throw new HttpError(400, 'The file is empty.');
    const slides = req.query.as === 'slides';
    const name = str(req.query.name, 200) || (slides ? 'CoWrite presentation' : 'CoWrite document');
    const source = slides ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const target = slides ? 'application/vnd.google-apps.presentation' : 'application/vnd.google-apps.document';
    const boundary = `cowrite${Date.now()}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: target })}\r\n--${boundary}\r\nContent-Type: ${source}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const out = await call<{ webViewLink: string }>('google', t, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    });
    res.json({ url: out.webViewLink });
  });

  /** A Google Slides presentation's text, slide by slide, for opening it as a CoWrite deck. */
  r.get('/integrations/google/slides/:id', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    type Text = { text?: { textElements?: { textRun?: { content?: string } }[] } };
    type Element = { shape?: Text & { placeholder?: { type?: string } }; table?: unknown };
    const deck = await call<{ title: string; slides?: { pageElements?: Element[]; slideProperties?: { notesPage?: { pageElements?: Element[] } } }[] }>(
      'google',
      t,
      `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(String(req.params.id))}`,
    );
    const textOf = (e: Element) => (e.shape?.text?.textElements ?? []).map((x) => x.textRun?.content ?? '').join('').trim();
    const slides = (deck.slides ?? []).map((s) => {
      const els = (s.pageElements ?? []).filter((e) => e.shape?.text);
      const titleEl = els.find((e) => /TITLE/.test(e.shape?.placeholder?.type ?? '')) ?? els[0];
      const title = titleEl ? textOf(titleEl) : '';
      const bullets = els
        .filter((e) => e !== titleEl)
        .flatMap((e) => textOf(e).split('\n'))
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 8);
      const notes = (s.slideProperties?.notesPage?.pageElements ?? []).map(textOf).filter(Boolean).join(' ').slice(0, 1000);
      return { title: title.split('\n')[0] || 'Slide', bullets, notes };
    });
    res.json({ title: deck.title, slides });
  });

  // ----------------------------------------------------------------- People

  r.get('/integrations/google/contacts', limiter, async (req, res) => {
    const user = requireUser(res);
    const t = await token(user.id, 'google');
    const q = str(req.query.q, 100).trim();
    if (q.length < 2) {
      res.json({ contacts: [] });
      return;
    }
    type Person = { person?: { names?: { displayName: string }[]; emailAddresses?: { value: string }[]; photos?: { url: string }[] } };
    const search = (path: string) =>
      call<{ results?: Person[] }>('google', t, `https://people.googleapis.com/v1/${path}?${new URLSearchParams({ query: q, readMask: 'names,emailAddresses,photos', pageSize: '10' })}`).catch(() => ({ results: [] as Person[] }));
    const [own, other] = await Promise.all([search('people:searchContacts'), search('otherContacts:search')]);
    const seen = new Set<string>();
    const contacts = [...(own.results ?? []), ...(other.results ?? [])]
      .flatMap((r) => (r.person?.emailAddresses ?? []).map((e) => ({ name: r.person?.names?.[0]?.displayName ?? e.value, email: e.value, photo: r.person?.photos?.[0]?.url ?? null })))
      .filter((c) => !seen.has(c.email.toLowerCase()) && seen.add(c.email.toLowerCase()))
      .slice(0, 10);
    res.json({ contacts });
  });

  // ----------------------------------------------------------------- Picker

  r.get('/integrations/google/picker', limiter, async (_req, res) => {
    const user = requireUser(res);
    const cfg = pickerConfig();
    if (!cfg) throw new HttpError(400, 'The Google file picker needs an API key: the site owner can add it in Account → Connected accounts.');
    res.json({ token: await token(user.id, 'google'), ...cfg });
  });

  return r;
}
