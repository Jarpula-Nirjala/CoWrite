import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { WebSocket as WsClient } from 'ws';
import { startServer, type RunningServer } from '../server/app.ts';
import { SyncClient } from '../shared/sync-client.ts';

async function waitFor(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function browser(server: () => RunningServer) {
  let cookie = '';
  const base = () => `http://localhost:${server().port}`;
  const api = async (p: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await fetch(`${base()}/api${p}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', cookie, ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  const clients: SyncClient[] = [];
  const client = (room: string, name: string, query = '') => {
    const c = new SyncClient({
      url: `ws://localhost:${server().port}/ws?room=${room}${query}`,
      name,
      color: '#336699',
      createSocket: (url) => new WsClient(url, { headers: { cookie } }) as unknown as WebSocket,
    });
    c.connect();
    clients.push(c);
    return c;
  };
  const signUp = async (name: string) => {
    const r = await api('/auth/signup', { method: 'POST', body: { name, email: `${name.toLowerCase().replace(/\s/g, '')}@example.com`, password: 'password123' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.user as { id: string; name: string; email: string };
  };
  return { api, client, signUp, clients };
}

describe('team features', () => {
  let server: RunningServer;
  let dataDir: string;
  const browsers: ReturnType<typeof browser>[] = [];
  const make = () => {
    const b = browser(() => server);
    browsers.push(b);
    return b;
  };

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowrite-team-'));
    server = await startServer({ port: 0, dataDir });
  });
  after(async () => {
    for (const b of browsers) for (const c of b.clients) c.disconnect();
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function sharedDoc(title = 'Doc') {
    const owner = make();
    const ownerUser = await owner.signUp(`Owner ${Math.random().toString(36).slice(2, 7)}`);
    const { body } = await owner.api('/docs', { method: 'POST', body: { title } });
    const id = body.document.id as string;
    const link = await owner.api(`/docs/${id}/links`, { method: 'POST', body: { role: 'editor', expiresInDays: null } });
    const other = make();
    const otherUser = await other.signUp(`Other ${Math.random().toString(36).slice(2, 7)}`);
    // Opening with the link makes the other user a member.
    assert.equal((await other.api(`/docs/${id}`, { headers: { 'x-share-token': link.body.link.token } })).status, 200);
    return { id, owner, ownerUser, other, otherUser, token: link.body.link.token as string };
  }

  it('locks a section: other editors cannot change it, the locker can', async () => {
    const { id, owner, other } = await sharedDoc('Locked');
    const a = owner.client(id, 'Owner');
    await waitFor(() => a.status === 'online', 'owner online');
    a.edit(a.doc.insert(0, 'Locked part\nFree part\n'));
    await new Promise((r) => setTimeout(r, 200));
    const toks = a.doc.tokens();
    const r = await owner.api(`/docs/${id}/locks`, { method: 'POST', body: { start: toks[0].id, end: toks[11].id, quote: 'Locked part' } });
    assert.equal(r.status, 201);
    const b = other.client(id, 'Other');
    await waitFor(() => b.status === 'online' && b.doc.text().includes('Free part'), 'other synced');
    // Typing outside the lock is fine.
    b.edit(b.doc.insert(b.doc.length, 'More'));
    await waitFor(() => a.doc.text().endsWith('More'), 'owner sees free edit');
    // Typing inside the lock gets the client disconnected and the edit dropped.
    let locked = false;
    b.on((e) => e === 'locked' && (locked = true));
    b.edit(b.doc.insert(3, 'XX'));
    await waitFor(() => locked, 'locked close');
    await new Promise((r2) => setTimeout(r2, 150));
    assert.ok(!a.doc.text().includes('XX'));
    // The owner can still edit it.
    a.edit(a.doc.insert(0, '!'));
    await new Promise((r2) => setTimeout(r2, 150));
    assert.ok(a.doc.text().startsWith('!Locked'));
    const list = await other.api(`/docs/${id}/locks`);
    assert.equal(list.body.locks.length, 1);
    assert.equal((await other.api(`/docs/${id}/locks/${list.body.locks[0].id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await owner.api(`/docs/${id}/locks/${list.body.locks[0].id}`, { method: 'DELETE' })).status, 200);
  });

  it('runs the approval workflow', async () => {
    const { id, owner, other } = await sharedDoc('Review me');
    assert.equal((await other.api(`/docs/${id}/approve`, { method: 'POST', body: { decision: 'approved' } })).status, 400);
    assert.equal((await owner.api(`/docs/${id}/workflow`, { method: 'POST', body: { status: 'review' } })).body.status, 'review');
    const notes = await other.api('/notifications');
    assert.ok(notes.body.notifications.some((n: { kind: string }) => n.kind === 'review'));
    assert.equal((await other.api(`/docs/${id}/approve`, { method: 'POST', body: { decision: 'changes', note: 'Fix intro' } })).body.status, 'changes');
    assert.equal((await other.api(`/docs/${id}/approve`, { method: 'POST', body: { decision: 'approved' } })).body.status, 'approved');
    const wf = await owner.api(`/docs/${id}/workflow`);
    assert.equal(wf.body.status, 'approved');
    assert.equal(wf.body.approvals.length, 1);
  });

  it('toggles reactions', async () => {
    const { id, owner, other } = await sharedDoc('React');
    await owner.api(`/docs/${id}/reactions`, { method: 'POST', body: { target: 'x:1', emoji: '👍' } });
    await other.api(`/docs/${id}/reactions`, { method: 'POST', body: { target: 'x:1', emoji: '👍' } });
    let r = await owner.api(`/docs/${id}/reactions`);
    assert.equal(r.body.reactions[0].count, 2);
    assert.equal(r.body.reactions[0].mine, true);
    await owner.api(`/docs/${id}/reactions`, { method: 'POST', body: { target: 'x:1', emoji: '👍' } });
    r = await owner.api(`/docs/${id}/reactions`);
    assert.equal(r.body.reactions[0].count, 1);
    assert.equal((await owner.api(`/docs/${id}/reactions`, { method: 'POST', body: { target: 'x:1', emoji: 'nope' } })).status, 400);
  });

  it('indexes assigned tasks and lists them for the assignee', async () => {
    const { id, owner, other, otherUser } = await sharedDoc('Tasks');
    const a = owner.client(id, 'Owner');
    await waitFor(() => a.status === 'online', 'online');
    a.edit(a.doc.insertTokens(0, [...'Ship it'].map((ch) => ({ ch })).concat([{ ch: '\n', a: { block: 'task', assignee: { id: otherUser.id, name: otherUser.name }, due: '2020-01-01' } } as never])));
    await waitFor(async () => (await other.api('/tasks')).body.tasks?.length === 1, 'task indexed', 10_000);
    const t = (await other.api('/tasks')).body.tasks[0];
    assert.equal(t.text, 'Ship it');
    assert.equal(t.mine, true);
    assert.equal(t.due, '2020-01-01');
    const n = await other.api('/notifications');
    assert.ok(n.body.notifications.some((x: { kind: string }) => x.kind === 'task'));
  });

  it('creates, lists and deletes reminders', async () => {
    const b = make();
    await b.signUp('Reminder Person');
    assert.equal((await b.api('/reminders', { method: 'POST', body: { note: 'x', at: 1 } })).status, 400);
    const r = await b.api('/reminders', { method: 'POST', body: { note: 'Call Ravi', at: Date.now() + 3600_000 } });
    assert.equal(r.status, 201);
    assert.equal((await b.api('/reminders')).body.reminders.length, 1);
    await b.api(`/reminders/${r.body.id}`, { method: 'DELETE' });
    assert.equal((await b.api('/reminders')).body.reminders.length, 0);
  });

  it('shares documents through a workspace and lists team templates', async () => {
    const owner = make();
    await owner.signUp('Team Lead');
    const member = make();
    const m = await member.signUp('Team Member');
    const ws = await owner.api('/workspaces', { method: 'POST', body: { name: 'Design team' } });
    const wid = ws.body.workspace.id;
    assert.equal((await owner.api(`/workspaces/${wid}/members`, { method: 'POST', body: { email: m.email, role: 'editor' } })).status, 200);
    const doc = await owner.api('/docs', { method: 'POST', body: { title: 'Brand guide', workspaceId: wid } });
    const id = doc.body.document.id;
    // The member can open it without an invite link.
    const open = await member.api(`/docs/${id}`);
    assert.equal(open.status, 200);
    assert.equal(open.body.role, 'editor');
    await owner.api(`/docs/${id}`, { method: 'PATCH', body: { isTemplate: true } });
    const t = await member.api('/templates/team');
    assert.equal(t.body.templates.length, 1);
    assert.equal(t.body.templates[0].workspace, 'Design team');
    const outsider = make();
    await outsider.signUp('Outsider Person');
    assert.equal((await outsider.api(`/docs/${id}`)).status, 403);
  });

  it('keeps private drafts per person', async () => {
    const { id, owner, other } = await sharedDoc('Drafts');
    await owner.api(`/docs/${id}/draft`, { method: 'PUT', body: { md: '# Secret section' } });
    assert.equal((await owner.api(`/docs/${id}/draft`)).body.md, '# Secret section');
    assert.equal((await other.api(`/docs/${id}/draft`)).body.md, '');
  });

  it('serves published pages with rich tokens and comments', async () => {
    const owner = make();
    await owner.signUp('Blogger Person');
    const { body } = await owner.api('/docs', { method: 'POST', body: { title: 'My post' } });
    const id = body.document.id;
    const a = owner.client(id, 'Blogger');
    await waitFor(() => a.status === 'online', 'online');
    a.edit(a.doc.insertTokens(0, [...'Hello'].map((ch) => ({ ch, a: { b: true } }))));
    await owner.api(`/docs/${id}`, { method: 'PATCH', body: { published: true } });
    const reader = make();
    await waitFor(async () => (await reader.api(`/public/${id}`)).body.tokens?.length === 5, 'tokens');
    const pub = await reader.api(`/public/${id}`);
    assert.equal(pub.body.tokens[0].attrs.b, true);
    assert.equal((await reader.api(`/public/${id}/comments`, { method: 'POST', body: { body: 'Nice' } })).status, 401);
    await reader.signUp('Reader Person');
    assert.equal((await reader.api(`/public/${id}/comments`, { method: 'POST', body: { body: 'Nice post' } })).status, 201);
    assert.equal((await reader.api(`/public/${id}/comments`)).body.comments[0].body, 'Nice post');
  });

  it('builds the fork tree and compares a fork with its original', async () => {
    const owner = make();
    await owner.signUp('Forker Person');
    const { body } = await owner.api('/docs', { method: 'POST', body: { title: 'Root' } });
    const id = body.document.id;
    const a = owner.client(id, 'Forker');
    await waitFor(() => a.status === 'online', 'online');
    a.edit(a.doc.insert(0, 'shared text'));
    await new Promise((r) => setTimeout(r, 150));
    const fork = (await owner.api(`/docs/${id}/fork`, { method: 'POST' })).body.document.id;
    const f = owner.client(fork, 'Forker');
    await waitFor(() => f.doc.text() === 'shared text', 'fork synced');
    f.edit(f.doc.insert(f.doc.length, ' plus'));
    await new Promise((r) => setTimeout(r, 150));
    const cmp = await owner.api(`/docs/${fork}/fork-compare`);
    const added = cmp.body.items.filter((x: { p: boolean; f: boolean }) => x.f && !x.p).map((x: { ch: string }) => x.ch).join('');
    assert.equal(added, ' plus');
    const tree = await owner.api(`/docs/${fork}/tree`);
    assert.equal(tree.body.nodes.length, 2);
    assert.ok(tree.body.nodes.some((n: { id: string; parentId: string }) => n.id === fork && n.parentId === id));
  });

  it('saves brand kit and preferences on the account', async () => {
    const b = make();
    await b.signUp('Brand Person');
    const r = await b.api('/auth/me/brand', { method: 'PUT', body: { name: 'Acme', accent: '#ff0000', font: 'georgia', deckTheme: 'ocean', logo: 'javascript:alert(1)' } });
    assert.deepEqual(r.body.brand, { name: 'Acme', logo: null, accent: '#ff0000', font: 'georgia', deckTheme: 'ocean' });
    await b.api('/auth/me/prefs', { method: 'PUT', body: { theme: 'dark', dyslexic: true, dailyGoal: 750 } });
    const me = await b.api('/auth/me');
    assert.equal(me.body.user.prefs.theme, 'dark');
    assert.equal(me.body.user.brand.name, 'Acme');
  });

  it('refuses to proxy private addresses', async () => {
    const b = make();
    const r = await b.api(`/media/proxy?url=${encodeURIComponent('http://127.0.0.1:1/secret.png')}`);
    assert.equal(r.status, 400);
  });
});
