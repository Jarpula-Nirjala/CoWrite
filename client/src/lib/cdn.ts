/**
 * Large libraries used only by particular features (PDF, Word and PowerPoint export, the PDF tools, code
 * highlighting, MP3 narration) load from a CDN the first time the feature is used, instead of being bundled.
 * Bundling them made the production build need more memory than Render's free plan gives a build.
 * Versions are pinned to the ones the app is built and type-checked against (see package.json).
 */
const CDN = 'https://cdn.jsdelivr.net/npm';
const VERSIONS = {
  'pdf-lib': '1.17.1',
  mammoth: '1.13.0',
  jspdf: '4.2.1',
  pptxgenjs: '4.0.1',
  lowlight: '3.3.0',
  docx: '9.10.0',
  '@breezystack/lamejs': '1.2.7',
} as const;

const loaded = new Map<string, Promise<unknown>>();

/** The library's module, as `import('<lib>')` would give it. Usage: `await fromCdn<typeof import('jspdf')>('jspdf')`. */
export function fromCdn<T>(lib: keyof typeof VERSIONS): Promise<T> {
  let p = loaded.get(lib);
  if (!p) {
    p = import(/* @vite-ignore */ `${CDN}/${lib}@${VERSIONS[lib]}/+esm`);
    // A failed load (offline) is tried again next time.
    p.catch(() => loaded.delete(lib));
    loaded.set(lib, p);
  }
  return p as Promise<T>;
}
