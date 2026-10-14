import katex from 'katex';
import 'katex/dist/katex.min.css';

/** Loaded on demand so the maths renderer is only downloaded when needed. */
export function renderTex(tex: string, display: boolean): { html: string; error: string | null } {
  try {
    return { html: katex.renderToString(tex || '\\;', { displayMode: display, throwOnError: true, output: 'html' }), error: null };
  } catch (e) {
    return { html: katex.renderToString(tex || '\\;', { displayMode: display, throwOnError: false }), error: (e as Error).message };
  }
}
