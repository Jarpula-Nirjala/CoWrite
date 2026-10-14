import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { Icon } from '../components/ui.tsx';
import type { EditorCtx } from './ctx.ts';

type Data = Record<string, unknown>;

interface AtomProps {
  kind: string;
  data: Data;
  selected: boolean;
  readOnly: boolean;
  ctx: EditorCtx;
  update(data: Data): void;
  remove(): void;
}

// ------------------------------------------------------------- node view

/** Hosts a React component for an atom node inside the editor. */
export class AtomView implements NodeView {
  dom: HTMLElement;
  private root: Root;
  private node: PMNode;
  private selected = false;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly ctx: () => EditorCtx;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined, ctx: () => EditorCtx) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.ctx = ctx;
    this.dom = document.createElement('div');
    this.dom.className = `atom-view atom-${node.attrs.kind}`;
    this.dom.contentEditable = 'false';
    this.root = createRoot(this.dom);
    this.render();
  }

  private render() {
    const kind = this.node.attrs.kind as string;
    const ctx = this.ctx();
    this.root.render(
      <AtomBlock
        kind={kind}
        data={this.node.attrs.data as Data}
        selected={this.selected}
        readOnly={ctx.readOnly || !this.view.editable}
        ctx={ctx}
        update={(data) => {
          const pos = this.getPos();
          if (pos === undefined) return;
          const cur = this.view.state.doc.nodeAt(pos);
          if (!cur) return;
          this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { kind, data: { ...(cur.attrs.data as Data), ...data } }));
        }}
        remove={() => {
          const pos = this.getPos();
          if (pos === undefined) return;
          this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
          this.view.focus();
        }}
      />,
    );
  }

  update(node: PMNode) {
    if (node.type !== this.node.type || node.attrs.kind !== this.node.attrs.kind) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.selected = true;
    this.dom.classList.add('selected');
    this.render();
  }

  deselectNode() {
    this.selected = false;
    this.dom.classList.remove('selected');
    this.render();
  }

  stopEvent(e: Event) {
    const t = e.target as HTMLElement | null;
    if (e.type === 'dragstart' && t?.closest('[data-drag-handle]')) return false;
    return !!t?.closest('input, textarea, select, button, a, iframe, audio, video, [data-stop], .draw-surface, .table-grid');
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    const root = this.root;
    setTimeout(() => root.unmount(), 0);
  }
}

// ------------------------------------------------------------- dispatcher

function AtomBlock(p: AtomProps) {
  switch (p.kind) {
    case 'image':
      return <ImageBlock {...p} />;
    case 'embed':
      return <EmbedBlock {...p} />;
    case 'link':
      return <LinkCard {...p} />;
    case 'audio':
      return <AudioBlock {...p} />;
    case 'file':
      return <FileBlock {...p} />;
    case 'drawing':
      return <DrawingBlock {...p} />;
    case 'math':
      return <MathBlock {...p} />;
    case 'mermaid':
      return <MermaidBlock {...p} />;
    case 'toc':
      return <TocBlock {...p} />;
    case 'summary':
      return <SummaryBlock {...p} />;
    case 'signature':
      return <SignatureBlock {...p} />;
    case 'table':
      return <TableBlock {...p} />;
    case 'pagebreak':
      return (
        <div className="page-break" data-drag-handle>
          <span>Page break</span>
        </div>
      );
    case 'hr':
      return <hr className="rule" />;
    default:
      return <div className="atom-unknown">Unsupported block: {p.kind}</div>;
  }
}

function Frame({ p, children, tools, label }: { p: AtomProps; children: ReactNode; tools?: ReactNode; label: string }) {
  return (
    <figure className={`atom-frame ${p.selected ? 'is-selected' : ''}`} aria-label={label}>
      {p.selected && !p.readOnly && (
        <div className="atom-tools" data-stop>
          <span className="atom-label" data-drag-handle title="Drag to move">
            ⠿ {label}
          </span>
          {tools}
          <button type="button" className="atom-tool danger" onClick={p.remove} title="Delete block">
            <Icon name="trash" size={15} />
          </button>
        </div>
      )}
      {children}
    </figure>
  );
}

function useResolved(src: unknown, ctx: EditorCtx): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (typeof src !== 'string' || !src) {
      setUrl(null);
      return;
    }
    ctx.resolve(src).then((u) => alive && setUrl(u), () => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [src, ctx]);
  return url;
}

