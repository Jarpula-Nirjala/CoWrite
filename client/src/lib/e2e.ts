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

  // Characters, their attributes and object fields are all encrypted; the
  // server sees only ids, attribute names and ciphertext.
  const encryptOp = async (op: Op): Promise<Op> => {
    switch (op.k) {
      case 'i': {
        const { a, ...rest } = op;
        return { ...rest, ch: await seal(a ? JSON.stringify({ c: op.ch, a }) : op.ch) };
      }
      case 'f':
      case 'm':
        return { ...op, v: await seal(JSON.stringify(op.v)) };
      default:
        return op;
    }
  };
  const decryptOp = async (op: Op): Promise<Op> => {
    switch (op.k) {
      case 'i': {
        const plain = await open(op.ch);
        if (plain.length > 1 && plain.startsWith('{"c":')) {
          const { c, a } = JSON.parse(plain) as { c: string; a: Record<string, unknown> };
          return { ...op, ch: c, a };
        }
        return { ...op, ch: plain };
      }
      case 'f':
      case 'm':
        return { ...op, v: typeof op.v === 'string' ? JSON.parse(await open(op.v)) : op.v };
      default:
        return op;
    }
  };

  return {
    encryptOps: (ops: Op[]) => Promise.all(ops.map(encryptOp)),
    async decryptOps(ops: Op[]) {
      try {
        return await Promise.all(ops.map(decryptOp));
      } catch {
        throw new Error('This link has the wrong encryption key, so the document cannot be decrypted.');
      }
    },
    encryptText: async (text: string) => `enc:${await seal(text)}`,
    decryptText: async (text: string) => (text.startsWith('enc:') ? open(text.slice(4)) : text),
  };
}

/** Encrypts and decrypts uploaded files with the document's key. */
export async function createFileCipher(keyText: string) {
  const key = await crypto.subtle.importKey('raw', fromB64url(keyText), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return {
    async encrypt(data: ArrayBuffer): Promise<Blob> {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
      return new Blob([iv, new Uint8Array(ct)]);
    },
    async decrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
      const bytes = new Uint8Array(data);
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    },
  };
}
export type FileCipher = Awaited<ReturnType<typeof createFileCipher>>;
