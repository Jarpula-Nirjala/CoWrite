import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { HttpError } from './http.ts';

/** An image or PDF attached to a prompt. */
export interface LlmFile {
  name: string;
  mime: string;
  data: Buffer;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** The few things CoWrite asks of a language model, whichever provider answers. */
export interface Llm {
  readonly name: string;
  readonly color: string;
  /** Who pays: 'user' when the person's own key is used. */
  readonly source: 'user' | 'server';
  text(system: string, prompt: string, maxTokens?: number): Promise<string>;
  /** Streams the answer as text fragments; `files` are images or PDFs the model reads alongside the prompt. */
  stream(system: string, prompt: string, maxTokens?: number, files?: LlmFile[]): AsyncIterable<string>;
  json<T>(system: string, prompt: string, schema: Record<string, unknown> & { type: 'object' }, maxTokens?: number): Promise<T>;
  /** Reads an image (or a PDF, where the provider supports it) and answers about it. */
  image(data: Buffer, mime: string, ask: string, maxTokens?: number): Promise<string>;
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
  readonly source: 'user' | 'server';
  private readonly client: Anthropic;

  constructor(key?: string, source: 'user' | 'server' = 'server') {
    this.client = key ? new Anthropic({ apiKey: key }) : new Anthropic();
    this.source = source;
  }

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

