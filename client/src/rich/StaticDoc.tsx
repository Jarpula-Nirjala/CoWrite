import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { BLOCK, EMBED, type Attrs, type Token } from '../../../shared/crdt.ts';
import { strokePath } from './atoms.tsx';
import { StaticForm } from './form.tsx';
import { fontStack, listLabel } from './schema.ts';

/** Renders a token list read-only (versions, replay, published pages). */
export function StaticDoc({
  tokens,
  resolve,
  siteColors,
  className,
}: {
  tokens: Token[];
  resolve?: (src: string) => Promise<string>;
  /** Colour text by the site that typed it (replay, authorship). */
  siteColors?: Map<string, string>;
  className?: string;
}) {
  const blocks: ReactNode[] = [];
  let inline: ReactNode[] = [];
  let key = 0;
  let olCounters: number[] = [];
  const headings: { level: number; text: string }[] = [];
  let curText = '';

  const pushPara = (a: Attrs) => {
    const kind = (a.block as string) ?? 'p';
    const level = Number(a.level ?? 0);
    const style: CSSProperties = a.align ? { textAlign: a.align as CSSProperties['textAlign'] } : {};
    const children = inline.length ? inline : [<br key="br" />];
    if (kind !== 'oli') olCounters = [];
    switch (kind) {
      case 'h': {
        const L = Math.min(3, Math.max(1, level || 1));
        headings.push({ level: L, text: curText });
        const Tag = `h${L}` as 'h1';
        blocks.push(
          <Tag key={key++} className="blk blk-h" style={style}>
            {children}
          </Tag>,
        );
        break;
      }
      case 'quote':
        blocks.push(
          <blockquote key={key++} className="blk blk-quote" style={style}>
            {children}
          </blockquote>,
        );
        break;
      case 'code':
        blocks.push(
          <pre key={key++} className="blk blk-code">
            <code>{children}</code>
          </pre>,
        );
        break;
      case 'oli': {
        olCounters[level] = (olCounters[level] ?? 0) + 1;
        olCounters.length = level + 1;
        blocks.push(
          <div key={key++} className={`blk blk-oli lvl-${level} static-oli`} style={style} data-num={listLabel(level, olCounters[level])}>
            {children}
          </div>,
        );
        break;
      }
      case 'li':
        blocks.push(
          <div key={key++} className={`blk blk-li lvl-${level}`} style={style}>
            {children}
          </div>,
        );
        break;
      case 'task':
        blocks.push(
          <div key={key++} className={`blk blk-task lvl-${level}`} data-checked={a.checked ? 'true' : 'false'} style={style}>
            <span className="task-text">{children}</span>
            {Boolean(a.assignee || a.due) && (
              <span className="task-meta">
                {a.assignee ? `@${(a.assignee as { name: string }).name}` : ''} {a.due ? `· due ${String(a.due)}` : ''}
              </span>
            )}
          </div>,
        );
        break;
      case 'callout':
        blocks.push(
          <div key={key++} className="blk blk-callout" data-tone={String(a.tone ?? 'info')} data-emoji={String(a.emoji ?? '💡')} style={style}>
            {children}
          </div>,
        );
        break;
      default:
        blocks.push(
          <p key={key++} className="blk blk-p" style={style}>
            {children}
          </p>,
        );
    }
    inline = [];
    curText = '';
  };

  let run = '';
  let runAttrs: Attrs = {};
  let runSite = '';
  const flushRun = () => {
    if (!run) return;
    inline.push(
      <Styled key={key++} a={runAttrs} bg={siteColors ? `${siteColors.get(runSite) ?? '#9aa0a6'}26` : undefined}>
        {run}
      </Styled>,
    );
    run = '';
  };

  for (const t of tokens) {
    if (t.ch === BLOCK) {
      flushRun();
      pushPara(t.attrs);
    } else if (t.ch === EMBED && t.attrs.atom) {
      flushRun();
      if (inline.length) pushPara({});
      olCounters = [];
      blocks.push(<StaticAtom key={key++} a={t.attrs} resolve={resolve} headings={headings} />);
    } else if (t.ch === EMBED) {
      flushRun();
      const k = t.attrs.inline;
      inline.push(
        <span key={key++} className={`chip chip-${String(k)}`}>
          {k === 'mention' ? `@${String(t.attrs.name ?? '')}` : k === 'date' ? `📅 ${String(t.attrs.date ?? '')}` : k === 'math' ? String(t.attrs.tex ?? '') : ''}
        </span>,
      );
    } else {
      const same = JSON.stringify(runAttrs) === JSON.stringify(t.attrs) && (!siteColors || runSite === t.id[0]);
      if (!same) {
        flushRun();
        runAttrs = t.attrs;
        runSite = t.id[0];
      }
      run += t.ch;
      curText += t.ch;
    }
  }
  flushRun();
  if (inline.length) pushPara({});
  return <div className={`rich-doc static ${className ?? ''}`}>{blocks.length ? blocks : <p className="muted">(empty)</p>}</div>;
}

