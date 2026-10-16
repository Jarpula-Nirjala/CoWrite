/**
 * Mermaid (diagram blocks) is loaded from a CDN only when a document contains a diagram. Bundling it
 * (with its layout engines) multiplied the size of the production build, and the build then needed more
 * memory than Render's free plan gives one. Version pinned to the one the app was built against.
 */
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.esm.min.mjs';

export interface Mermaid {
  initialize(config: Record<string, unknown>): void;
  render(id: string, code: string): Promise<{ svg: string }>;
}

let loading: Promise<Mermaid> | null = null;
export function loadMermaid(): Promise<Mermaid> {
  loading ??= import(/* @vite-ignore */ MERMAID_URL).then((m: { default: Mermaid }) => m.default);
  // A failed load (offline) is tried again next time.
  loading.catch(() => (loading = null));
  return loading;
}