function Caption({ p, placeholder = 'Add a caption' }: { p: AtomProps; placeholder?: string }) {
  const [value, setValue] = useState(String(p.data.caption ?? ''));
  useEffect(() => setValue(String(p.data.caption ?? '')), [p.data.caption]);
  if (p.readOnly) return p.data.caption ? <figcaption>{String(p.data.caption)}</figcaption> : null;
  if (!p.selected && !p.data.caption) return null;
  return (
    <figcaption>
      <input
        className="caption-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value !== (p.data.caption ?? '') && p.update({ caption: value })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        maxLength={300}
      />
    </figcaption>
  );
}

// ------------------------------------------------------------------ image

function ImageBlock(p: AtomProps) {
  const url = useResolved(p.data.src, p.ctx);
  const w = Number(p.data.w ?? 100);
  const align = String(p.data.align ?? 'center');
  const [dragW, setDragW] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const parent = box.current?.parentElement?.getBoundingClientRect();
    if (!parent) return;
    const move = (ev: PointerEvent) => {
      const left = box.current!.getBoundingClientRect().left;
      setDragW(Math.max(15, Math.min(100, Math.round(((ev.clientX - left) / parent.width) * 100))));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const left = box.current!.getBoundingClientRect().left;
      p.update({ w: Math.max(15, Math.min(100, Math.round(((ev.clientX - left) / parent.width) * 100))) });
      setDragW(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const tools = (
    <>
      {(['left', 'center', 'right'] as const).map((a) => (
        <button key={a} type="button" className={`atom-tool ${align === a ? 'on' : ''}`} onClick={() => p.update({ align: a })} title={`Align ${a}`}>
          {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
        </button>
      ))}
      {[33, 50, 75, 100].map((n) => (
        <button key={n} type="button" className={`atom-tool ${w === n ? 'on' : ''}`} onClick={() => p.update({ w: n })}>
          {n}%
        </button>
      ))}
      {p.ctx.aiEnabled && (
        <button
          type="button"
          className="atom-tool"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const text = await p.ctx.ai('describe-image', { src: p.data.src });
              p.update({ alt: text.slice(0, 300), caption: p.data.caption || text.slice(0, 160) });
            } catch (e) {
              window.alert((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="sparkle" size={14} /> {busy ? 'Describing…' : 'Describe'}
        </button>
      )}
    </>
  );

  return (
    <Frame p={p} tools={tools} label="Image">
      <div className={`img-wrap align-${align}`}>
        <div className="img-box" ref={box} style={{ width: `${dragW ?? w}%` }}>
          {url ? <img src={url} alt={String(p.data.alt ?? p.data.caption ?? '')} draggable={false} /> : <div className="img-loading">Loading image…</div>}
          {p.selected && !p.readOnly && <span className="resize-handle" onPointerDown={startResize} data-stop title="Drag to resize" />}
        </div>
      </div>
      <Caption p={p} />
      {typeof p.data.credit === 'string' && p.data.credit && (
        <p className="img-credit">
          {p.data.source ? (
            <a href={String(p.data.source)} target="_blank" rel="noreferrer">
              {String(p.data.credit)}
            </a>
          ) : (
            String(p.data.credit)
          )}
        </p>
      )}
    </Frame>
  );
}

// ------------------------------------------------------- embeds and links

function EmbedBlock(p: AtomProps) {
  const ratio = Number(p.data.ratio ?? 56.25);
  return (
    <Frame p={p} label={String(p.data.kind ?? 'Embed')}>
      <div className="embed-box" style={{ paddingBottom: `${ratio}%` }}>
        <iframe
          src={String(p.data.src ?? '')}
          title={String(p.data.kind ?? 'Embedded content')}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
          referrerPolicy="strict-origin-when-cross-origin"
        />
        {!p.selected && !p.readOnly && <div className="embed-shield" title="Click to select" />}
      </div>
      <Caption p={p} />
    </Frame>
  );
}

function LinkCard(p: AtomProps) {
  const [loading, setLoading] = useState(false);
  const url = String(p.data.url ?? '');
  useEffect(() => {
    if (p.data.title || !url || p.readOnly) return;
    setLoading(true);
    p.ctx
      .unfurl(url)
      .then((m) => p.update({ title: m.title, description: m.description, image: m.image, site: m.site, url: m.url }))
      .catch(() => p.update({ title: url }))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return (
    <Frame p={p} label="Link">
      <a className="link-card" href={url} target="_blank" rel="noopener noreferrer nofollow">
        <span className="link-text">
          <strong>{loading ? 'Loading preview…' : String(p.data.title ?? url)}</strong>
          {typeof p.data.description === 'string' && p.data.description && <span className="link-desc">{p.data.description}</span>}
          <span className="link-site">{String(p.data.site ?? (url ? new URL(url).hostname : ''))}</span>
        </span>
        {typeof p.data.image === 'string' && p.data.image && <img src={p.data.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      </a>
    </Frame>
  );
}

const fmtSize = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

function AudioBlock(p: AtomProps) {
  const url = useResolved(p.data.src, p.ctx);
  return (
    <Frame p={p} label="Voice note">
      <div className="audio-card">
        <Icon name="mic" />
        <div>
          <strong>{String(p.data.name ?? 'Voice note')}</strong>
          {url ? <audio controls src={url} preload="metadata" /> : <span className="muted small">Loading…</span>}
        </div>
      </div>
      <Caption p={p} placeholder="What is this note about?" />
    </Frame>
  );
}

function FileBlock(p: AtomProps) {
  const url = useResolved(p.data.src, p.ctx);
  return (
    <Frame p={p} label="Attachment">
      <a className="file-card" href={url ?? '#'} download={String(p.data.name ?? 'file')} target="_blank" rel="noreferrer">
        <span className="file-icon">{String(p.data.name ?? '').split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE'}</span>
        <span>
          <strong>{String(p.data.name ?? 'Attachment')}</strong>
          <span className="muted small">
            {p.data.size ? fmtSize(Number(p.data.size)) : ''} · Click to download
          </span>
        </span>
      </a>
    </Frame>
  );
}

// ---------------------------------------------------------------- drawing

interface Stroke {
  c: string;
  w: number;
  p: number[];
}
const PENS = ['#111418', '#1f3a68', '#b4442c', '#2e7d5b', '#a8842f', '#6b4c9a'];

export function strokePath(pts: number[]): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 2; i < pts.length - 2; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2;
    const my = (pts[i + 1] + pts[i + 3]) / 2;
    d += ` Q${pts[i]} ${pts[i + 1]} ${mx} ${my}`;
  }
  if (pts.length >= 4) d += ` L${pts[pts.length - 2]} ${pts[pts.length - 1]}`;
  return d;
}

function DrawingBlock(p: AtomProps) {
  const strokes = (Array.isArray(p.data.strokes) ? p.data.strokes : []) as Stroke[];
  const h = Number(p.data.h ?? 320);
  const [pen, setPen] = useState(PENS[0]);
  const [width, setWidth] = useState(3);
  const [erase, setErase] = useState(false);
  const [live, setLive] = useState<Stroke | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const editing = p.selected && !p.readOnly;

  const point = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 800), Math.round(((e.clientY - r.top) / r.height) * h)];
  };

  const tools = (
    <>
      {PENS.map((c) => (
        <button key={c} type="button" className={`swatch ${pen === c && !erase ? 'on' : ''}`} style={{ background: c }} onClick={() => (setPen(c), setErase(false))} aria-label={`Pen ${c}`} />
      ))}
      <select className="atom-select" value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Pen size">
        <option value={2}>Thin</option>
        <option value={3}>Medium</option>
        <option value={6}>Thick</option>
        <option value={14}>Marker</option>
      </select>
      <button type="button" className={`atom-tool ${erase ? 'on' : ''}`} onClick={() => setErase(!erase)}>
        Eraser
      </button>
      <button type="button" className="atom-tool" disabled={!strokes.length} onClick={() => p.update({ strokes: strokes.slice(0, -1) })}>
        Undo
      </button>
      <button type="button" className="atom-tool" onClick={() => window.confirm('Clear the drawing?') && p.update({ strokes: [] })}>
        Clear
      </button>
      <button type="button" className="atom-tool" onClick={() => p.update({ h: h >= 640 ? 240 : h + 120 })}>
        {h >= 640 ? 'Shorter' : 'Taller'}
      </button>
    </>
  );

  return (
    <Frame p={p} tools={tools} label="Drawing">
      <svg
        ref={svg}
        className={`draw-surface ${editing ? 'editing' : ''}`}
        viewBox={`0 0 800 ${h}`}
        style={{ aspectRatio: `800 / ${h}` }}
        onPointerDown={(e) => {
          if (!editing || erase) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setLive({ c: pen, w: width, p: point(e) });
        }}
        onPointerMove={(e) => {
          if (live) setLive({ ...live, p: [...live.p, ...point(e)] });
        }}
        onPointerUp={() => {
          if (live && live.p.length >= 4) p.update({ strokes: [...strokes, { ...live, p: simplify(live.p) }] });
          setLive(null);
        }}
      >
        {strokes.map((s, i) => (
          <path
            key={i}
            d={strokePath(s.p)}
            stroke={s.c}
            strokeWidth={s.w}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            onPointerEnter={(e) => erase && editing && e.buttons === 1 && p.update({ strokes: strokes.filter((_, j) => j !== i) })}
            onPointerDown={() => erase && editing && p.update({ strokes: strokes.filter((_, j) => j !== i) })}
            className={erase && editing ? 'erasable' : ''}
          />
        ))}
        {live && <path d={strokePath(live.p)} stroke={live.c} strokeWidth={live.w} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
        {!strokes.length && !live && (
          <text x="400" y={h / 2} textAnchor="middle" className="draw-hint">
            {editing ? 'Draw here' : 'Empty drawing — click to select, then draw'}
          </text>
        )}
      </svg>
    </Frame>
  );
}

/** Drops points closer than 2 units to keep drawings small. */
function simplify(pts: number[]): number[] {
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const dx = pts[i] - out[out.length - 2];
    const dy = pts[i + 1] - out[out.length - 1];
    if (dx * dx + dy * dy >= 4) out.push(pts[i], pts[i + 1]);
  }
  return out;
}

// ------------------------------------------------------------ math, mermaid

function useLazy<T>(load: () => Promise<T>): T | null {
  const [mod, setMod] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((m) => alive && setMod(() => m));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return mod;
}

function MathBlock(p: AtomProps) {
  const tex = String(p.data.tex ?? '');
  const [draft, setDraft] = useState(tex);
  const k = useLazy(() => import('./katex.ts'));
  useEffect(() => setDraft(tex), [tex]);
  const shown = p.selected && !p.readOnly ? draft : tex;
  const r = k ? k.renderTex(shown, true) : null;
  return (
    <Frame p={p} label="Equation">
      {r ? <div className="math-render" dangerouslySetInnerHTML={{ __html: r.html }} /> : <div className="math-render muted">Loading maths…</div>}
      {p.selected && !p.readOnly && (
        <div className="code-edit" data-stop>
          <textarea
            className="input mono"
            rows={2}
            value={draft}
            placeholder="LaTeX, e.g. E = mc^2 or \frac{a}{b}"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft !== tex && p.update({ tex: draft })}
            autoFocus={!tex}
          />
          {r?.error && <span className="error-text small">{r.error}</span>}
        </div>
      )}
    </Frame>
  );
}

let mermaidSeq = 0;
function MermaidBlock(p: AtomProps) {
  const code = String(p.data.code ?? '');
  const [draft, setDraft] = useState(code);
  const [svgHtml, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(code), [code]);
  const shown = p.selected && !p.readOnly ? draft : code;
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', fontFamily: 'Times New Roman', securityLevel: 'strict' });
        const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, shown || 'graph TD; A[Start] --> B[Finish]');
        if (alive) {
          setSvg(svg);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message.split('\n')[0]);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [shown]);
  return (
    <Frame p={p} label="Diagram">
      <div className="mermaid-render" dangerouslySetInnerHTML={{ __html: svgHtml }} />
      {error && <p className="error-text small">{error}</p>}
      {p.selected && !p.readOnly && (
        <div className="code-edit" data-stop>
          <textarea className="input mono" rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== code && p.update({ code: draft })} />
          <span className="muted small">Mermaid syntax: flowcharts, sequence diagrams, gantt charts, pie charts…</span>
        </div>
      )}
    </Frame>
  );
}

// ------------------------------------------------------- toc and summary

function TocBlock(p: AtomProps) {
  const [, force] = useState(0);
  useEffect(() => p.ctx.onChange(() => force((n) => n + 1)), [p.ctx]);
  const heads = p.ctx.headings();
  return (
    <Frame p={p} label="Table of contents">
      <nav className="toc-block">
        <strong>Contents</strong>
        {!heads.length && <span className="muted small">Add headings and they appear here automatically.</span>}
        <ol>
          {heads.map((h) => (
            <li key={h.pos} className={`toc-l${h.level}`}>
              <button type="button" className="link-button" onClick={() => p.ctx.jumpTo(h.pos)}>
                {h.text || 'Untitled heading'}
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </Frame>
  );
}

function SummaryBlock(p: AtomProps) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(String(p.data.text ?? ''));
  useEffect(() => setDraft(String(p.data.text ?? '')), [p.data.text]);
  const generate = async () => {
    setBusy(true);
    try {
      const text = await p.ctx.ai('summarize', {});
      p.update({ text, at: Date.now() });
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame p={p} label="Summary card">
      <aside className="summary-card">
        <header>
          <Icon name="sparkle" size={16} /> <strong>Summary</strong>
          {typeof p.data.at === 'number' && <span className="muted small"> · updated {new Date(p.data.at).toLocaleString()}</span>}
          {!p.readOnly && p.ctx.aiEnabled && (
            <button type="button" className="btn btn-text btn-sm" disabled={busy} onClick={generate}>
              {busy ? 'Summarizing…' : p.data.text ? 'Refresh' : 'Generate with AI'}
            </button>
          )}
        </header>
        {p.selected && !p.readOnly ? (
          <textarea className="input" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== p.data.text && p.update({ text: draft })} placeholder="Write a short summary…" />
        ) : (
          <p>{String(p.data.text || (p.ctx.aiEnabled ? 'Click “Generate with AI” to summarize this document.' : 'Select this card to write a summary.'))}</p>
        )}
      </aside>
    </Frame>
  );
}

// -------------------------------------------------------------- signature

function SignatureBlock(p: AtomProps) {
  const signed = typeof p.data.at === 'number';
  const img = useResolved(p.data.img, p.ctx);
  const [name, setName] = useState(p.ctx.me.name);
  const [pts, setPts] = useState<number[][]>([]);
  const [cur, setCur] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const pad = useRef<SVGSVGElement>(null);
  const pos = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 600), Math.round(((e.clientY - r.top) / r.height) * 160)];
  };

  const sign = async () => {
    if (!pts.length || !name.trim()) return;
    setBusy(true);
    try {
      const svgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 160"><g fill="none" stroke="#1f3a68" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${pts.map((s) => `<path d="${strokePath(s)}"/>`).join('')}</g></svg>`;
      const png = await svgToPng(svgText, 600, 160);
      const up = await p.ctx.upload(png, 'signature.png');
      p.update({ name: name.trim(), img: up.src, at: Date.now(), by: p.ctx.me.id });
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (signed) {
    return (
      <Frame
        p={p}
        label="Signature"
        tools={
          (p.data.by === p.ctx.me.id || !p.data.by) && (
            <button type="button" className="atom-tool" onClick={() => p.update({ at: null, img: null })}>
              Remove signature
            </button>
          )
        }
      >
        <div className="signature signed">
          {img && <img src={img} alt={`Signature of ${String(p.data.name)}`} />}
          <div className="sig-line" />
          <strong>{String(p.data.name)}</strong>
          <span className="muted small">Signed electronically on {new Date(Number(p.data.at)).toLocaleString()}</span>
        </div>
      </Frame>
    );
  }
  return (
    <Frame p={p} label="Signature">
      <div className="signature">
        {p.readOnly ? (
          <p className="muted">Awaiting signature</p>
        ) : (
          <>
            <svg
              ref={pad}
              className="sig-pad draw-surface editing"
              viewBox="0 0 600 160"
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setCur(pos(e));
              }}
              onPointerMove={(e) => cur && setCur([...cur, ...pos(e)])}
              onPointerUp={() => {
                if (cur && cur.length >= 4) setPts([...pts, cur]);
                setCur(null);
              }}
            >
              {pts.map((s, i) => (
                <path key={i} d={strokePath(s)} stroke="#1f3a68" strokeWidth={3} fill="none" strokeLinecap="round" />
              ))}
              {cur && <path d={strokePath(cur)} stroke="#1f3a68" strokeWidth={3} fill="none" strokeLinecap="round" />}
              {!pts.length && !cur && (
                <text x="300" y="90" textAnchor="middle" className="draw-hint">
                  Sign here
                </text>
              )}
            </svg>
            <div className="sig-line" />
            <div className="inline-form" data-stop>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" aria-label="Signer name" />
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setPts([])} disabled={!pts.length}>
                Clear
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={sign} disabled={busy || !pts.length || !name.trim()}>
                {busy ? 'Signing…' : 'Sign'}
              </button>
            </div>
          </>
        )}
      </div>
    </Frame>
  );
}

