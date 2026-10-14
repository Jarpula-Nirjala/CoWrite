import { useEffect, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import type { Obj } from '../objects.ts';
import { fontOf, isTitleLayout, textColor, type DeckSettings, type El, type SlideFields } from './model.ts';
import { shapePath } from './shapePath.ts';
import { decoSvg, type SlideTheme } from './themes.ts';

function useUrl(src: string | null | undefined, resolve: (s: string) => Promise<string>) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return setUrl(null);
    let alive = true;
    resolve(src).then((u) => alive && setUrl(u), () => {});
    return () => {
      alive = false;
    };
  }, [src, resolve]);
  return url;
}

function ImageEl({ el, resolve, editable }: { el: El; resolve: (s: string) => Promise<string>; editable: boolean }) {
  const url = useUrl(el.src, resolve);
  if (!el.src) return <div className="slide-img-placeholder">{editable ? 'Double-click to add an image' : ''}</div>;
  return url ? <img src={url} alt="" draggable={false} style={{ objectFit: el.fit ?? 'cover', width: '100%', height: '100%' }} /> : null;
}

export interface Remote {
  site: string;
  name: string;
  color: string;
  focus: string | null;
  x?: number;
  y?: number;
}

/** One slide rendered at `width` pixels (thumbnails, canvas and presenting). */
export function SlideView({
  slide,
  els,
  theme,
  deck,
  width,
  index,
  total,
  resolve,
  editable = false,
  selected = [],
  editing = null,
  remotes = [],
  onElPointerDown,
  onElDoubleClick,
  onTextCommit,
  onBackgroundPointerDown,
  onPointerMove,
}: {
  slide: Obj<SlideFields>;
  els: Obj<El>[];
  theme: SlideTheme;
  deck: DeckSettings;
  width: number;
  index: number;
  total: number;
  resolve: (s: string) => Promise<string>;
  editable?: boolean;
  selected?: string[];
  editing?: string | null;
  remotes?: Remote[];
  onElPointerDown?(e: RPointerEvent, id: string, handle?: string): void;
  onElDoubleClick?(id: string): void;
  onTextCommit?(id: string, text: string): void;
  onBackgroundPointerDown?(e: RPointerEvent): void;
  onPointerMove?(x: number, y: number): void;
}) {
  const s = width / 960;
  const title = isTitleLayout(slide.f.layout);
  const bg = slide.f.bg ?? (title && theme.titleBg ? theme.titleBg : theme.bg);
  const bgUrl = useUrl(slide.f.bgImage, resolve);
  const logo = useUrl(deck.logo, resolve);
  const deco = decoSvg(theme.deco, theme.decoColor, title && !!theme.titleBg);
  return (
    <div
      className={`slide ${editable ? 'editable' : ''}`}
      style={{ width, height: width * 0.5625, background: bgUrl ? `center / cover no-repeat url("${bgUrl}")` : bg, '--s': s } as CSSProperties}
      onPointerDown={(e) => e.target === e.currentTarget && onBackgroundPointerDown?.(e)}
      onPointerMove={(e) => {
        if (!onPointerMove) return;
        const r = e.currentTarget.getBoundingClientRect();
        onPointerMove(((e.clientX - r.left) / r.width) * 960, ((e.clientY - r.top) / r.height) * 540);
      }}
    >
      {deco && <svg className="slide-deco" viewBox="0 0 960 540" preserveAspectRatio="none" dangerouslySetInnerHTML={{ __html: deco }} />}
      {logo && <img className="slide-logo" src={logo} alt="" style={{ height: 40 * s, top: 18 * s, right: 22 * s }} />}
      {[...els]
        .sort((a, b) => a.f.z - b.f.z)
        .map((o) => {
          const el = o.f;
          const sel = selected.includes(o.id);
          const style: CSSProperties = {
            left: `${(el.x / 960) * 100}%`,
            top: `${(el.y / 540) * 100}%`,
            width: `${(el.w / 960) * 100}%`,
            height: `${(el.h / 540) * 100}%`,
            opacity: el.opacity ?? 1,
          };
          const remote = remotes.find((r) => r.focus === o.id);
          return (
            <div
              key={o.id}
              className={`slide-el el-${el.kind} ${sel ? 'is-selected' : ''} ${remote ? 'is-remote' : ''}`}
              style={{ ...style, ...(remote ? ({ '--peer': remote.color } as CSSProperties) : {}) }}
              onPointerDown={(e) => onElPointerDown?.(e, o.id)}
              onDoubleClick={() => onElDoubleClick?.(o.id)}
            >
              {el.kind === 'shape' && (
                <svg viewBox={`0 0 ${el.w} ${el.h}`} preserveAspectRatio="none" className="slide-shape">
                  <path d={shapePath(el.shape, el.w, el.h)} fill={el.shape === 'line' ? 'none' : (el.fill ?? theme.accent)} stroke={el.stroke ?? (el.shape === 'line' ? theme.accent : 'none')} strokeWidth={(el.strokeW ?? (el.shape === 'line' ? 4 : 0))} vectorEffect="non-scaling-stroke" />
                </svg>
              )}
              {el.kind === 'image' && <ImageEl el={el} resolve={resolve} editable={editable} />}
              {(el.kind === 'text' || (el.kind === 'shape' && el.text)) && (
                <TextBody el={el} id={o.id} theme={theme} titleSlide={title} s={s} editing={editing === o.id} onCommit={onTextCommit} />
              )}
              {remote && <span className="slide-el-peer">{remote.name}</span>}
              {sel && editable && editing !== o.id && (
                <>
                  {['nw', 'ne', 'sw', 'se', 'e', 'w', 'n', 's'].map((h) => (
                    <span key={h} className={`handle h-${h}`} onPointerDown={(e) => (e.stopPropagation(), onElPointerDown?.(e, o.id, h))} />
                  ))}
                </>
              )}
            </div>
          );
        })}
      {deck.footer && <div className="slide-footer" style={{ fontSize: 13 * s, color: title && theme.titleBg ? '#ffffffcc' : theme.text, fontFamily: theme.bodyFont }}>{deck.footer}</div>}
      {deck.numbers && index > 0 && (
        <div className="slide-number" style={{ fontSize: 13 * s, color: title && theme.titleBg ? '#ffffffcc' : theme.text, fontFamily: theme.bodyFont }}>
          {index + 1} / {total}
        </div>
      )}
      {remotes
        .filter((r) => r.x !== undefined && r.y !== undefined)
        .map((r) => (
          <span key={r.site} className="slide-pointer" style={{ left: `${(r.x! / 960) * 100}%`, top: `${(r.y! / 540) * 100}%`, '--peer': r.color } as CSSProperties}>
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M1 1 L14 7 L8 8.5 L6 15 Z" fill={r.color} stroke="#fff" strokeWidth="1.2" />
            </svg>
            <span>{r.name}</span>
          </span>
        ))}
    </div>
  );
}

