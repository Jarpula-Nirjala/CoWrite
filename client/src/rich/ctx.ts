import type { Person } from '../api.ts';

/** What block objects (images, tables, signatures…) need from the page. */
export interface EditorCtx {
  docId: string;
  share: string | null;
  readOnly: boolean;
  me: { id: string | null; name: string };
  people: Person[];
  aiEnabled: boolean;
  /** Upload a file (encrypted first in end-to-end encrypted documents). */
  upload(file: Blob, name: string): Promise<{ src: string; name: string; size: number; mime: string }>;
  /** A displayable URL for a stored file (decrypts encrypted files). */
  resolve(src: string): Promise<string>;
  unfurl(url: string): Promise<{ url: string; title: string; description: string; image: string | null; site: string }>;
  ai(action: 'describe-image' | 'summarize', input: Record<string, unknown>): Promise<string>;
  openImageSearch(): void;
  /** Headings of the current document, for the live table of contents. */
  headings(): { level: number; text: string; pos: number }[];
  jumpTo(pos: number): void;
  /** Subscribe to document changes (live blocks such as the table of contents). */
  onChange(cb: () => void): () => void;
}

export type LinkMeta = Awaited<ReturnType<EditorCtx['unfurl']>>;

/** Recognises links that should become embedded players or maps. */
export function embedFor(raw: string): { kind: string; src: string; ratio: number } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtube.com' || host === 'youtu.be') {
    const id = host === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v') ?? u.pathname.split('/').filter(Boolean).at(-1);
    if (id && /^[\w-]{6,}$/.test(id)) return { kind: 'YouTube', src: `https://www.youtube-nocookie.com/embed/${id}`, ratio: 56.25 };
  }
  if (host === 'vimeo.com' && /^\/\d+/.test(u.pathname)) return { kind: 'Vimeo', src: `https://player.vimeo.com/video${u.pathname}`, ratio: 56.25 };
  if (host === 'loom.com' && u.pathname.startsWith('/share/')) return { kind: 'Loom', src: `https://www.loom.com/embed/${u.pathname.split('/')[2]}`, ratio: 56.25 };
  if (host === 'open.spotify.com') return { kind: 'Spotify', src: `https://open.spotify.com/embed${u.pathname}`, ratio: 30 };
  if (host === 'figma.com') return { kind: 'Figma', src: `https://www.figma.com/embed?embed_host=cowrite&url=${encodeURIComponent(raw)}`, ratio: 60 };
  if (host === 'codepen.io' && u.pathname.includes('/pen/')) return { kind: 'CodePen', src: raw.replace('/pen/', '/embed/'), ratio: 60 };
  if ((host === 'twitter.com' || host === 'x.com') && /\/status\/(\d+)/.test(u.pathname)) {
    return { kind: 'Post on X', src: `https://platform.twitter.com/embed/Tweet.html?id=${/\/status\/(\d+)/.exec(u.pathname)![1]}`, ratio: 90 };
  }
  if (host === 'google.com' && u.pathname.startsWith('/maps')) {
    const q = u.searchParams.get('q') ?? decodeURIComponent(u.pathname.split('/place/')[1]?.split('/')[0] ?? '');
    if (q) return { kind: 'Google Maps', src: `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`, ratio: 56.25 };
  }
  if (host === 'gist.github.com' && /^\/[\w-]+\/[0-9a-f]+/.test(u.pathname)) return { kind: 'GitHub Gist', src: `${u.origin}${u.pathname}.pibb`, ratio: 50 };
  return null;
}

/** "maps:Eiffel Tower" style shortcut for map embeds. */
export function mapEmbed(place: string) {
  return { kind: 'Google Maps', src: `https://www.google.com/maps?q=${encodeURIComponent(place)}&output=embed`, ratio: 56.25 };
}