  async *stream(system: string, prompt: string, maxTokens = 16000, files: LlmFile[] = []): AsyncIterable<string> {
    const blocks = files.map((f) =>
      f.mime === 'application/pdf'
        ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data.toString('base64') }, title: f.name } as const)
        : ({ type: 'image', source: { type: 'base64', media_type: (IMAGE_TYPES.includes(f.mime) ? f.mime : 'image/png') as 'image/png', data: f.data.toString('base64') } } as const),
    );
    try {
      const stream = this.client.beta.messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        output_config: { effort: 'low' },
        betas: BETAS,
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: blocks.length ? [...blocks, { type: 'text', text: prompt }] : prompt }],
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

  async image(data: Buffer, mime: string, ask: string, maxTokens = 4000): Promise<string> {
    const media = (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime) ? mime : 'image/png') as 'image/png';
    const file =
      mime === 'application/pdf'
        ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') } } as const)
        : ({ type: 'image', source: { type: 'base64', media_type: media, data: data.toString('base64') } } as const);
    try {
      const msg = await this.client.beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        output_config: { effort: 'low' },
        betas: BETAS,
        fallbacks: 'default',
        messages: [
          {
            role: 'user',
            content: [
              file,
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
/**
 * Google retires model versions for new keys (gemini-2.5-flash answers 404 for keys made after its retirement),
 * so text requests go to the always-current alias first and fall back through newer and older versions.
 */
const GEMINI_MODEL = 'text';
const GEMINI_TTS_MODEL = 'tts';
const MODEL_CHAINS: Record<string, string[]> = {
  text: [...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []), 'gemini-flash-latest', 'gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash'],
  tts: [...(process.env.GEMINI_TTS_MODEL ? [process.env.GEMINI_TTS_MODEL] : []), 'gemini-2.5-flash-preview-tts', 'gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview'],
};
/** The model that last worked, per chain, so later requests skip retired ones. */
const workingModel = new Map<string, string>();
/**
 * Ways to ask for as little thinking as possible, tried in order. Older models take a budget of 0; newer ones
 * reject that and take a level instead. Without any of these a newer model thinks at length before its first
 * word, which makes chat feel stuck.
 */
const LOW_THINKING: Record<string, unknown>[] = [{ thinkingBudget: 0 }, { thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }];
/** Per model, which of LOW_THINKING it accepted (LOW_THINKING.length = none of them). */
const thinkingFor = new Map<string, number>();

/** Forgets learned models and thinking settings (for tests). */
export function resetGeminiState() {
  workingModel.clear();
  thinkingFor.clear();
}

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
  if (status === 401) return new HttpError(source === 'user' ? 400 : 503, source === 'user' ? 'Google did not accept your Gemini key. Copy it again from Google AI Studio.' : 'The site’s Gemini key is not valid.');
  if (status === 400) return new HttpError(400, `Gemini could not process this request${msg ? ` (${msg.slice(0, 140)})` : ''}.`);
  if (status === 503) return new HttpError(503, 'Gemini is very busy right now. Please try again in a moment.');
  return new HttpError(502, `Gemini returned an error (${status}${msg ? `: ${msg.slice(0, 120)}` : ''}).`);
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

  private async call(chain: string, method: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const all = MODEL_CHAINS[chain] ?? [chain];
    const first = workingModel.get(chain);
    const models = first ? [first, ...all.filter((m) => m !== first)] : all;
    // A request that asks for little thinking is tried with each form of that setting the models understand,
    // then without it; the form a model accepts is remembered so later requests need only one call.
    const g = (body as { generationConfig?: Record<string, unknown> }).generationConfig;
    const variants: unknown[] = [body];
    if (g?.thinkingConfig) {
      const { thinkingConfig: _t, ...rest } = g;
      variants.splice(0, 1, ...LOW_THINKING.map((t) => ({ ...(body as object), generationConfig: { ...rest, thinkingConfig: t } })), { ...(body as object), generationConfig: rest });
    }
    const send = (model: string, b: unknown) =>
      fetch(`${GEMINI_BASE}/models/${model}:${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
        body: JSON.stringify(b),
        signal: signal ?? AbortSignal.timeout(120_000),
      });
    let last: HttpError | null = null;
    // Two rounds: a model that is merely busy (503) often answers a moment later.
    for (let round = 0; round < 2; round++) {
      let busy = false;
      for (const model of models) {
        let res: Response;
        try {
          let v = variants.length > 1 ? Math.min(thinkingFor.get(model) ?? 0, variants.length - 1) : 0;
          res = await send(model, variants[v]);
          while (res.status === 400 && v < variants.length - 1) res = await send(model, variants[++v]);
          if (variants.length > 1 && res.status !== 400) thinkingFor.set(model, v);
        } catch {
          throw new HttpError(502, 'Could not reach Gemini. Please try again.');
        }
        if (res.ok) {
          workingModel.set(chain, model);
          return res;
        }
        const err = (await res.json().catch(() => null)) as GeminiResponse | null;
        last = geminiError(res.status, err, this.source);
        if (res.status === 503 || res.status === 500) busy = true;
        // Retired or unknown model, or one that is overloaded right now: try the next one.
        if (res.status === 404 || res.status === 500 || res.status === 503) continue;
        throw last;
      }
      if (!busy) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw last ?? new HttpError(502, 'Gemini is unavailable right now. Please try again.');
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

  async *stream(system: string, prompt: string, maxTokens = 16000, files: LlmFile[] = []): AsyncIterable<string> {
    const parts: GeminiPart[] = [...files.map((f) => ({ inlineData: { mimeType: f.mime, data: f.data.toString('base64') } })), { text: prompt }];
    const res = await this.call(GEMINI_MODEL, 'streamGenerateContent?alt=sse', this.request(system, parts, maxTokens));
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    try {
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
    } finally {
      // The reader stopped early (the person left the chat): stop downloading the rest of the answer.
      void reader.cancel().catch(() => {});
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

  async image(data: Buffer, mime: string, ask: string, maxTokens = 4000): Promise<string> {
    const res = await this.call(GEMINI_MODEL, 'generateContent', this.request('', [{ inlineData: { mimeType: mime || 'image/png', data: data.toString('base64') } }, { text: ask }], maxTokens));
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

// ------------------------------------- other providers (OpenAI-compatible APIs)

interface CompatConfig {
  name: string;
  base: string;
  /** Model preferences, best first; the first one this key can use wins. */
  prefer: RegExp[];
  /** Used when the model list cannot be read. */
  fallback: string;
  /** Vision model preferences (image tools); empty when the provider has none. */
  vision: RegExp[];
  /** Read-only request that fails for a wrong key (relative to base, or absolute). */
  check: string;
}

/** Chat-completions services, most with free tiers. Keys are recognised by their prefix where they have one. */
const COMPAT = {
  groq: {
    name: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    prefer: [/^llama-3\.3-70b-versatile$/, /^openai\/gpt-oss-120b$/, /^meta-llama\/llama-4-maverick/, /llama.*70b/, /^qwen/],
    fallback: 'llama-3.3-70b-versatile',
    vision: [/llama-4-scout/, /llama-4-maverick/, /vision/],
    check: '/models',
  },
  openrouter: {
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    prefer: [/^meta-llama\/llama-3\.3-70b-instruct:free$/, /^openai\/gpt-oss-120b:free$/, /^deepseek\/.*:free$/, /^qwen\/.*:free$/, /^google\/gemma.*:free$/, /:free$/],
    fallback: 'meta-llama/llama-3.3-70b-instruct:free',
    vision: [/^google\/gemma-3.*:free$/, /^meta-llama\/llama-4.*:free$/, /vl.*:free$/],
    check: '/key',
  },
  cerebras: {
    name: 'Cerebras',
    base: 'https://api.cerebras.ai/v1',
    prefer: [/^gpt-oss-120b$/, /^llama-3\.3-70b$/, /^qwen-3.*instruct/, /^llama/],
    fallback: 'llama-3.3-70b',
    vision: [],
    check: '/models',
  },
  mistral: {
    name: 'Mistral',
    base: 'https://api.mistral.ai/v1',
    prefer: [/^mistral-medium-latest$/, /^mistral-small-latest$/, /^mistral-large-latest$/, /^open-mistral/],
    fallback: 'mistral-small-latest',
    vision: [/^mistral-medium-latest$/, /^mistral-small-latest$/, /^pixtral/],
    check: '/models',
  },
  huggingface: {
    name: 'Hugging Face',
    base: 'https://router.huggingface.co/v1',
    prefer: [/Llama-3\.3-70B-Instruct/i, /gpt-oss-120b/i, /Qwen.*Instruct/i, /DeepSeek-V3/i],
    fallback: 'meta-llama/Llama-3.3-70B-Instruct',
    vision: [/Llama-4-Scout/i, /Qwen.*VL/i, /gemma-3/i],
    check: 'https://huggingface.co/api/whoami-v2',
  },
  github: {
    name: 'GitHub Models',
    base: 'https://models.github.ai/inference',
    prefer: [],
    fallback: 'openai/gpt-4.1-mini',
    vision: [],
    check: 'chat',
  },
  together: {
    name: 'Together AI',
    base: 'https://api.together.xyz/v1',
    prefer: [/Llama-3\.3-70B-Instruct-Turbo-Free/i, /Llama-3\.3-70B-Instruct-Turbo/i, /gpt-oss-120b/i, /Qwen.*Instruct/i],
    fallback: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
    vision: [/Llama-4-Scout/i, /Llama-Vision-Free/i, /VL/],
    check: '/models',
  },
  deepseek: {
    name: 'DeepSeek',
    base: 'https://api.deepseek.com/v1',
    prefer: [/^deepseek-chat$/],
    fallback: 'deepseek-chat',
    vision: [],
    check: '/models',
  },
  openai: {
    name: 'ChatGPT',
    base: 'https://api.openai.com/v1',
    prefer: [/^gpt-5(\.\d+)?-mini$/, /^gpt-4\.1-mini$/, /^gpt-4o-mini$/],
    fallback: 'gpt-4o-mini',
    vision: [/^gpt-5(\.\d+)?-mini$/, /^gpt-4\.1-mini$/, /^gpt-4o-mini$/],
    check: '/models',
  },
} satisfies Record<string, CompatConfig>;
export type CompatProvider = keyof typeof COMPAT;
export type Provider = 'gemini' | 'anthropic' | CompatProvider;

/** Display names, for the account page and the AI's byline. */
export const PROVIDER_NAMES: Record<Provider, string> = {
  gemini: 'Gemini',
  anthropic: 'Claude',
  ...(Object.fromEntries(Object.entries(COMPAT).map(([k, v]) => [k, v.name])) as Record<CompatProvider, string>),
};

type ChatReply = { choices?: { message?: { content?: string } }[] };

/** Model ids each key can use, cached for an hour. */
const modelLists = new Map<string, { at: number; ids: string[] }>();
async function modelIds(cfg: CompatConfig, key: string): Promise<string[]> {
  const id = `${cfg.base}|${key.slice(-12)}`;
  const hit = modelLists.get(id);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.ids;
  let ids: string[] = [];
  try {
    const res = await fetch(`${cfg.base}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const j = (await res.json()) as { data?: { id: string }[] } | { id: string }[];
      ids = (Array.isArray(j) ? j : (j.data ?? [])).map((m) => m.id).filter(Boolean);
    }
  } catch {
    // Fall back to the configured default model.
  }
  modelLists.set(id, { at: Date.now(), ids });
  return ids;
}
const choose = (ids: string[], prefer: RegExp[]) => {
  for (const re of prefer) {
    const m = ids.find((x) => re.test(x));
    if (m) return m;
  }
  return null;
};

export class CompatLlm implements Llm {
  readonly name: string;
  readonly color = '#7c3aed';
  readonly source: 'user' | 'server';
  private readonly key: string;
  private readonly cfg: CompatConfig;

  constructor(provider: CompatProvider, key: string, source: 'user' | 'server') {
    this.cfg = COMPAT[provider];
    this.name = this.cfg.name;
    this.key = key;
    this.source = source;
  }

  private async model(vision = false): Promise<string> {
    const ids = await modelIds(this.cfg, this.key);
    if (vision) {
      if (!this.cfg.vision.length) throw new HttpError(400, `${this.name} cannot read images. Connect a free Gemini key in Account → AI to use photo and PDF tools.`);
      const v = choose(ids, this.cfg.vision);
      if (v) return v;
      if (ids.length) throw new HttpError(400, `${this.name} has no model that can read images for your key. Connect a free Gemini key to use photo tools.`);
      return this.cfg.fallback;
    }
    return choose(ids, this.cfg.prefer) ?? (ids.includes(this.cfg.fallback) || !ids.length ? this.cfg.fallback : ids[0]);
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
      if (res.status === 402) throw new HttpError(402, `Your ${this.name} account has no free credit left. Connect a free Gemini or Groq key instead.`);
      throw new HttpError(502, `${this.name} returned an error (${res.status}).`);
    }
    return res;
  }

  private messages(system: string, user: unknown) {
    return [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }];
  }

  async text(system: string, prompt: string, maxTokens = 8000): Promise<string> {
    const res = await this.call({ model: await this.model(), max_tokens: Math.min(maxTokens, 8000), messages: this.messages(system, prompt) });
    return (((await res.json()) as ChatReply).choices?.[0]?.message?.content ?? '').trim();
  }

  async *stream(system: string, prompt: string, maxTokens = 8000, files: LlmFile[] = []): AsyncIterable<string> {
    if (files.some((f) => f.mime === 'application/pdf')) throw new HttpError(400, `${this.name} cannot read PDFs. Connect a free Gemini key in Account → AI to chat about PDFs.`);
    const user = files.length ? [{ type: 'text', text: prompt }, ...files.map((f) => ({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${f.data.toString('base64')}` } }))] : prompt;
    const res = await this.call({ model: await this.model(files.length > 0), max_tokens: Math.min(maxTokens, 8000), stream: true, messages: this.messages(system, user) });
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
      model: await this.model(),
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

  async image(data: Buffer, mime: string, ask: string, maxTokens = 2000): Promise<string> {
    if (mime === 'application/pdf') throw new HttpError(400, `${this.name} cannot read PDFs. Connect a free Gemini key in Account → AI to use PDF tools.`);
    const res = await this.call({
      model: await this.model(true),
      max_tokens: Math.min(maxTokens, 8000),
      messages: [{ role: 'user', content: [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url: `data:${mime || 'image/png'};base64,${data.toString('base64')}` } }] }],
    });
    return (((await res.json()) as ChatReply).choices?.[0]?.message?.content ?? '').trim();
  }
}

/** Services a key might belong to, judged from its shape; keys without a known prefix are tried against several. */
export function keyCandidates(key: string): Provider[] {
  if (key.startsWith('gsk_')) return ['groq'];
  if (key.startsWith('sk-or-')) return ['openrouter'];
  if (key.startsWith('sk-ant-')) return ['anthropic'];
  if (key.startsWith('csk-')) return ['cerebras'];
  if (key.startsWith('hf_')) return ['huggingface'];
  if (key.startsWith('ghp_') || key.startsWith('github_pat_')) return ['github'];
  if (key.startsWith('tgp_')) return ['together'];
  if (key.startsWith('AIza') || key.startsWith('AQ.')) return ['gemini'];
  if (key.startsWith('sk-')) return ['openai', 'deepseek'];
  return ['gemini', 'mistral', 'together', 'groq', 'cerebras'];
}

/** Best guess of a key's service without a network call (used for keys saved before providers were stored). */
export function keyProvider(key: string): Provider {
  return keyCandidates(key)[0];
}

/** The model for a personal key. */
export function llmForKey(key: string, source: 'user' | 'server', provider?: string | null): Llm {
  const p = (provider && provider in PROVIDER_NAMES ? provider : keyProvider(key)) as Provider;
  if (p === 'gemini') return new GeminiLlm(key, source);
  if (p === 'anthropic') return new ClaudeLlm(key, source);
  return new CompatLlm(p, key, source);
}

/** Removes what copying often adds: spaces, line breaks, invisible characters, quotes and a "Bearer " prefix. */
export function cleanKey(raw: string): string {
  return raw
    .replace(/[\s​-‍⁠﻿]+/g, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^Bearer/i, '');
}

/** 'yes' / 'no' from the provider; 'unknown' when it could not answer (busy, rate limit, network). */
type Verdict = { ok: 'yes' | 'no' | 'unknown'; reason?: string };

async function probe(url: string, init: RequestInit): Promise<Verdict> {
  // One retry: free endpoints are sometimes slow or briefly unavailable.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return { ok: 'yes' };
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 0) continue;
        return { ok: 'unknown', reason: `busy (${res.status})` };
      }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string; details?: { reason?: string }[] } | string } | null;
      const err = typeof body?.error === 'string' ? { message: body.error } : body?.error;
      return { ok: 'no', reason: err?.details?.find((d) => d.reason)?.reason ?? err?.message ?? `HTTP ${res.status}` };
    } catch {
      if (attempt === 0) continue;
      return { ok: 'unknown', reason: 'no answer' };
    }
  }
  return { ok: 'unknown' };
}

/** Whether a provider accepts the key, with a read-only request that spends no tokens. */
async function accepts(p: Provider, key: string): Promise<Verdict> {
  if (p === 'gemini') {
    const v = await probe(`${GEMINI_BASE}/models?pageSize=1`, { headers: { 'x-goog-api-key': key } });
    if (v.ok !== 'no') return v;
    const alt = await probe(`${GEMINI_BASE}/models?pageSize=1&key=${encodeURIComponent(key)}`, {});
    return alt.ok === 'no' ? v : alt;
  }
  if (p === 'anthropic') return probe('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
  const cfg: CompatConfig = COMPAT[p];
  if (cfg.check === 'chat') {
    return probe(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: cfg.fallback, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    });
  }
  return probe(cfg.check.startsWith('http') ? cfg.check : `${cfg.base}${cfg.check}`, { headers: { authorization: `Bearer ${key}` } });
}

export interface KeyCheck {
  /** The service the key belongs to; null when every candidate refused it. */
  provider: Provider | null;
  /** False when the service could not be reached, so the key was taken on trust. */
  verified: boolean;
  /** The provider's own reason for refusing, when it gave one. */
  reason?: string;
}

/** Finds which service accepts a key. */
export async function inspectKey(key: string): Promise<KeyCheck> {
  const candidates = keyCandidates(key);
  const verdicts = await Promise.all(candidates.map((p) => accepts(p, key)));
  const yes = verdicts.findIndex((v) => v.ok === 'yes');
  if (yes >= 0) return { provider: candidates[yes], verified: true };
  const unknown = verdicts.findIndex((v) => v.ok === 'unknown');
  if (unknown >= 0) return { provider: candidates[unknown], verified: false };
  return { provider: null, verified: true, reason: verdicts[0]?.reason };
}

export async function detectProvider(key: string): Promise<Provider | null> {
  return (await inspectKey(key)).provider;
}

/** Kept for callers that only need a yes or no. */
export async function checkKey(key: string): Promise<boolean> {
  return (await detectProvider(key)) !== null;
}
