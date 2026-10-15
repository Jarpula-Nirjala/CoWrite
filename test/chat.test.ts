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
  const api = async (p: string, body: unknown) => {
    const res = await realFetch(`http://localhost:${server.port}/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '10.9.8.6' }, body: JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, text: await res.text() };
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
});
