import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { aiDeck, PRO_DECKS, PRO_DOCS } from '../client/src/lib/proTemplates.ts';
import { SLIDE_THEMES } from '../client/src/kinds/slides/themes.ts';
import { startServer, type RunningServer } from '../server/app.ts';
import { cleanKey, keyCandidates, keyProvider } from '../server/llm.ts';
import { DECK_STYLES, PHOTOS } from '../server/routes-tools.ts';

describe('professional templates', () => {
  it('every deck builds eight slides whose elements belong to them', () => {
    assert.ok(PRO_DECKS.length >= 20);
    for (const d of PRO_DECKS) {
      const { objects = [] } = d.build();
      const slides = new Set(objects.filter((o) => o.key.startsWith('slide:')).map((o) => o.key.slice(6)));
      assert.equal(slides.size, 8, d.id);
      for (const o of objects.filter((x) => x.key.startsWith('el:'))) assert.ok(slides.has(String(o.fields.slide)), `${d.id}: orphan element`);
      for (const o of objects.filter((x) => x.fields.kind === 'image')) assert.match(String(o.fields.src), /^\/tpl\/[\w-]+\.jpg$/);
      assert.ok(fs.existsSync(path.join('client/public', String(d.cover))), `${d.id}: missing cover photo`);
    }
  });

  it('document templates have content and a theme', () => {
    for (const d of PRO_DOCS) {
      assert.ok(d.build().tokens.length > 100, d.id);
      assert.ok(d.settings?.theme, d.id);
    }
  });

  it('AI outlines turn into designed decks for every layout', () => {
    const layouts = ['agenda', 'title-content', 'image-text', 'stats', 'process', 'two-column', 'quote', 'section', 'closing', 'mystery'];
    const deck = aiDeck({
      title: 'Solar for homes',
      subtitle: 'Why now',
      theme: 'growth',
      cover: 'idea',
      slides: layouts.map((layout) => ({ layout, title: layout, bullets: ['40% | lower bills', 'Install | in a day', 'Left', 'Right'], notes: '', photo: 'forest' })),
    });
    const slides = deck.objects.filter((o) => o.key.startsWith('slide:'));
    assert.equal(slides.length, layouts.length + 1);
    const texts = deck.objects.map((o) => String(o.fields.text ?? ''));
    assert.ok(texts.includes('40%') && texts.includes('lower bills'), 'stats split on |');
  });

  it('server style lists only name themes and photos that exist', () => {
    const ids = new Set(SLIDE_THEMES.map((t) => t.id));
    for (const list of Object.values(DECK_STYLES)) for (const t of list) assert.ok(ids.has(t), t);
    for (const p of PHOTOS) assert.ok(fs.existsSync(`client/public/tpl/${p}.jpg`), p);
  });

  it('asks Google for extra permissions only when a feature is switched on', async () => {
    const { authorizeUrl, GOOGLE_EXTRAS } = await import('../server/oauth.ts');
    process.env.GOOGLE_CLIENT_ID = 'x.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    try {
      const plain = new URL(authorizeUrl('google', 'http://localhost/cb', 's', true)).searchParams.get('scope') ?? '';
      const gmail = new URL(authorizeUrl('google', 'http://localhost/cb', 's', true, ['gmail'])).searchParams.get('scope') ?? '';
      assert.ok(!plain.includes('gmail'));
      for (const sc of GOOGLE_EXTRAS.gmail) assert.ok(gmail.includes(sc));
      // Extras are requested on their own (Google rejects drive.file together with youtube.readonly).
      const yt = new URL(authorizeUrl('google', 'http://localhost/cb', 's', true, ['youtube'])).searchParams;
      assert.ok(!(yt.get('scope') ?? '').includes('drive'));
      assert.equal(yt.get('include_granted_scopes'), 'true');
    } finally {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
    }
  });

  it('cleans what copying adds to a key', () => {
    const k = 'AQ.Ab8abcdefghijklmnop-XYZ';
    for (const messy of [` ${k}
`, `"${k}"`, `﻿${k} `, `${k.slice(0, 6)}​${k.slice(6)}`, `Bearer ${k}`]) assert.equal(cleanKey(messy), k);
  });

  it('recognises personal key providers', () => {
    assert.equal(keyProvider('gsk_abc'), 'groq');
    assert.equal(keyProvider('sk-or-v1-abc'), 'openrouter');
    assert.equal(keyProvider('AQ.Ab8RN6abc'), 'gemini');
    assert.equal(keyProvider('AIzaSyabc'), 'gemini');
    assert.deepEqual(keyCandidates('csk-abc'), ['cerebras']);
    assert.deepEqual(keyCandidates('hf_abc'), ['huggingface']);
    assert.deepEqual(keyCandidates('github_pat_abc'), ['github']);
    assert.deepEqual(keyCandidates('sk-ant-abc'), ['anthropic']);
    assert.deepEqual(keyCandidates('sk-proj-abc'), ['openai', 'deepseek']);
    // Keys with no known prefix (Mistral, Together…) are tried against several services.
    assert.ok(keyCandidates('a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6').includes('mistral'));
  });
});

