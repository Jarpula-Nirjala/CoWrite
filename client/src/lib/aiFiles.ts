import { api, ApiError } from '../api.ts';

/** Sends a PDF or image to an AI file tool and returns its Markdown answer. */
export async function aiFile(file: Blob, task: string, params: Record<string, string> = {}): Promise<string> {
  if (file.size > 10_000_000) throw new ApiError(400, 'Files must be under 10 MB.');
  const q = new URLSearchParams({ task, ...params });
  const res = await fetch(`/api/ai/file?${q}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' }, credentials: 'same-origin' });
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status}).`);
  return body.text ?? '';
}

/** Plain text of an uploaded document: .txt/.md/.html directly, .docx locally, PDFs and images through the AI. */
export async function fileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }
  if (file.type === 'application/pdf' || name.endsWith('.pdf') || file.type.startsWith('image/')) return aiFile(file, 'extract');
  if (name.endsWith('.html') || name.endsWith('.htm')) {
    const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
    return doc.body.innerText || doc.body.textContent || '';
  }
  return file.text();
}

/** Calls a text tool (spell check, refine, translate…). */
export function aiText<T = { text: string }>(task: string, text: string, extra: { lang?: string; instruction?: string } = {}) {
  return api<T>('/ai/text', { method: 'POST', body: { task, text, ...extra } });
}
