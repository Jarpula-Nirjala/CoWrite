import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startServer, type RunningServer } from '../server/app.ts';
import { resetGeminiState } from '../server/llm.ts';

/** The assistant chat end to end, with Gemini's HTTP API replaced by a recorder. */
describe('assistant chat with attachments', () => {
  let server: RunningServer;
  let cookie = '';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowrite-chat-'));
  const realFetch = globalThis.fetch;
  const sent: any[] = [];
  const api = async (p: string, body: unknown) => req(p, { method: 'POST', body: JSON.stringify(body), type: 'application/json' });
  /** Any request as the signed-in person; `as` switches to another account's cookie. */
  const req = async (p: string, init: { method?: string; body?: BodyInit; type?: string; headers?: Record<string, string>; as?: string } = {}) => {
    const res = await realFetch(`http://localhost:${server.port}/api${p}`, { method: init.method ?? 'GET', headers: { ...(init.type ? { 'content-type': init.type } : {}), cookie: init.as ?? cookie, 'x-forwarded-for': '10.9.8.6', ...init.headers }, body: init.body });
    const set = res.headers.get('set-cookie');
    if (set && init.as === undefined) cookie = set.split(';')[0];
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // plain text answer
    }
    return { status: res.status, text, json, cookie: set?.split(';')[0] };
  };

  before(async () => {
    process.env.GEMINI_API_KEY = 'AIzaCHATTEST';
    resetGeminiState();
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes('generativelanguage.googleapis.com')) return realFetch(url, init);
      sent.push(JSON.parse(String(init?.body)));
      const sse = ['The file ', 'says hello.'].map((t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`).join('');
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    server = await startServer({ port: 0, dataDir });
    assert.equal((await api('/auth/signup', { name: 'Chat User', email: 'chat@example.com', password: 'password123' })).status, 200);
  });
  after(async () => {
    globalThis.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
    resetGeminiState();
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('sends PDFs and images to the model as files, and text files as their text', async () => {
    const pdf = Buffer.from('%PDF-1.4 tiny').toString('base64');
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
    const r = await api('/ai/chat', {
      messages: [
        {
          role: 'user',
          text: 'What do these say?',
          files: [
            { name: 'report.pdf', mime: 'application/pdf', data: pdf },
            { name: 'photo.png', mime: 'image/png', data: png },
            { name: 'notes.md', mime: 'text/markdown', text: '# Notes\nShip on Friday.' },
            { name: 'virus.exe', mime: 'application/x-msdownload', data: 'AAAA' },
          ],
        },
      ],
    });
    assert.equal(r.status, 200);
    assert.equal(r.text, 'The file says hello.');
    const parts = sent.at(-1).contents[0].parts;
    assert.deepEqual(
      parts.filter((p: any) => p.inlineData).map((p: any) => p.inlineData.mimeType),
      ['application/pdf', 'image/png'],
    );
    const prompt = parts.at(-1).text as string;
    assert.match(prompt, /<file name="notes.md">\n# Notes\nShip on Friday.\n<\/file>/);
    assert.match(prompt, /\[Attached: report.pdf\]/);
    assert.match(prompt, /What do these say\?/);
    assert.doesNotMatch(prompt, /virus/);
  });

  it('a message with only a file is accepted; oversized attachments are refused', async () => {
    assert.equal((await api('/ai/chat', { messages: [{ role: 'user', text: '', files: [{ name: 'a.txt', mime: 'text/plain', text: 'hi' }] }] })).status, 200);
    const big = Buffer.alloc(21_000_000).toString('base64');
    assert.equal((await api('/ai/chat', { messages: [{ role: 'user', text: 'x', files: [{ name: 'big.pdf', mime: 'application/pdf', data: big }] }] })).status, 413);
  });

  it('chats and their files are kept with the account, privately, and cleaned up with the chat', async () => {
    // Store a PDF and a text file with the account.
    const pdf = await req('/assistant/files', { method: 'POST', body: Buffer.from('%PDF-1.4 stored'), type: 'application/pdf', headers: { 'x-file-name': 'plan.pdf' } });
    assert.equal(pdf.status, 201);
    const md = await req('/assistant/files', { method: 'POST', body: '# Plan\nLaunch in May.', type: 'text/plain', headers: { 'x-file-name': 'plan.md', 'x-file-kind': 'text', 'x-original-type': 'text/markdown' } });
    assert.equal(md.status, 201);
    assert.equal((await req('/assistant/files', { method: 'POST', body: 'MZ', type: 'application/x-msdownload', headers: { 'x-file-name': 'a.exe' } })).status, 400);

    // A later question refers to them by id only; the server reads them for the model.
    const before = sent.length;
    const r = await api('/ai/chat', { messages: [{ role: 'user', text: 'Summarise', files: [{ id: pdf.json.id }, { id: md.json.id }] }] });
    assert.equal(r.status, 200);
    const parts = sent[before].contents[0].parts;
    assert.equal(parts[0].inlineData.mimeType, 'application/pdf');
    assert.equal(Buffer.from(parts[0].inlineData.data, 'base64').toString(), '%PDF-1.4 stored');
    assert.match(parts.at(-1).text, /<file name="plan.md">\n# Plan\nLaunch in May.\n<\/file>/);

    // The chat itself is saved and listed.
    const messages = [{ role: 'user', text: 'Summarise', files: [{ id: pdf.json.id, name: 'plan.pdf', mime: 'application/pdf', size: 15 }, { id: md.json.id, name: 'plan.md', mime: 'text/markdown', size: 22 }] }, { role: 'assistant', text: 'It launches in May.' }];
    assert.equal((await req('/assistant/chats/chat-abc123', { method: 'PUT', body: JSON.stringify({ title: 'Launch plan', messages }), type: 'application/json' })).status, 200);
    assert.deepEqual((await req('/assistant/chats')).json.chats.map((c: any) => c.title), ['Launch plan']);
    const got = (await req('/assistant/chats/chat-abc123')).json.chat;
    assert.equal(got.messages[1].text, 'It launches in May.');
    assert.equal(got.messages[0].files[0].id, pdf.json.id);
    assert.equal((await req(`/assistant/files/${md.json.id}`)).text, '# Plan\nLaunch in May.');

    // Someone else can neither see the chat nor use or open the files.
    const other = await req('/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Other', email: 'other-chat@example.com', password: 'password123' }), type: 'application/json', as: '' });
    const them = other.cookie!;
    assert.equal((await req('/assistant/chats', { as: them })).json.chats.length, 0);
    assert.equal((await req('/assistant/chats/chat-abc123', { as: them })).status, 404);
    assert.equal((await req(`/assistant/files/${pdf.json.id}`, { as: them })).status, 404);
    const n = sent.length;
    await req('/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', text: 'x', files: [{ id: pdf.json.id }] }] }), type: 'application/json', as: them });
    assert.equal(sent[n].contents[0].parts.filter((p: any) => p.inlineData).length, 0);

    // Deleting the chat removes its files.
    assert.equal((await req('/assistant/chats/chat-abc123', { method: 'DELETE' })).json.removedFiles, 2);
    assert.equal((await req(`/assistant/files/${pdf.json.id}`)).status, 404);
    assert.equal((await req('/assistant/chats')).json.chats.length, 0);
  });
});