describe('workspace apps', () => {
  let server: RunningServer;
  let dataDir: string;
  let cookie = '';
  const api = async (p: string, init: { method?: string; body?: unknown; raw?: Blob; type?: string } = {}) => {
    const res = await fetch(`http://localhost:${server.port}/api${p}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': init.type ?? 'application/json', cookie, 'x-forwarded-for': '10.9.8.7' },
      body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };

  before(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowrite-ws-'));
    server = await startServer({ port: 0, dataDir });
    const r = await api('/auth/signup', { method: 'POST', body: { name: 'Ws User', email: 'ws@example.com', password: 'password123' } });
    assert.equal(r.status, 200);
  });
  after(async () => {
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('calendar events: create, list by range, validate, update and delete', async () => {
    const c = await api('/events', { method: 'POST', body: { title: 'Launch', day: '2027-04-15', start: '09:30', end: '10:00', kind: 'important', color: 'red' } });
    assert.equal(c.status, 201);
    assert.equal((await api('/events', { method: 'POST', body: { title: 'Bad', day: '2027-13-40' } })).status, 400);
    assert.equal((await api('/events', { method: 'POST', body: { title: 'Bad', day: '2027-04-15', start: '10:00', end: '09:00' } })).status, 400);
    const inRange = await api('/events?from=2027-04-01&to=2027-04-30');
    assert.deepEqual(inRange.body.events.map((e: { title: string }) => e.title), ['Launch']);
    assert.equal((await api('/events?from=2027-05-01&to=2027-05-31')).body.events.length, 0);
    const u = await api(`/events/${c.body.event.id}`, { method: 'PUT', body: { title: 'Launch day', day: '2027-04-16' } });
    assert.equal(u.body.event.title, 'Launch day');
    await api(`/events/${c.body.event.id}`, { method: 'DELETE' });
    assert.equal((await api('/events')).body.events.length, 0);
  });

  it('Keep notes: checklists, pins and labels', async () => {
    assert.equal((await api('/notes', { method: 'POST', body: { title: ' ', body: '' } })).status, 400);
    const n = await api('/notes', { method: 'POST', body: { title: 'Groceries', items: [{ text: 'Milk' }, { text: 'Bread', done: true }], color: 'yellow', labels: ['home'] } });
    assert.equal(n.status, 201);
    await api('/notes', { method: 'POST', body: { body: 'Second note' } });
    await api(`/notes/${n.body.note.id}`, { method: 'PUT', body: { ...n.body.note, pinned: true } });
    const list = (await api('/notes')).body.notes;
    assert.equal(list[0].title, 'Groceries');
    assert.equal(list[0].pinned, true);
    assert.deepEqual(list[0].items, [
      { text: 'Milk', done: false },
      { text: 'Bread', done: true },
    ]);
    assert.deepEqual(list[0].labels, ['home']);
  });

  it('Drive lists uploads with storage use, and the backup includes documents', async () => {
    const up = await fetch(`http://localhost:${server.port}/api/files`, { method: 'POST', headers: { 'content-type': 'image/png', 'x-file-name': 'a.png', cookie }, body: new Uint8Array(1234) });
    assert.equal(up.status, 201);
    const files = (await api('/me/files')).body;
    assert.equal(files.files.length, 1);
    assert.equal(files.used, 1234);
    await api('/docs', { method: 'POST', body: { title: 'Backed up', kind: 'doc' } });
    const b = (await api('/me/backup')).body;
    assert.ok(b.documents.some((d: { title: string }) => d.title === 'Backed up'));
  });

  it('connected accounts: status, token checks and owner-only setup', async () => {
    const st = (await api('/integrations')).body;
    assert.equal(st.owner, false);
    assert.equal(st.google.connected, false);
    assert.match(st.google.redirectUri, /\/api\/auth\/oauth\/google\/callback$/);
    assert.equal((await api('/integrations/github/token', { method: 'POST', body: { token: 'not-a-token' } })).status, 400);
    assert.equal((await api('/integrations/setup/google', { method: 'PUT', body: { clientId: 'x.apps.googleusercontent.com', clientSecret: 'secretsecret' } })).status, 403);
    assert.equal((await api('/integrations/github/repos')).status, 400, 'needs a connection first');
    for (const path of ['/integrations/google/gmail', '/integrations/google/youtube', '/integrations/google/tasks', '/integrations/google/files']) {
      const r = await api(path);
      assert.equal(r.status, 400, path);
      assert.match(r.body.error, /Connect your Google account/);
    }
    assert.deepEqual(st.google.features, {});
  });

  it('saves the new appearance and accessibility settings', async () => {
    const r = await api('/auth/me/prefs', { method: 'PUT', body: { theme: 'nord', dyslexic: false, dailyGoal: 300, textSize: 'xl', spacing: 'relaxed', appFont: 'readable', reduceMotion: true, bigCursor: true, bogus: 1 } });
    assert.equal(r.body.prefs.theme, 'nord');
    assert.equal(r.body.prefs.textSize, 'xl');
    assert.equal(r.body.prefs.reduceMotion, true);
    assert.equal(r.body.prefs.bogus, undefined);
    assert.equal((await api('/auth/me/prefs', { method: 'PUT', body: { theme: 'neon' } })).body.prefs.theme, 'light');
  });

  it('AI tools validate input before calling a model', async () => {
    assert.equal((await api('/ai/text', { method: 'POST', body: { task: 'spell', text: '' } })).status, 400);
    assert.equal((await api('/ai/create', { method: 'POST', body: { kind: 'slides', prompt: '' } })).status, 400);
    assert.equal((await api('/ai/file?task=extract', { method: 'POST', raw: new Blob(['x'.repeat(100)]), type: 'text/plain' })).status, 400);
    assert.equal((await api('/ai/chat', { method: 'POST', body: { messages: [] } })).status, 400);
  });
});
