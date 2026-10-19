import { shareTokens } from '../api.ts';
import { fromCdn } from '../lib/cdn.ts';

/** Turns raw 16-bit mono PCM into an MP3 file (in chunks, so long audio stays responsive). */
export async function pcmToMp3(pcm: ArrayBuffer, sampleRate: number): Promise<Blob> {
  const { Mp3Encoder } = await fromCdn<typeof import('@breezystack/lamejs')>('@breezystack/lamejs');
  const samples = new Int16Array(pcm.byteLength % 2 ? pcm.slice(0, pcm.byteLength - 1) : pcm);
  const enc = new Mp3Encoder(1, sampleRate, 64);
  const parts: Uint8Array[] = [];
  const BLOCK = 1152 * 20;
  for (let i = 0; i < samples.length; i += BLOCK) {
    const out = enc.encodeBuffer(samples.subarray(i, i + BLOCK));
    if (out.length) parts.push(out.slice());
    if (i % (BLOCK * 20) === 0) await new Promise((r) => setTimeout(r, 0));
  }
  const end = enc.flush();
  if (end.length) parts.push(end.slice());
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}

/** Asks the server's voice model to read the document, then saves it as an MP3. */
export async function exportNarration(docId: string, title: string, voice: string): Promise<{ truncated: boolean }> {
  const share = shareTokens.get(docId);
  const res = await fetch(`/api/docs/${docId}/ai/narrate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(share ? { 'x-share-token': share } : {}) },
    body: JSON.stringify({ voice }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? 'Narration failed.');
  }
  const rate = Number(res.headers.get('x-sample-rate')) || 24000;
  const mp3 = await pcmToMp3(await res.arrayBuffer(), rate);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(mp3);
  a.download = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'document'} - narration.mp3`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return { truncated: res.headers.get('x-truncated') === '1' };
}
