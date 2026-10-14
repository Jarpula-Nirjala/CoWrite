import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { HttpError } from './http.ts';

/** The few things CoWrite asks of a language model, whichever provider answers. */
export interface Llm {
  readonly name: string;
  readonly color: string;
  /** Who pays: 'user' when the person's own key is used. */
  readonly source: 'user' | 'server';
  text(system: string, prompt: string, maxTokens?: number): Promise<string>;
  /** Streams the answer as text fragments. */
  stream(system: string, prompt: string, maxTokens?: number): AsyncIterable<string>;
  json<T>(system: string, prompt: string, schema: Record<string, unknown> & { type: 'object' }, maxTokens?: number): Promise<T>;
  image(data: Buffer, mime: string, ask: string): Promise<string>;
  /** Text to speech: 24 kHz, 16-bit mono PCM. Null when the provider has no voice. */
  speech?(text: string, voice: string): Promise<Buffer>;
}

// ------------------------------------------------------------------- Claude

const CLAUDE_MODEL = 'claude-opus-5-5';
const BETAS = ['server-side-fallback-2026-07-01'];

function claudeError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof Anthropic.RateLimitError) return new HttpError(429, 'The AI service is busy right now. Please try again shortly.');
  if (err instanceof Anthropic.AuthenticationError) return new HttpError(503, 'The AI features are misconfigured (invalid API key).');
  if (err instanceof Anthropic.BadRequestError) return new HttpError(400, 'The AI service could not process this request.');
  if (err instanceof Anthropic.APIError) return new HttpError(502, `The AI service returned an error (${err.status ?? 'network'}).`);
  return new HttpError(500, 'The AI request failed.');
}

export class ClaudeLlm implements Llm {
  readonly name = 'Claude';
  readonly color = '#c15f3c';
  readonly source = 'server' as const;
  private readonly client = new Anthropic();

  async text(system: string, prompt: string, maxTokens = 8000): Promise<string> {
    try {
      const stream = this.client.beta.messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        output_config: { effort: 'low' },
        betas: BETAS,
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') throw new HttpError(422, 'Claude declined this request.');
      return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    } catch (err) {
      throw claudeError(err);
    }
  }

  async *stream(system: string, prompt: string, maxTokens = 16000): AsyncIterable<string> {
    try {
      const stream = this.client.beta.messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        output_config: { effort: 'low' },
        betas: BETAS,
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') throw new HttpError(422, 'Claude declined this request.');
    } catch (err) {
      throw claudeError(err);
    }
  }

  async json<T>(system: string, prompt: string, schema: Record<string, unknown> & { type: 'object' }, maxTokens = 12000): Promise<T> {
    try {
      const msg = await this.client.beta.messages.parse({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        output_config: { effort: 'low', format: betaJSONSchemaOutputFormat(schema) },
        betas: BETAS,
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      if (msg.stop_reason === 'refusal') throw new HttpError(422, 'Claude declined this request.');
      if (!msg.parsed_output) throw new HttpError(502, 'The AI returned an unexpected answer. Please try again.');
      return msg.parsed_output as T;
    } catch (err) {
      throw claudeError(err);
    }
  }

  async image(data: Buffer, mime: string, ask: string): Promise<string> {
    const media = (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime) ? mime : 'image/png') as 'image/png';
    try {
      const msg = await this.client.beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        output_config: { effort: 'low' },
        betas: BETAS,
        fallbacks: 'default',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: media, data: data.toString('base64') } },
              { type: 'text', text: ask },
            ],
          },
        ],
      });
      if (msg.stop_reason === 'refusal') throw new HttpError(422, 'Claude declined this request.');
      return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    } catch (err) {
      throw claudeError(err);
    }
  }
}

// ------------------------------------------------------------------- Gemini

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code: number; message: string; status: string };
}

/** Gemini's schema dialect (an OpenAPI subset) has no additionalProperties. */
function geminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (!s || typeof s !== 'object') return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (k !== 'additionalProperties' && k !== '$schema') out[k] = geminiSchema(v);
  return out;
}

