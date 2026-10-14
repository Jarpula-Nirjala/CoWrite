import { useCallback, useMemo, useRef } from 'react';
import { createFileCipher } from '../lib/e2e.ts';

/** Upload and display stored files (encrypted first in end-to-end encrypted documents). */
export function useFiles(roomId: string, keyText: string | null) {
  const fileCipher = useMemo(() => (keyText ? createFileCipher(keyText) : null), [keyText]);
  const resolved = useRef(new Map<string, Promise<string>>());
  const resolve = useCallback(
    (src: string): Promise<string> => {
      if (!src.includes('enc=1')) return Promise.resolve(src);
      const hit = resolved.current.get(src);
      if (hit) return hit;
      const p = (async () => {
        const fc = await fileCipher;
        if (!fc) throw new Error('Missing key');
        const buf = await (await fetch(src)).arrayBuffer();
        const mime = new URL(src, location.href).searchParams.get('m') ?? 'application/octet-stream';
        return URL.createObjectURL(new Blob([await fc.decrypt(buf)], { type: mime }));
      })();
      resolved.current.set(src, p);
      return p;
    },
    [fileCipher],
  );
  const upload = useCallback(
    async (blob: Blob, name: string) => {
      const mime = blob.type || 'application/octet-stream';
      const fc = fileCipher ? await fileCipher : null;
      const body = fc ? await fc.encrypt(await blob.arrayBuffer()) : blob;
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'content-type': fc ? 'application/octet-stream' : mime, 'x-file-name': encodeURIComponent(name), 'x-doc-id': roomId },
        body,
      });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !j.url) throw new Error(j.error ?? 'Upload failed.');
      return { src: fc ? `${j.url}?enc=1&m=${encodeURIComponent(mime)}` : j.url, name, size: blob.size, mime };
    },
    [fileCipher, roomId],
  );
  return { resolve, upload };
}

/** Shrinks large photos before upload. */
export async function downscale(file: File, max = 1920): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp || (bmp.width <= max && bmp.height <= max && file.size < 1.5e6)) return file;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob((b) => r(b ?? file), file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86));
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => done(input.files?.[0] ?? null);
    input.click();
  });
}
