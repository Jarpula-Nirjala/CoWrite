import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import express from 'express';
import type { AppCtx } from './context.ts';
import { HttpError, currentUser, rateLimit, str } from './http.ts';

const MAX_FILE = 6 * 1024 * 1024;
const USER_QUOTA = 60 * 1024 * 1024;
const SAFE_INLINE = /^(image\/(png|jpeg|gif|webp)|audio\/(webm|ogg|mpeg|mp4|wav)|video\/(webm|mp4)|application\/pdf)$/;

// ------------------------------------------------------------- SSRF guard

function privateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

/** Fetches a public URL, refusing private networks, redirects to them, and large bodies. */
async function safeFetch(raw: string, maxBytes = 600_000): Promise<{ url: string; type: string; body: string }> {
  let url = new URL(raw);
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http and https links are supported.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
    if (!addrs.length || addrs.some(privateAddress)) throw new HttpError(400, 'That address is not reachable from here.');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'CoWriteBot/1.0 (+link preview)', accept: 'text/html,application/xhtml+xml' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url);
        continue;
      }
      const type = res.headers.get('content-type') ?? '';
      const reader = res.body?.getReader();
      let body = '';
      if (reader) {
        const dec = new TextDecoder();
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          body += dec.decode(value, { stream: true });
          if (total > maxBytes) {
            await reader.cancel();
            break;
          }
        }
      }
      return { url: url.toString(), type, body };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new HttpError(400, 'Too many redirects.');
}

/** Fetches public binary content (images for AI descriptions) with the same SSRF guard. */
export async function safeFetchBinary(raw: string, maxBytes: number): Promise<{ data: Buffer; type: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'Invalid image address.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpError(400, 'Only http and https links are supported.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(privateAddress)) throw new HttpError(400, 'That address is not reachable from here.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { redirect: 'error', signal: ctrl.signal, headers: { 'user-agent': 'CoWriteBot/1.0' } });
    if (!res.ok) throw new HttpError(400, 'Could not download the image.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new HttpError(400, 'The image is too large.');
    return { data: buf, type: (res.headers.get('content-type') ?? 'image/png').split(';')[0] };
  } finally {
    clearTimeout(timer);
  }
}

function meta(html: string, names: string[]): string | null {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, 'i');
    const tag = re.exec(html)?.[0];
    const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return decode(content);
  }
  return null;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();

export function mediaRoutes(ctx: AppCtx) {
  const r = express.Router();
  const { db } = ctx;

  // ---------------------------------------------------------------- files

  r.post('/files', rateLimit(120, 10 * 60_000), express.raw({ type: () => true, limit: MAX_FILE }), async (req, res) => {
    const user = currentUser(res);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Empty upload.');
    const name = decodeURIComponent(str(req.get('x-file-name'), 200)) || 'file';
    const mime = str(req.get('content-type'), 100) || 'application/octet-stream';
    const docId = str(req.get('x-doc-id'), 64) || null;
    if (user) {
      const [{ used }] = await db.query<{ used: number }>('select coalesce(sum(size), 0)::int as used from files where owner_id = $1', [user.id]);
      if (used + body.length > USER_QUOTA) throw new HttpError(400, 'Your upload storage is full (60 MB). Delete some documents to free space.');
    }
    const id = crypto.randomBytes(16).toString('base64url');
    await db.query('insert into files (id, owner_id, doc_id, name, mime, size, data, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)', [
      id,
      user?.id ?? null,
      docId,
      name,
      mime,
      body.length,
      body,
      Date.now(),
    ]);
    res.status(201).json({ id, url: `/api/files/${id}`, name, mime, size: body.length });
  });

  // File ids are 128-bit random capabilities: whoever has the document can see its files.
  r.get('/files/:id', async (req, res) => {
    const [f] = await db.query<{ name: string; mime: string; data: Buffer | Uint8Array }>('select name, mime, data from files where id = $1', [String(req.params.id)]);
    if (!f) throw new HttpError(404, 'File not found.');
    const inline = SAFE_INLINE.test(f.mime);
    res.setHeader('Content-Type', inline ? f.mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.send(Buffer.from(f.data));
  });

  // -------------------------------------------------------- link previews

  const unfurlCache = new Map<string, { at: number; data: unknown }>();
  r.get('/unfurl', rateLimit(60, 60_000), async (req, res) => {
    const target = str(req.query.url, 2000);
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      throw new HttpError(400, 'Enter a full link starting with https://');
    }
    const hit = unfurlCache.get(parsed.toString());
    if (hit && Date.now() - hit.at < 3600_000) {
      res.json(hit.data);
      return;
    }
    let data: { url: string; title: string; description: string; image: string | null; site: string };
    try {
      const page = await safeFetch(parsed.toString());
      const html = page.type.includes('html') ? page.body : '';
      const title = meta(html, ['og:title', 'twitter:title']) ?? decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '') ?? parsed.hostname;
      let image = meta(html, ['og:image', 'og:image:url', 'twitter:image']);
      if (image) image = new URL(image, page.url).toString();
      data = {
        url: page.url,
        title: (title || parsed.hostname).slice(0, 200),
        description: (meta(html, ['og:description', 'description', 'twitter:description']) ?? '').slice(0, 300),
        image: image && /^https?:/.test(image) ? image : null,
        site: (meta(html, ['og:site_name']) ?? parsed.hostname.replace(/^www\./, '')).slice(0, 80),
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      data = { url: parsed.toString(), title: parsed.hostname, description: '', image: null, site: parsed.hostname.replace(/^www\./, '') };
    }
    if (unfurlCache.size > 500) unfurlCache.clear();
    unfurlCache.set(parsed.toString(), { at: Date.now(), data });
    res.json(data);
  });

  // Same-origin copy of a public image, so exports can draw it onto a canvas.
  r.get('/media/proxy', rateLimit(120, 60_000), async (req, res) => {
    const got = await safeFetchBinary(str(req.query.url, 2000), 8_000_000);
    if (!/^image\/(png|jpeg|gif|webp)$/.test(got.type)) throw new HttpError(400, 'That link is not an image.');
    res.setHeader('Content-Type', got.type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(got.data);
  });

  // ------------------------------------------------------ free image search

  r.get('/media/search', rateLimit(40, 60_000), async (req, res) => {
    const q = str(req.query.q, 100).trim();
    if (!q) throw new HttpError(400, 'Type something to search for.');
    const page = Math.max(1, Math.min(20, Number(req.query.page) || 1));
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=24&page=${page}&mature=false`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r2 = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'CoWrite/1.0' } });
      if (!r2.ok) throw new Error(String(r2.status));
      const j = (await r2.json()) as { results: { id: string; title: string; url: string; thumbnail: string; creator: string | null; license: string; license_version: string; foreign_landing_url: string; width: number; height: number }[] };
      res.json({
        results: j.results.map((x) => ({
          id: x.id,
          title: x.title,
          url: x.url,
          thumb: x.thumbnail,
          credit: `${x.creator ? `${x.creator}, ` : ''}CC ${x.license.toUpperCase()} ${x.license_version ?? ''}`.trim(),
          source: x.foreign_landing_url,
        })),
      });
    } catch {
      throw new HttpError(502, 'The free image library is not reachable right now. Please try again.');
    } finally {
      clearTimeout(timer);
    }
  });

  return r;
}
