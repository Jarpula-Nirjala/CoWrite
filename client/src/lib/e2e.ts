import type { Op } from '../../../shared/crdt.ts';
import type { OpCipher } from '../../../shared/sync-client.ts';

/**
 * End-to-end encryption for documents. The AES-256-GCM key lives only in the
 * link's #fragment, which browsers never send to the server. Each character
 * is encrypted separately so the server can still merge edits by id while
 * seeing nothing but ciphertext.
 */

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function generateKey(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  return b64url(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

export function keyFromHash(hash: string): string | null {
  const m = /(?:^#|&)key=([A-Za-z0-9_-]{43})/.exec(hash);
  return m ? m[1] : null;
}

export async function createCipher(keyText: string): Promise<OpCipher> {
  const key = await crypto.subtle.importKey('raw', fromB64url(keyText), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const seal = async (plain: string) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv);
    out.set(ct, iv.length);
    return b64(out);
  };
  const open = async (sealed: string) => {
    const bytes = fromB64(sealed);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    return dec.decode(plain);
  };

  return {
    encryptOps: (ops: Op[]) => Promise.all(ops.map(async (op) => (op.k === 'i' ? { ...op, ch: await seal(op.ch) } : op))),
    async decryptOps(ops: Op[]) {
      try {
        return await Promise.all(ops.map(async (op) => (op.k === 'i' ? { ...op, ch: await open(op.ch) } : op)));
      } catch {
        throw new Error('This link has the wrong encryption key, so the document cannot be decrypted.');
      }
    },
    encryptText: async (text: string) => `enc:${await seal(text)}`,
    decryptText: async (text: string) => (text.startsWith('enc:') ? open(text.slice(4)) : text),
  };
}