function Styled({ a, bg, children }: { a: Attrs; bg?: string; children: ReactNode }) {
  const style: CSSProperties = {};
  if (a.color) style.color = String(a.color);
  if (a.bg) style.background = String(a.bg);
  else if (bg) style.background = bg;
  if (a.font) style.fontFamily = fontStack(String(a.font));
  if (a.size) style.fontSize = `${String(a.size)}px`;
  let el: ReactNode = <span style={style}>{children}</span>;
  if (a.code) el = <code>{el}</code>;
  if (a.b) el = <strong>{el}</strong>;
  if (a.i) el = <em>{el}</em>;
  if (a.u) el = <u>{el}</u>;
  if (a.s) el = <s>{el}</s>;
  if (a.sup) el = <sup>{el}</sup>;
  if (a.sub) el = <sub>{el}</sub>;
  if (a.link) {
    el = (
      <a href={String(a.link)} target="_blank" rel="noopener noreferrer nofollow">
        {el}
      </a>
    );
  }
  return <>{el}</>;
}

function useUrl(src: unknown, resolve?: (s: string) => Promise<string>) {
  const [url, setUrl] = useState<string | null>(typeof src === 'string' && !src.startsWith('/api/files/') ? src : null);
  useEffect(() => {
    if (typeof src !== 'string' || !src) return;
    if (!resolve) {
      setUrl(src);
      return;
    }
    let alive = true;
    resolve(src).then((u) => alive && setUrl(u), () => {});
    return () => {
      alive = false;
    };
  }, [src, resolve]);
  return url;
}

function StaticAtom({ a, resolve, headings }: { a: Attrs; resolve?: (s: string) => Promise<string>; headings: { level: number; text: string }[] }) {
  const url = useUrl(a.src ?? a.img, resolve);
  const [tex, setTex] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (a.atom === 'math') void import('./katex.ts').then((k) => setTex(k.renderTex(String(a.tex ?? ''), true).html));
    if (a.atom === 'mermaid') {
      void import('mermaid').then(async ({ default: m }) => {
        m.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
        try {
          setSvg((await m.render(`smmd-${Math.random().toString(36).slice(2)}`, String(a.code ?? ''))).svg);
        } catch {
          setSvg(null);
        }
      });
    }
  }, [a.atom, a.tex, a.code]);
  switch (a.atom) {
    case 'image':
      return (
        <figure className={`static-figure align-${String(a.align ?? 'center')}`}>
          {url && <img src={url} alt={String(a.alt ?? a.caption ?? '')} style={{ width: `${Number(a.w ?? 100)}%` }} />}
          {a.caption ? <figcaption>{String(a.caption)}</figcaption> : null}
        </figure>
      );
    case 'embed':
      return (
        <figure className="static-figure">
          <div className="embed-box" style={{ paddingBottom: `${Number(a.ratio ?? 56.25)}%` }}>
            <iframe src={String(a.src)} title={String(a.kind ?? 'Embed')} loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" />
          </div>
          {a.caption ? <figcaption>{String(a.caption)}</figcaption> : null}
        </figure>
      );
    case 'link':
      return (
        <a className="link-card static" href={String(a.url)} target="_blank" rel="noopener noreferrer nofollow">
          <span className="link-text">
            <strong>{String(a.title ?? a.url)}</strong>
            {a.description ? <span className="link-desc">{String(a.description)}</span> : null}
            <span className="link-site">{String(a.site ?? '')}</span>
          </span>
          {typeof a.image === 'string' && a.image && <img src={a.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        </a>
      );
    case 'audio':
      return <figure className="static-figure">{url && <audio controls src={url} />}</figure>;
    case 'file':
      return (
        <a className="file-card" href={url ?? '#'} download={String(a.name ?? 'file')}>
          <span className="file-icon">FILE</span>
          <strong>{String(a.name ?? 'Attachment')}</strong>
        </a>
      );
    case 'drawing': {
      const h = Number(a.h ?? 320);
      const strokes = (Array.isArray(a.strokes) ? a.strokes : []) as { c: string; w: number; p: number[] }[];
      return (
        <svg className="draw-surface static" viewBox={`0 0 800 ${h}`} style={{ aspectRatio: `800 / ${h}` }}>
          {strokes.map((s, i) => (
            <path key={i} d={strokePath(s.p)} stroke={s.c} strokeWidth={s.w} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>
      );
    }
    case 'math':
      return <div className="math-render" dangerouslySetInnerHTML={{ __html: tex ?? '' }} />;
    case 'mermaid':
      return <div className="mermaid-render" dangerouslySetInnerHTML={{ __html: svg ?? '' }} />;
    case 'hr':
      return <hr className="rule" />;
    case 'pagebreak':
      return <div className="page-break print-break" />;
    case 'toc':
      return (
        <nav className="toc-block">
          <strong>Contents</strong>
          <ol>
            {headings.map((h, i) => (
              <li key={i} className={`toc-l${h.level}`}>
                {h.text}
              </li>
            ))}
          </ol>
        </nav>
      );
    case 'summary':
      return (
        <aside className="summary-card">
          <header>
            <strong>Summary</strong>
          </header>
          <p>{String(a.text ?? '')}</p>
        </aside>
      );
    case 'form':
      return <StaticForm data={a} />;
    case 'signature':
      return (
        <div className="signature signed">
          {url && a.at ? <img src={url} alt={`Signature of ${String(a.name)}`} /> : null}
          <div className="sig-line" />
          <strong>{String(a.name ?? 'Awaiting signature')}</strong>
          {a.at ? <span className="muted small">Signed {new Date(Number(a.at)).toLocaleString()}</span> : null}
        </div>
      );
    case 'table': {
      const rows = (Array.isArray(a.rows) ? a.rows : []) as string[][];
      return (
        <div className="table-scroll-x">
          <table className="table-grid static">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={i === 0 && a.header !== false ? 'thead' : ''}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    default:
      return null;
  }
}