function TextBody({ el, id, theme, titleSlide, s, editing, onCommit }: { el: El; id: string; theme: SlideTheme; titleSlide: boolean; s: number; editing: boolean; onCommit?(id: string, text: string): void }) {
  const style: CSSProperties = {
    fontSize: (el.size ?? 24) * s,
    fontWeight: el.bold ? 700 : 400,
    fontStyle: el.italic ? 'italic' : 'normal',
    textDecoration: el.underline ? 'underline' : 'none',
    color: el.kind === 'shape' ? (el.color ?? '#ffffff') : textColor(el, theme, titleSlide),
    fontFamily: fontOf(el, theme),
    textAlign: el.align ?? 'left',
    justifyContent: el.valign === 'middle' ? 'center' : el.valign === 'bottom' ? 'flex-end' : 'flex-start',
  };
  const lines = (el.text ?? '').split('\n');
  if (editing) {
    return (
      <div
        className="slide-text editing"
        style={style}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        ref={(n) => {
          if (n && document.activeElement !== n) {
            n.focus();
            const r = document.createRange();
            r.selectNodeContents(n);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(r);
          }
        }}
        onBlur={(e) => onCommit?.(id, (e.currentTarget.innerText ?? '').replace(/\n$/, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
          e.stopPropagation();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {el.text ?? ''}
      </div>
    );
  }
  return (
    <div className="slide-text" style={style}>
      {el.list ? (
        <ul style={{ '--bullet': theme.accent } as CSSProperties}>
          {lines.filter((l) => l.trim()).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : (
        <div>
          {lines.map((l, i) => (
            <div key={i}>{l || ' '}</div>
          ))}
        </div>
      )}
    </div>
  );
}
