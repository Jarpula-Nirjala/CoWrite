import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startServer, type RunningServer } from '../server/app.ts';
import { SyncClient } from '../shared/sync-client.ts';

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('server', () => {
  let server: RunningServer;
  let dataDir: string;
  const clients: SyncClient[] = [];

  function client(room: string, name: string): SyncClient {
    const c = new SyncClient({ url: `ws://localhost:${server.port}/ws?room=${room}`, name, color: '#336699' });
    clients.push(c);
    c.connect();
    return c;
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

  it('relays edits between clients in the same room', async () => {
    const a = client('relay', 'Ada');
    const b = client('relay', 'Bo');
    await waitFor(() => a.status === 'online' && b.status === 'online', 'both online');
    a.edit(a.doc.insert(0, 'hello'));
    await waitFor(() => b.doc.text() === 'hello', 'b to see hello');
    b.edit(b.doc.insert(5, ' world'));
    await waitFor(() => a.doc.text() === 'hello world', 'a to see world');
    await waitFor(() => a.pending === 0 && b.pending === 0, 'acks');
  });

  it('merges edits made while a client was offline', async () => {
    const a = client('offline', 'Ada');
    const b = client('offline', 'Bo');
    await waitFor(() => a.status === 'online' && b.status === 'online', 'both online');
    a.edit(a.doc.insert(0, 'shared base'));
    await waitFor(() => b.doc.text() === 'shared base', 'base synced');

    b.disconnect();
    b.edit(b.doc.insert(0, 'offline-'));
    a.edit(a.doc.insert(a.doc.length, '-online'));
    assert.equal(b.pending, 8);

    b.connect();
    await waitFor(() => a.doc.text() === b.doc.text() && b.pending === 0, 'convergence');
    assert.equal(a.doc.text(), 'offline-shared base-online');
  });

  it('shares presence and announces departures', async () => {
    const a = client('presence', 'Ada');
    const b = client('presence', 'Bo');
    await waitFor(() => a.peers.size === 1 && b.peers.size === 1, 'peers');
    a.edit(a.doc.insert(0, 'abc'));
    a.setSelection([a.doc.idBefore(1), a.doc.idBefore(3)]);
    await waitFor(() => b.peers.get(a.doc.site)?.sel?.[1]?.[1] === 3, 'selection relay');
    assert.equal(b.peers.get(a.doc.site)?.name, 'Ada');
    a.disconnect();
    await waitFor(() => b.peers.size === 0, 'leave');
  });

  it('rejects ops forged under another site id', async () => {
    const a = client('forgery', 'Ada');
    await waitFor(() => a.status === 'online', 'online');
    const ws = new WebSocket(`ws://localhost:${server.port}/ws?room=forgery`);
    const messages: { t: string }[] = [];
    ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ t: 'hello', site: 'mallory', vector: {}, name: 'M', color: '#000000' }));
    ws.send(JSON.stringify({ t: 'ops', ops: [{ k: 'i', id: [a.doc.site, 99], o: null, ch: 'x' }] }));
    ws.send('not json');
    await waitFor(() => messages.filter((m) => m.t === 'error').length === 2, 'errors');
    ws.close();
    assert.equal(a.doc.text(), '');
  });

  it('persists documents across restarts', async () => {
    const a = client('persist', 'Ada');
    await waitFor(() => a.status === 'online', 'online');
    a.edit(a.doc.insert(0, 'survives restarts'));
    await waitFor(() => a.pending === 0, 'ack');
    a.disconnect();

    await server.close();
    server = await startServer({ port: 0, dataDir });
    const b = client('persist', 'Bo');
    await waitFor(() => b.doc.text() === 'survives restarts', 'restored text');
  });
});
