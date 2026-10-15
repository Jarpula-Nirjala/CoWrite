import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { GeminiLlm, resetGeminiState } from '../server/llm.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetGeminiState();
});

/** Records requests and answers with canned Gemini responses. */
function stub(respond: (url: string, body: any) => Response) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, headers: init.headers as Record<string, string> });
    return respond(url, body);
  }) as typeof fetch;
  return calls;
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const answer = (text: string) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });

test('text: sends the key in a header, the system prompt separately, and reads the answer', async () => {
  const calls = stub(() => json(answer('  Hello there  ')));
  const g = new GeminiLlm('AIzaTEST', 'user');
  assert.equal(await g.text('Be brief.', 'Say hi', 100), 'Hello there');
  assert.match(calls[0].url, /models\/gemini-flash-latest:generateContent$/);
  assert.equal(calls[0].headers['x-goog-api-key'], 'AIzaTEST');
  assert.equal(calls[0].body.systemInstruction.parts[0].text, 'Be brief.');
  assert.equal(calls[0].body.contents[0].parts[0].text, 'Say hi');
  assert.equal(calls[0].body.generationConfig.maxOutputTokens, 100);
});

test('json: strips additionalProperties from the schema and parses the reply', async () => {
  const calls = stub(() => json(answer('{"items":[{"n":0,"text":"hola"}]}')));
  const g = new GeminiLlm('k'.repeat(30), 'server');
  const out = await g.json<{ items: { n: number; text: string }[] }>('', 'translate', {
    type: 'object',
    properties: { items: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' } }, additionalProperties: false } } },
    additionalProperties: false,
  });
  assert.equal(out.items[0].text, 'hola');
  const schema = JSON.stringify(calls[0].body.generationConfig.responseSchema);
  assert.ok(!schema.includes('additionalProperties'));
  assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');
});

test('stream: yields text from server-sent events', async () => {
  stub(() => new Response(`data: ${JSON.stringify(answer('Hel'))}\n\ndata: ${JSON.stringify(answer('lo\nworld'))}\n\n`, { status: 200 }));
  const g = new GeminiLlm('k'.repeat(30), 'user');
  let all = '';
  for await (const part of g.stream('', 'x')) all += part;
  assert.equal(all, 'Hello\nworld');
});

test('errors: a used-up free quota gets a friendly message', async () => {
  stub(() => json({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }, 429));
  await assert.rejects(new GeminiLlm('k'.repeat(30), 'user').text('', 'x'), (e: Error & { status?: number }) => e.status === 429 && /free Gemini limit/.test(e.message));
  stub(() => json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 400));
  await assert.rejects(new GeminiLlm('k'.repeat(30), 'user').text('', 'x'), /not valid/);
});

test('speech: returns the PCM audio bytes', async () => {
  const pcm = Buffer.from([1, 0, 2, 0]);
  const calls = stub(() => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm.toString('base64') } }] } }] }));
  const out = await new GeminiLlm('k'.repeat(30), 'user').speech('Hello', 'Kore');
  assert.deepEqual([...out], [1, 0, 2, 0]);
  assert.match(calls[0].url, /preview-tts:generateContent$/);
  assert.equal(calls[0].body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
});

test('falls back to the next model when one is retired for new keys', async () => {
  const calls = stub((url) => (url.includes('/gemini-flash-latest:') ? json({ error: { code: 404, message: 'This model is no longer available to new users.' } }, 404) : json(answer('ok'))));
  const g = new GeminiLlm('AQ.Ab8newstylekey', 'user');
  assert.equal(await g.text('', 'hi', 50), 'ok');
  assert.match(calls[0].url, /gemini-flash-latest/);
  assert.match(calls[1].url, /gemini-3\.5-flash:/);
  // The working model is remembered, so the retired one is not tried again.
  await g.text('', 'again', 50);
  assert.match(calls[2].url, /gemini-3\.5-flash:/);
});

test('retries without thinkingConfig when a model rejects every low-thinking setting', async () => {
  const calls = stub((_url, body) => (body.generationConfig.thinkingConfig ? json({ error: { code: 400, message: 'Request contains an invalid argument.' } }, 400) : json(answer('fine'))));
  const g = new GeminiLlm('AIzaTEST', 'user');
  assert.equal(await g.text('', 'hi', 50), 'fine');
  assert.deepEqual(calls[0].body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.equal(calls.at(-1)!.body.generationConfig.thinkingConfig, undefined);
});

test('newer models that refuse a zero budget get the minimal thinking level, remembered for later requests', async () => {
  // Like Gemini 3 models: a budget of 0 is invalid, a thinking level is fine.
  const calls = stub((_url, body) => (body.generationConfig.thinkingConfig?.thinkingBudget === 0 ? json({ error: { code: 400, message: 'Budget 0 is invalid. This model only works in thinking mode.' } }, 400) : json(answer('quick'))));
  const g = new GeminiLlm('AIzaTEST', 'user');
  assert.equal(await g.text('', 'hi', 50), 'quick');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  // The second request goes straight to the setting that worked: one call, still minimal thinking.
  assert.equal(await g.text('', 'again', 50), 'quick');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
});

test('stream: asks for minimal thinking and yields text as it arrives', async () => {
  stub((_url, body) => {
    if (body.generationConfig.thinkingConfig?.thinkingBudget === 0) return json({ error: { code: 400, message: 'invalid' } }, 400);
    const sse = ['Hel', 'lo'].map((t) => `data: ${JSON.stringify(answer(t))}\n\n`).join('');
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
  const parts: string[] = [];
  for await (const p of new GeminiLlm('AIzaTEST', 'user').stream('', 'hi', 50)) parts.push(p);
  assert.deepEqual(parts, ['Hel', 'lo']);
});
