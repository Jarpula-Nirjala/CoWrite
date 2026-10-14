import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { WebSocket as WsClient } from 'ws';
import { startServer, type RunningServer } from '../server/app.ts';
import { SyncClient } from '../shared/sync-client.ts';

async function waitFor(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** A simulated browser: keeps its session cookie for both HTTP and WebSocket. */
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
    return { status: res.status, body: (await res.json()) as any };
  };
  const client = (room: string, name: string, query = '') => {
    const c = new SyncClient({
      url: `ws://localhost:${server().port}/ws?room=${room}${query}`,
      name,
      color: '#336699',
      createSocket: (url) => new WsClient(url, { headers: { cookie } }) as unknown as WebSocket,
    });
    c.connect();
    return c;
  };
  const signUp = async (name: string) => {
    const r = await api('/auth/signup', { method: 'POST', body: { name, email: `${name.toLowerCase().replace(/\s/g, '')}@example.com`, password: 'password123' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.user;
  };
  return { api, client, signUp };
}

describe('server', () => {
  let server: RunningServer;
  let dataDir: string;
  const clients: SyncClient[] = [];
  const guest = () => {
    const b = browser(() => server);
    return {
      ...b,
      client: (room: string, name: string, q = '') => {
        const c = b.client(room, name, q);
        clients.push(c);
        return c;
      },
    };
  };

  async function restart() {
    for (const c of clients) c.disconnect();
    await server.close();
    server = await startServer({ port: 0, dataDir });
  }

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowrite-'));
    server = await startServer({ port: 0, dataDir });
  });

  after(async () => {
    for (const c of clients) c.disconnect();
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  describe('real-time sync', () => {
    it('relays edits between clients in the same room', async () => {
      const a = guest().client('relay', 'Ada');
      const b = guest().client('relay', 'Bo');
      await waitFor(() => a.status === 'online' && b.status === 'online', 'both online');
      a.edit(a.doc.insert(0, 'hello'));
      await waitFor(() => b.doc.text() === 'hello', 'b to see hello');
      b.edit(b.doc.insert(5, ' world'));
      await waitFor(() => a.doc.text() === 'hello world', 'a to see world');
      await waitFor(() => a.pending === 0 && b.pending === 0, 'acks');
    });

    it('merges edits made while a client was offline', async () => {
      const a = guest().client('offline', 'Ada');
      const b = guest().client('offline', 'Bo');
      await waitFor(() => a.status === 'online' && b.status === 'online', 'both online');
      a.edit(a.doc.insert(0, 'shared base'));
      await waitFor(() => b.doc.text() === 'shared base', 'base synced');
      b.disconnect();
      b.edit(b.doc.insert(0, 'offline-'));
      a.edit(a.doc.insert(a.doc.length, '-online'));
      b.connect();
      await waitFor(() => a.doc.text() === b.doc.text() && b.pending === 0, 'convergence');
      assert.equal(a.doc.text(), 'offline-shared base-online');
    });

    it('resumes from saved state with the same site id', async () => {
      const a = guest().client('resume', 'Ada');
      await waitFor(() => a.status === 'online', 'online');
      a.edit(a.doc.insert(0, 'abc'));
      a.disconnect();
      a.edit(a.doc.insert(3, 'def')); // typed offline, then the tab closed
      const saved = JSON.parse(JSON.stringify(a.savedState()));
      const b = new SyncClient({ url: `ws://localhost:${server.port}/ws?room=resume`, name: 'Ada', color: '#336699', saved });
      clients.push(b);
      b.connect();
      await waitFor(() => b.pending === 0 && b.status === 'online', 'resync');
      const c = guest().client('resume', 'Cy');
      await waitFor(() => c.doc.text() === 'abcdef', 'third client sees offline edits');
    });

    it('shares presence, chat and departures', async () => {
      const a = guest().client('presence', 'Ada');
      const b = guest().client('presence', 'Bo');
      const chats: string[] = [];
      b.on((e, p) => e === 'chat' && chats.push((p as { body: string }).body));
      await waitFor(() => a.peers.size === 1 && b.peers.size === 1, 'peers');
      a.edit(a.doc.insert(0, 'abc'));
      a.setSelection([a.doc.idBefore(1), a.doc.idBefore(3)]);
      a.setPresence('idle', true);
      await waitFor(() => b.peers.get(a.doc.site)?.state === 'idle', 'presence relay');
      assert.equal(b.peers.get(a.doc.site)?.typing, true);
      a.sendChat('hi there');
      await waitFor(() => chats.includes('hi there'), 'chat');
      a.disconnect();
      await waitFor(() => b.peers.size === 0, 'leave');
    });

    it('rejects forged and malformed ops', async () => {
      const a = guest().client('forgery', 'Ada');
      await waitFor(() => a.status === 'online', 'online');
      const ws = new WebSocket(`ws://localhost:${server.port}/ws?room=forgery`);
      const messages: { t: string }[] = [];
      ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
      await new Promise((r) => (ws.onopen = r));
      ws.send(JSON.stringify({ t: 'hello', site: 'mallory', vector: {}, name: 'M', color: '#000000' }));
      ws.send(JSON.stringify({ t: 'ops', ops: [{ k: 'i', id: [a.doc.site, 99], o: null, ch: 'x' }] }));
      ws.send(JSON.stringify({ t: 'ops', ops: [{ k: 'i', id: ['mallory', 1], o: null, ch: 'xyz' }] }));
      ws.send('not json');
      await waitFor(() => messages.filter((m) => m.t === 'error').length === 3, 'errors');
      ws.close();
      assert.equal(a.doc.text(), '');
    });

    it('persists documents across restarts', async () => {
      const a = guest().client('persist', 'Ada');
      await waitFor(() => a.status === 'online', 'online');
      a.edit(a.doc.insert(0, 'survives restarts'));
      await waitFor(() => a.pending === 0, 'ack');
      await restart();
      const b = guest().client('persist', 'Bo');
      await waitFor(() => b.doc.text() === 'survives restarts', 'restored text');
    });
  });

  describe('accounts', () => {
    it('signs up, keeps the session, signs out', async () => {
      const b = guest();
      assert.equal((await b.api('/auth/me')).body.user, null);
      const up = await b.api('/auth/signup', { method: 'POST', body: { name: 'Ada Lovelace', email: 'Ada@Example.com', password: 'correct horse' } });
      assert.equal(up.status, 200);
      assert.equal(up.body.user.email, 'ada@example.com');
      assert.equal(up.body.user.username, 'ada-lovelace');
      assert.equal(up.body.user.password, undefined);
      assert.equal((await b.api('/auth/me')).body.user.name, 'Ada Lovelace');
      await b.api('/auth/signout', { method: 'POST' });
      assert.equal((await b.api('/auth/me')).body.user, null);
    });

    it('rejects bad sign-ups and wrong passwords; resets passwords', async () => {
      const b = guest();
      assert.equal((await b.api('/auth/signup', { method: 'POST', body: { name: 'X', email: 'nope', password: 'longenough' } })).status, 400);
      assert.equal((await b.api('/auth/signup', { method: 'POST', body: { name: 'X', email: 'x@y.io', password: 'short' } })).status, 400);
      await b.signUp('Bo');
      assert.equal((await guest().api('/auth/signup', { method: 'POST', body: { name: 'Bo', email: 'BO@example.com', password: 'password123' } })).status, 409);
      assert.equal((await guest().api('/auth/signin', { method: 'POST', body: { email: 'bo@example.com', password: 'nope-nope' } })).status, 401);

      const reset = await server.ctx.auth.createReset('bo@example.com');
      assert.ok(reset);
      const r = await guest().api('/auth/reset', { method: 'POST', body: { token: reset.token, password: 'brand-new-pass' } });
      assert.equal(r.status, 200);
      assert.equal((await guest().api('/auth/reset', { method: 'POST', body: { token: reset.token, password: 'again-again' } })).status, 400);
      assert.equal((await guest().api('/auth/signin', { method: 'POST', body: { email: 'bo@example.com', password: 'brand-new-pass' } })).status, 200);
    });

    it('updates profile, username and avatar; exposes a public profile', async () => {
      const b = guest();
      await b.signUp('Cy Profile');
      const avatar = `data:image/png;base64,${'A'.repeat(100)}`;
      const r = await b.api('/auth/me', { method: 'PATCH', body: { bio: 'Writer.', username: 'cy-writes', avatar } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.user.username, 'cy-writes');
      assert.equal((await b.api('/auth/me', { method: 'PATCH', body: { username: 'Bad Name!' } })).status, 400);
      const p = await guest().api('/users/cy-writes');
      assert.equal(p.body.profile.bio, 'Writer.');
      assert.equal(p.body.profile.avatar, avatar);
    });
  });

  describe('documents', () => {
    it('creates, organises, searches, trashes and restores documents', async () => {
      const owner = guest();
      await owner.signUp('Dee Owner');
      const { body } = await owner.api('/docs', { method: 'POST', body: { title: '  Plan  ', tags: ['Work', 'work', 'Q4 goals'] } });
      const id = body.document.id;
      assert.equal(body.document.title, 'Plan');
      assert.deepEqual(body.document.tags, ['work', 'q4-goals']);

      const folder = (await owner.api('/folders', { method: 'POST', body: { name: 'Projects' } })).body.folder;
      await owner.api(`/docs/${id}`, { method: 'PATCH', body: { folderId: folder.id, starred: true, title: 'Roadmap' } });
      assert.equal((await owner.api(`/docs?view=starred`)).body.documents[0].title, 'Roadmap');
      assert.equal((await owner.api(`/docs?folder=${folder.id}`)).body.documents.length, 1);
      assert.equal((await owner.api(`/docs?tag=work`)).body.documents.length, 1);
      const lib = (await owner.api('/library')).body;
      assert.equal(lib.counts.all, 1);
      assert.equal(lib.folders[0].count, 1);

      // Full-text search reaches into document contents once saved.
      const c = owner.client(id, 'Dee');
      await waitFor(() => c.status === 'online', 'online');
      c.edit(c.doc.insert(0, 'The quarterly kangaroo migration report'));
      await waitFor(() => c.pending === 0, 'ack');
      await server.ctx.rooms.sweep();
      const found = (await owner.api('/docs?q=kangaroo')).body.documents;
      assert.equal(found.length, 1);
      assert.match(found[0].snippet, /kangaroo/);

      await owner.api(`/docs/${id}/trash`, { method: 'POST' });
      assert.equal((await owner.api('/docs')).body.documents.length, 0);
      assert.equal((await owner.api('/docs?view=trash')).body.documents.length, 1);
      await owner.api(`/docs/${id}/restore`, { method: 'POST' });
      assert.equal((await owner.api('/docs')).body.documents.length, 1);
    });

    it('enforces share-link roles over HTTP and WebSocket', async () => {
      const owner = guest();
      await owner.signUp('Eve Owner');
      const id = (await owner.api('/docs', { method: 'POST', body: { title: 'Shared' } })).body.document.id;
      const stranger = guest();
      await stranger.signUp('Stranger');
      assert.equal((await stranger.api(`/docs/${id}`)).status, 403);

      const view = (await owner.api(`/docs/${id}/links`, { method: 'POST', body: { role: 'viewer', expiresInDays: 7 } })).body.link.token;
      const comment = (await owner.api(`/docs/${id}/links`, { method: 'POST', body: { role: 'commenter', expiresInDays: null } })).body.link.token;

      const ownerClient = owner.client(id, 'Eve');
      await waitFor(() => ownerClient.status === 'online', 'owner online');
      ownerClient.edit(ownerClient.doc.insert(0, 'owner text'));

      const viewer = stranger.client(id, 'Stranger', `&s=${view}`);
      await waitFor(() => viewer.role === 'viewer' && viewer.doc.text() === 'owner text', 'viewer joins');
      viewer.edit(viewer.doc.insert(0, 'HACK '));
      await waitFor(() => viewer.error !== null, 'edit rejected');
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(ownerClient.doc.text(), 'owner text');

      // The stranger is now a member; a commenter link upgrades their role.
      const meta = await stranger.api(`/docs/${id}`, { headers: { 'x-share-token': comment } });
      assert.equal(meta.body.role, 'commenter');
      const anchor = ownerClient.doc.idAt(0);
      assert.equal((await stranger.api(`/docs/${id}/comments`, { method: 'POST', body: { body: 'Nice @eve-owner', anchorStart: anchor, anchorEnd: anchor, quote: 'o' } })).status, 201);
      const notes = (await owner.api('/notifications')).body;
      assert.ok(notes.unread >= 2, JSON.stringify(notes));
      assert.ok(notes.notifications.some((n: any) => n.kind === 'mention'));

      const sharing = (await owner.api(`/docs/${id}/sharing`)).body;
      assert.equal(sharing.members.length, 1);
      assert.equal(sharing.links.length, 2);
      await owner.api(`/docs/${id}/members/${sharing.members[0].userId}`, { method: 'PATCH', body: { role: null } });
      await owner.api(`/docs/${id}/links/${view}`, { method: 'DELETE' });
      assert.equal((await stranger.api(`/docs/${id}`, { headers: { 'x-share-token': view } })).status, 403);
    });

    it('forks a document and merges the fork back without conflicts', async () => {
      const owner = guest();
      await owner.signUp('Fay Forker');
      const id = (await owner.api('/docs', { method: 'POST', body: { title: 'Essay' } })).body.document.id;
      const main = owner.client(id, 'Fay');
      await waitFor(() => main.status === 'online', 'online');
      main.edit(main.doc.insert(0, 'Intro. Body. End.'));
      await waitFor(() => main.pending === 0, 'ack');

      const fork = (await owner.api(`/docs/${id}/fork`, { method: 'POST' })).body.document;
      assert.equal(fork.parentId, id);
      const f = owner.client(fork.id, 'Fay');
      await waitFor(() => f.doc.text() === 'Intro. Body. End.', 'fork content');
      f.edit(f.doc.insert(7, 'Bold new middle. '));
      // Meanwhile the original keeps changing.
      main.edit(main.doc.insert(0, 'Title\n'));
      await waitFor(() => f.pending === 0 && main.pending === 0, 'acks');

      const preview = (await owner.api(`/docs/${fork.id}/merge-preview`)).body;
      assert.equal(preview.toParent.inserts, 'Bold new middle. '.length);
      await owner.api(`/docs/${fork.id}/merge`, { method: 'POST' });
      await waitFor(() => main.doc.text() === 'Title\nIntro. Bold new middle. Body. End.', 'merged text');
      await owner.api(`/docs/${fork.id}/pull`, { method: 'POST' });
      await waitFor(() => f.doc.text() === main.doc.text(), 'fork pulled');
    });

    it('stores comments, suggestions, versions and authors', async () => {
      const owner = guest();
      await owner.signUp('Gus Writer');
      const id = (await owner.api('/docs', { method: 'POST', body: { title: 'Notes' } })).body.document.id;
      const c = owner.client(id, 'Gus');
      await waitFor(() => c.status === 'online', 'online');
      const ops = c.doc.insert(0, 'Hello world');
      c.edit(ops);
      await waitFor(() => c.pending === 0, 'ack');

      const keys = ops.slice(0, 5).map((o) => `${o.id[0]}:${o.id[1]}`);
      const s = (await owner.api(`/docs/${id}/suggestions`, { method: 'POST', body: { kind: 'delete', keys } })).body.suggestion;
      await owner.api(`/docs/${id}/suggestions/${s.id}`, { method: 'PATCH', body: { addKeys: [keys[0]] } });
      assert.equal((await owner.api(`/docs/${id}/suggestions`)).body.suggestions[0].keys.length, 6);
      await owner.api(`/docs/${id}/suggestions/${s.id}`, { method: 'PATCH', body: { status: 'accepted' } });
      assert.equal((await owner.api(`/docs/${id}/suggestions`)).body.suggestions.length, 0);

      const v = (await owner.api(`/docs/${id}/versions`, { method: 'POST', body: { name: 'First draft' } })).body.version;
      assert.equal(v.size, 11);
      const snap = (await owner.api(`/docs/${id}/versions/${v.id}`)).body.snapshot;
      assert.equal(snap.ops.length, 11);
      const authors = (await owner.api(`/docs/${id}/authors`)).body.authors;
      assert.equal(authors[0].site, c.doc.site);
      assert.equal((await owner.api(`/docs/${id}/ai`, { method: 'POST', body: { action: 'continue', selection: null } })).status, 503);
    });

    it('accepts ciphertext only in encrypted documents', async () => {
      const owner = guest();
      await owner.signUp('Hal Secret');
      const id = (await owner.api('/docs', { method: 'POST', body: { title: 'Secret', encrypted: true } })).body.document.id;
      assert.equal((await owner.api(`/docs/${id}`, { method: 'PATCH', body: { published: true } })).status, 400);
      const c = owner.client(id, 'Hal');
      await waitFor(() => c.status === 'online' && c.encrypted, 'online');
      c.edit([{ k: 'i', id: [c.doc.site, 1], o: null, ch: 'Q2lwaGVydGV4dEJsb2I=' }]);
      await waitFor(() => c.pending === 0, 'ciphertext accepted');
    });

    it('reports activity for the dashboard', async () => {
      const owner = guest();
      await owner.signUp('Ivy Active');
      const id = (await owner.api('/docs', { method: 'POST', body: { title: 'Busy' } })).body.document.id;
      const c = owner.client(id, 'Ivy');
      await waitFor(() => c.status === 'online', 'online');
      c.edit(c.doc.insert(0, 'twelve chars'));
      await waitFor(() => c.pending === 0, 'ack');
      await restart();
      const act = (await owner.api('/activity')).body;
      assert.equal(act.days.length, 30);
      assert.equal(act.days.at(-1).mine, 12);
      assert.equal(act.topDocs[0].title, 'Busy');
    });
  });
});