export function svgToPng(svgText: string, w: number, h: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w * 2;
      c.height = h * 2;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create image'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Could not render signature'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  });
}

// ------------------------------------------------------------------ table

function TableBlock(p: AtomProps) {
  const rows = (Array.isArray(p.data.rows) && p.data.rows.length ? p.data.rows : [['', ''], ['', '']]) as string[][];
  const header = p.data.header !== false;
  const [draft, setDraft] = useState(rows);
  useEffect(() => setDraft(rows), [JSON.stringify(rows)]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols = Math.max(...draft.map((r) => r.length));
  const commit = (next: string[][]) => {
    setDraft(next);
    p.update({ rows: next });
  };
  const editable = !p.readOnly;
  const tools = (
    <>
      <button type="button" className="atom-tool" onClick={() => commit([...draft, Array(cols).fill('')])}>
        + Row
      </button>
      <button type="button" className="atom-tool" onClick={() => commit(draft.map((r) => [...r, '']))}>
        + Column
      </button>
      <button type="button" className="atom-tool" disabled={draft.length <= 1} onClick={() => commit(draft.slice(0, -1))}>
        − Row
      </button>
      <button type="button" className="atom-tool" disabled={cols <= 1} onClick={() => commit(draft.map((r) => r.slice(0, -1)))}>
        − Column
      </button>
      <button type="button" className={`atom-tool ${header ? 'on' : ''}`} onClick={() => p.update({ header: !header })}>
        Header row
      </button>
    </>
  );
  return (
    <Frame p={p} tools={tools} label="Table">
      <div className="table-scroll-x">
        <table className="table-grid">
          <tbody>
            {draft.map((r, ri) => (
              <tr key={ri} className={ri === 0 && header ? 'thead' : ''}>
                {Array.from({ length: cols }, (_, ci) => (
                  <td key={ci}>
                    {editable ? (
                      <textarea
                        className="cell"
                        rows={1}
                        value={r[ci] ?? ''}
                        onChange={(e) => setDraft(draft.map((row, i) => (i === ri ? Array.from({ length: cols }, (_, j) => (j === ci ? e.target.value : row[j] ?? '')) : row)))}
                        onBlur={() => JSON.stringify(draft) !== JSON.stringify(rows) && p.update({ rows: draft })}
                        aria-label={`Row ${ri + 1}, column ${ci + 1}`}
                      />
                    ) : (
                      <span className="cell">{r[ci] ?? ''}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------------ chips

/** Inline objects: mentions, dates, icons and inline maths. */
export class ChipView implements NodeView {
  dom: HTMLElement;
  constructor(node: PMNode) {
    this.dom = document.createElement('span');
    this.dom.contentEditable = 'false';
    this.render(node);
  }
  private render(node: PMNode) {
    const d = node.attrs.data as Data;
    const kind = node.attrs.kind as string;
    this.dom.className = `chip chip-${kind}`;
    switch (kind) {
      case 'mention':
        this.dom.textContent = `@${String(d.name ?? '')}`;
        break;
      case 'date':
        this.dom.textContent = `📅 ${String(d.date ?? '')}`;
        break;
      case 'icon':
        this.dom.innerHTML = `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${String(d.path ?? '')}"/></svg>`;
        break;
      case 'math':
        this.dom.textContent = String(d.tex ?? '');
        void import('./katex.ts').then((k) => {
          this.dom.innerHTML = k.renderTex(String(d.tex ?? ''), false).html;
        });
        break;
      default:
        this.dom.textContent = '';
    }
  }
  update(node: PMNode) {
    if (node.type.name !== 'chip') return false;
    this.render(node);
    return true;
  }
  ignoreMutation() {
    return true;
  }
}