function geminiError(status: number, body: GeminiResponse | null, source: 'user' | 'server'): HttpError {
  const msg = body?.error?.message ?? '';
  if (status === 429) {
    return new HttpError(429, source === 'user' ? 'Your free Gemini limit is used up for now. Please wait a minute (or until tomorrow for the daily limit).' : 'The free AI limit for this site is used up for now. Connect your own free Gemini key in Account settings, or try again later.');
  }
  if (status === 400 && /API key/i.test(msg)) return new HttpError(source === 'user' ? 400 : 503, source === 'user' ? 'Your Gemini API key is not valid. Check it in Account settings.' : 'The site’s Gemini key is not valid.');
  if (status === 403) return new HttpError(403, 'Gemini refused this key. Make sure the Generative Language API is enabled for it in Google AI Studio.');
  if (status === 400) return new HttpError(400, 'Gemini could not process this request.');
  return new HttpError(502, `Gemini returned an error (${status}).`);
}

export class GeminiLlm implements Llm {
  readonly name = 'Gemini';
  readonly color = '#1a73e8';
  readonly source: 'user' | 'server';
  private readonly key: string;

  constructor(key: string, source: 'user' | 'server') {
    this.key = key;
    this.source = source;
  }

  private async call(model: string, method: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${GEMINI_BASE}/models/${model}:${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(120_000),
      });
    } catch {
      throw new HttpError(502, 'Could not reach Gemini. Please try again.');
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as GeminiResponse | null;
      throw geminiError(res.status, err, this.source);
    }
    return res;
  }

  private request(system: string, parts: GeminiPart[], maxTokens: number, extra: Record<string, unknown> = {}) {
    return {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 }, ...extra },
    };
  }

  private static textOf(r: GeminiResponse): string {
    if (r.promptFeedback?.blockReason) throw new HttpError(422, 'Gemini declined this request.');
    const c = r.candidates?.[0];
    if (c?.finishReason === 'SAFETY' || c?.finishReason === 'PROHIBITED_CONTENT') throw new HttpError(422, 'Gemini declined this request.');
    return (c?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  }

  async text(system: string, prompt: string, maxTokens = 8000): Promise<string> {
    const res = await this.call(GEMINI_MODEL, 'generateContent', this.request(system, [{ text: prompt }], maxTokens));
    return GeminiLlm.textOf((await res.json()) as GeminiResponse).trim();
  }

  async *stream(system: string, prompt: string, maxTokens = 16000): AsyncIterable<string> {
    const res = await this.call(GEMINI_MODEL, 'streamGenerateContent?alt=sse', this.request(system, [{ text: prompt }], maxTokens));
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
        if (!line.startsWith('data:')) continue;
        const text = GeminiLlm.textOf(JSON.parse(line.slice(5)) as GeminiResponse);
        if (text) yield text;
      }
    }
  }

  async json<T>(system: string, prompt: string, schema: Record<string, unknown> & { type: 'object' }, maxTokens = 12000): Promise<T> {
    const res = await this.call(GEMINI_MODEL, 'generateContent', this.request(system, [{ text: prompt }], maxTokens, { responseMimeType: 'application/json', responseSchema: geminiSchema(schema) }));
    const text = GeminiLlm.textOf((await res.json()) as GeminiResponse);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(502, 'The AI returned an unexpected answer. Please try again.');
    }
  }

  async image(data: Buffer, mime: string, ask: string): Promise<string> {
    const res = await this.call(GEMINI_MODEL, 'generateContent', this.request('', [{ inlineData: { mimeType: mime || 'image/png', data: data.toString('base64') } }, { text: ask }], 4000));
    return GeminiLlm.textOf((await res.json()) as GeminiResponse).trim();
  }

  async speech(text: string, voice: string): Promise<Buffer> {
    const res = await this.call(GEMINI_TTS_MODEL, 'generateContent', {
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    });
    const r = (await res.json()) as GeminiResponse;
    const audio = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
    if (!audio) throw new HttpError(502, 'Gemini returned no audio.');
    return Buffer.from(audio, 'base64');
  }
}

// ---------------------------------------------- Groq and OpenRouter (free tiers)

/** Chat-completions providers with free tiers: Groq (keys start "gsk_") and OpenRouter ("sk-or-"). */
const COMPAT = {
  groq: {
    name: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    vision: process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
    check: '/models',
  },
  openrouter: {
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
    vision: process.env.OPENROUTER_VISION_MODEL || 'google/gemma-3-27b-it:free',
    check: '/key',
  },
} as const;
export type CompatProvider = keyof typeof COMPAT;

