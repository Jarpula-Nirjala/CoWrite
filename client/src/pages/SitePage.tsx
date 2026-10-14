import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Token } from '../../../shared/crdt.ts';
import { blocksOf } from '../../../shared/rich.ts';
import { api, errorText } from '../api.ts';
import { Spinner } from '../components/ui.tsx';
import { FormDocContext } from '../rich/form.tsx';
import { StaticDoc } from '../rich/StaticDoc.tsx';
import { Link } from '../router.ts';

export const SITE_THEMES: { id: string; name: string; hero: string; heroText: string; band: string; accent: string; font: string }[] = [
  { id: 'clean', name: 'Clean', hero: 'linear-gradient(135deg, #f4f7fb, #ffffff)', heroText: '#111418', band: '#f7f8fa', accent: '#1f3a68', font: "'Times New Roman', serif" },
  { id: 'bold', name: 'Bold', hero: 'linear-gradient(135deg, #111827, #1f3a68)', heroText: '#ffffff', band: '#f3f4f6', accent: '#2563eb', font: "'Segoe UI', Arial, sans-serif" },
  { id: 'sunset', name: 'Sunset', hero: 'linear-gradient(135deg, #ff7e5f, #feb47b)', heroText: '#ffffff', band: '#fff6ef', accent: '#c2410c', font: "'Trebuchet MS', sans-serif" },
  { id: 'forest', name: 'Forest', hero: 'linear-gradient(135deg, #1e4d2b, #3d7a4a)', heroText: '#ffffff', band: '#f3f7f1', accent: '#2f6b3f', font: "Georgia, serif" },
  { id: 'minimal', name: 'Minimal', hero: '#ffffff', heroText: '#111418', band: '#ffffff', accent: '#111418', font: "Georgia, serif" },
  { id: 'night', name: 'Night', hero: 'radial-gradient(circle at 20% 20%, #24324f, #0f1626)', heroText: '#ffffff', band: '#f5f6fa', accent: '#6d5bd0', font: "'Segoe UI', Arial, sans-serif" },
];

interface SiteData {
  title: string;
  tokens: Token[] | null;
  settings: { site?: { theme?: string; accent?: string | null } } | null;
  author: { name: string; username: string };
}

const slug = (s: string) => s.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'section';

/** A published document shown as a one-page website: hero, navigation and sections. */
export function SitePage({ id }: { id: string }) {
  const [data, setData] = useState<SiteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<SiteData>(`/public/${id}`).then(
      (d) => {
        setData(d);
        document.title = d.title;
      },
      (e) => setError(errorText(e)),
    );
  }, [id]);

  const layout = useMemo(() => {
    if (!data?.tokens) return null;
    const tokens = data.tokens;
    const blocks = blocksOf(tokens);
    // Sections start at the top heading level used in the document (after a leading title).
    const heads = blocks.filter((b) => b.type === 'text' && b.kind === 'h');
    const firstIsTitle = blocks[0]?.type === 'text' && blocks[0].kind === 'h';
    const levels = heads.slice(firstIsTitle ? 1 : 0).map((b) => Number(b.attrs.level ?? 1));
    const top = levels.length ? Math.min(...levels) : 1;
    const starts = blocks.filter((b, i) => b.type === 'text' && b.kind === 'h' && Number(b.attrs.level ?? 1) === top && !(i === 0 && firstIsTitle));
    const heroTitle = firstIsTitle && blocks[0].type === 'text' ? blocks[0].text : data.title;
    const introStart = firstIsTitle ? blocks[0].end : 0;
    const introEnd = starts[0]?.start ?? tokens.length;
    const sections = starts.map((b, i) => ({ title: b.type === 'text' ? b.text : '', id: slug(b.type === 'text' ? b.text : `s${i}`), tokens: tokens.slice(b.end, starts[i + 1]?.start ?? tokens.length) }));
    const heroImage = blocks.find((b) => b.type === 'atom' && b.kind === 'image');
    return { heroTitle, intro: tokens.slice(introStart, introEnd).filter((t) => !(t.attrs.atom === 'image' && heroImage?.type === 'atom' && t.id === heroImage.id)), sections, heroImage: heroImage?.type === 'atom' ? String(heroImage.attrs.src ?? '') : null };
  }, [data]);

  if (error)
    return (
      <div className="page center-page">
        <div className="panel narrow-card">
          <h1>Website not available</h1>
          <p className="muted">{error}</p>
          <Link className="btn btn-primary" to="/">
            CoWrite home
          </Link>
        </div>
      </div>
    );
  if (!data || !layout) return <Spinner />;
  const theme = SITE_THEMES.find((t) => t.id === data.settings?.site?.theme) ?? SITE_THEMES[0];
  const accent = data.settings?.site?.accent || theme.accent;

  return (
    <FormDocContext.Provider value={{ docId: id, share: null }}>
      <div className={`site site-${theme.id}`} style={{ '--site-accent': accent, '--site-band': theme.band, fontFamily: theme.font } as CSSProperties}>
        <nav className="site-nav-bar">
          <a href="#top" className="site-brand">
            {data.title}
          </a>
          <span className="site-links">
            {layout.sections.slice(0, 6).map((s) => (
              <a key={s.id} href={`#${s.id}`}>
                {s.title}
              </a>
            ))}
          </span>
        </nav>
        <header id="top" className="site-hero" style={{ background: layout.heroImage ? `linear-gradient(rgb(0 0 0 / 0.45), rgb(0 0 0 / 0.45)), center / cover url("${layout.heroImage}")` : theme.hero, color: layout.heroImage ? '#fff' : theme.heroText }}>
          <div className="site-wrap">
            <h1>{layout.heroTitle}</h1>
            {layout.intro.some((t) => t.ch.trim()) && (
              <div className="site-intro">
                <StaticDoc tokens={layout.intro} />
              </div>
            )}
            {layout.sections[0] && (
              <a className="site-cta" href={`#${layout.sections[0].id}`}>
                Explore ↓
              </a>
            )}
          </div>
        </header>
        {layout.sections.map((s, i) => (
          <section key={s.id + i} id={s.id} className={`site-section ${i % 2 ? 'band' : ''}`}>
            <div className="site-wrap">
              <h2>{s.title}</h2>
              <StaticDoc tokens={s.tokens} />
            </div>
          </section>
        ))}
        <footer className="site-footer">
          <div className="site-wrap">
            <span>
              © {new Date().getFullYear()} {data.author.name}
            </span>
            <span>
              Made with <Link to="/">CoWrite</Link>
            </span>
          </div>
        </footer>
      </div>
    </FormDocContext.Provider>
  );
}
