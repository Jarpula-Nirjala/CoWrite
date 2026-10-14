import { api, type DocKind, type DocMeta } from '../api.ts';
import { navigate } from '../router.ts';
import { pendingContent, type InitialContent } from './templates.ts';

/** Creates a document, queues its first content and opens it. */
export async function createAndOpen(title: string, kind: DocKind, content: InitialContent, query = '') {
  const { document } = await api<{ document: DocMeta }>('/docs', { method: 'POST', body: { title, kind } });
  pendingContent.set(document.id, content);
  navigate(`/d/${document.id}${query}`);
}