type ChatReply = { choices?: { message?: { content?: string } }[] };

export class CompatLlm implements Llm {
  readonly name: string;
  readonly color = '#7c3aed';
  readonly source: 'user' | 'server';
  private readonly key: string;
  private readonly cfg: (typeof COMPAT)[CompatProvider];

  constructor(provider: CompatProvider, key: string, source: 'user' | 'server') {
    this.cfg = COMPAT[provider];
    this.name = this.cfg.name;
    this.key = key;
    this.source = source;
  }

  private async call(body: Record<string, unknown>): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}`, 'x-title': 'CoWrite' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new HttpError(502, `Could not reach ${this.name}. Please try again.`);
    }
    if (!res.ok) {
      if (res.status === 429) throw new HttpError(429, `The free ${this.name} limit is used up for now. Please wait a minute and try again.`);
      if (res.status === 401 || res.status === 403) throw new HttpError(400, `${this.name} did not accept your key. Check it in Account settings.`);
      throw new HttpError(502, `${this.name} returned an error (${res.status}).`);
    }
    return res;
  }

  private messages(system: string, user: unknown) {
    return [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }];
  }

  async text(system: string, prompt: string, maxTokens = 8000): Promise<string> {
    const res = await this.call({ model: this.cfg.model, max_tokens: Math.min(maxTokens, 8000), messages: this.messages(system, prompt) });
    return (((await res.json()) as ChatReply).choices?.[0]?.message?.content ?? '').trim();
  }

  async *stream(system: string, prompt: string, maxTokens = 8000): AsyncIterable<string> {
    const res = await this.call({ model: this.cfg.model, max_tokens: Math.min(maxTokens, 8000), stream: true, messages: this.messages(system, prompt) });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
        if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
        try {
          const text = (JSON.parse(line.slice(5)) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {
          // keep-alive comments and partial lines
        }
      }
    }
  }

  async json<T>(system: string, prompt: string, schema: Record<string, unknown> & { type: 'object' }, maxTokens = 8000): Promise<T> {
    const res = await this.call({
      model: this.cfg.model,
      max_tokens: Math.min(maxTokens, 8000),
      response_format: { type: 'json_object' },
      messages: this.messages(`${system}\n\nReply with a single JSON object that matches this JSON Schema, and nothing else:\n${JSON.stringify(schema)}`, prompt),
    });
    const text = ((await res.json()) as ChatReply).choices?.[0]?.message?.content ?? '';
    try {
      return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as T;
    } catch {
      throw new HttpError(502, 'The AI returned an unexpected answer. Please try again.');
    }
  }

  async image(data: Buffer, mime: string, ask: string): Promise<string> {
    const res = await this.call({
      model: this.cfg.vision,
      max_tokens: 2000,
      messages: [{ role: 'user', content: [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url: `data:${mime || 'image/png'};base64,${data.toString('base64')}` } }] }],
    });
    return (((await res.json()) as ChatReply).choices?.[0]?.message?.content ?? '').trim();
  }
}

/** Which service a personal key belongs to, from its shape. */
export function keyProvider(key: string): 'gemini' | CompatProvider {
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('sk-or-')) return 'openrouter';
  return 'gemini';
}

/** The model for a personal key. */
export function llmForKey(key: string, source: 'user' | 'server'): Llm {
  const p = keyProvider(key);
  return p === 'gemini' ? new GeminiLlm(key, source) : new CompatLlm(p, key, source);
}

/** Checks a key with its provider without spending tokens. */
export async function checkKey(key: string): Promise<boolean> {
  const p = keyProvider(key);
  try {
    if (p === 'gemini') {
      // Older keys start "AIza"; newer AI Studio keys start "AQ.". Try the header, then the query parameter.
      const res = await fetch(`${GEMINI_BASE}/models?pageSize=1`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10_000) });
      if (res.ok) return true;
      const alt = await fetch(`${GEMINI_BASE}/models?pageSize=1&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10_000) });
      return alt.ok;
    }
    const res = await fetch(`${COMPAT[p].base}${COMPAT[p].check}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch {
    return false;
  }
}
